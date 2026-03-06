const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { wss } = require('../server'); // Assuming wss is exported from server.js
const fsManager = require('../services/freeswitch'); // Assuming freeswitch.js is in services folder

// GET /api/dialer/campaigns
router.get('/campaigns', async (req, res) => {
    res.json(await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } }));
});

// POST /api/dialer/campaigns
router.post('/campaigns', async (req, res) => {
    const {
        name, agentId, dialingMode, callsPerSecond, tcpaLock, dncScrubbing, amdEnabled, voicemailDrop,
        startDate, endDate, audience,
        scriptOverride, maxDuration, maxRetries, retryDelayMin, voicemailDropAudio,
        localCallerId, strictLitigatorScrub, sentimentTransfer, timezoneRespect, costCapTokens, postCallSmsTemplate,

        // Phase 2 Elite Features
        recordCalls, concurrentCallLimit, autoPauseFailureRate, webhookUrl, dynamicVariables,
        transferNumber, transferWhisper, maxBudgetUsd, smsOnNoAnswer, amdAction
    } = req.body;

    const leads = Array.isArray(audience) ? audience : [];

    const campaign = await prisma.campaign.create({
        data: {
            name, agentId, dialingMode: dialingMode || 'predictive',
            callsPerSecond: callsPerSecond || 5,
            tcpaLock: tcpaLock ?? true, dncScrubbing: dncScrubbing ?? true,
            amdEnabled: amdEnabled ?? true, voicemailDrop: voicemailDrop ?? false,

            // NEW ADVANCED FEATURES
            scriptOverride: scriptOverride || null,
            maxDuration: isNaN(maxDuration) ? 10 : parseInt(maxDuration, 10),
            maxRetries: isNaN(maxRetries) ? 0 : parseInt(maxRetries, 10),
            retryDelayMin: isNaN(retryDelayMin) ? 60 : parseInt(retryDelayMin, 10),
            voicemailDropAudio: voicemailDropAudio || null,
            localCallerId: localCallerId ?? false,
            strictLitigatorScrub: strictLitigatorScrub ?? false,
            sentimentTransfer: sentimentTransfer ?? false,
            timezoneRespect: timezoneRespect ?? true,
            costCapTokens: isNaN(costCapTokens) ? 5000 : parseInt(costCapTokens, 10),
            postCallSmsTemplate: postCallSmsTemplate || null,

            // PHASE 2 ELITE FEATURES
            recordCalls: recordCalls ?? true,
            concurrentCallLimit: isNaN(concurrentCallLimit) ? 0 : parseInt(concurrentCallLimit, 10),
            autoPauseFailureRate: isNaN(autoPauseFailureRate) ? 0 : parseInt(autoPauseFailureRate, 10),
            webhookUrl: webhookUrl || null,
            dynamicVariables: dynamicVariables ?? false,
            transferNumber: transferNumber || null,
            transferWhisper: transferWhisper || null,
            maxBudgetUsd: maxBudgetUsd ? parseFloat(maxBudgetUsd) : null,
            smsOnNoAnswer: smsOnNoAnswer || null,
            amdAction: amdAction || 'hangup',

            totalLeads: leads.length,
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
            audience: JSON.stringify(leads),
        }
    });
    await prisma.systemEvent.create({ data: { type: 'campaign.created', message: `Campaign "${name}" created with ${leads.length} leads`, severity: 'info' } });
    res.json(campaign);
});

// PATCH /api/dialer/campaigns/:id
router.patch('/campaigns/:id', async (req, res) => {
    const data = { ...req.body };
    if (data.audience && Array.isArray(data.audience)) data.audience = JSON.stringify(data.audience);
    const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data });
    res.json(campaign);
});

// PATCH /api/dialer/campaigns/:id/status
router.patch('/campaigns/:id/status', async (req, res) => {
    const { status } = req.body;
    const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data: { status } });
    if (status === 'running') {
        await prisma.systemEvent.create({ data: { type: 'campaign.started', message: `Campaign "${campaign.name}" started`, severity: 'info' } });
        // Fire-and-forget background execution with concurrency limit
        const phoneNumbers = JSON.parse(campaign.audience); // Assuming audience is stored as JSON string of phone numbers
        executeRealCampaign(campaign.id, phoneNumbers, wss)
            .catch(err => console.error(`[Dialer] Campaign ${campaign.id} error:`, err));
    }
    res.json(campaign);
});

// DELETE /api/dialer/campaigns/:id
router.delete('/campaigns/:id', async (req, res) => {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// --------------------------------------------------------------------------
// REAL FREESWITCH CAMPAIGN EXECUTION
// --------------------------------------------------------------------------
async function executeRealCampaign(campaignId, phoneNumbers, wss) {
    try {
        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            include: { agent: true }
        });

        if (!campaign || !campaign.agent) {
            console.error(`[Dialer] Campaign ${campaignId} or its Agent not found. Cannot originate calls.`);
            return;
        }

        const maxConcurrent = campaign.concurrentCalls || 2;
        console.log(`[Dialer] Starting real campaign ${campaignId} over FreeSWITCH (${maxConcurrent} concurrent)`);

        // We will build a basic async queue to manage concurrency
        const queue = [...phoneNumbers];
        let activeCalls = 0;

        // Create an initial empty call slice for WS broadcasting mapping
        const metrics = {
            total: phoneNumbers.length,
            active: 0,
            completed: 0,
            failed: 0
        };

        const broadcastMetrics = () => {
            if (wss) {
                wss.clients.forEach(client => {
                    if (client.readyState === 1 /* WebSocket.OPEN */) {
                        client.send(JSON.stringify({
                            type: 'CAMPAIGN_PROGRESS',
                            data: { campaignId, metrics }
                        }));
                    }
                });
            }
        };

        return new Promise((resolve) => {
            const originateNext = async () => {
                // Stop if paused or completed
                const currentCampaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
                if (!currentCampaign || currentCampaign.status !== 'active' && currentCampaign.status !== 'running') {
                    console.log(`[Dialer] Campaign ${campaignId} halted internally.`);
                    resolve();
                    return;
                }

                // Check if queue empty
                if (queue.length === 0) {
                    if (activeCalls === 0) {
                        // All done entirely
                        await prisma.campaign.update({
                            where: { id: campaignId },
                            data: { status: 'completed' }
                        });
                        console.log(`[Dialer] Campaign ${campaignId} fully complete.`);
                        resolve();
                    }
                    return; // No more numbers to pop right now, waiting for activeCalls to finish
                }

                const phone = queue.shift();
                activeCalls++;
                metrics.active++;
                broadcastMetrics();

                try {
                    const callUuidStr = await fsManager.originateCall(phone, campaign, campaign.agent);
                    console.log(`[Dialer] Sent originate command for ${phone} - Job UUID: ${callUuidStr || 'unknown'}`);
                    metrics.completed++;
                } catch (error) {
                    console.error(`[Dialer] Failed to originate ${phone}:`, error.message);
                    metrics.failed++;
                } finally {
                    activeCalls--;
                    metrics.active--;
                    broadcastMetrics();

                    // We wait 2 seconds between popping from queue to not swamp FreeSWITCH immediately
                    setTimeout(originateNext, 2000);
                }
            };

            // Fill initial concurrency slots
            for (let i = 0; i < maxConcurrent; i++) {
                originateNext();
            }
        });

    } catch (error) {
        console.error(`[Dialer] Critical execution error:`, error);
    }
}

module.exports = router;
