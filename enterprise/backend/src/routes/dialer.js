import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

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
        // Simulate progress
        simulateCampaignProgress(campaign.id);
    }
    res.json(campaign);
});

// DELETE /api/dialer/campaigns/:id
router.delete('/campaigns/:id', async (req, res) => {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

function simulateCampaignProgress(campaignId) {
    const interval = setInterval(async () => {
        try {
            const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
            if (!campaign || campaign.status !== 'running') { clearInterval(interval); return; }
            if (campaign.dialedLeads >= campaign.totalLeads) {
                await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'completed' } });
                clearInterval(interval); return;
            }
            const newDialed = Math.min(campaign.dialedLeads + campaign.callsPerSecond, campaign.totalLeads);
            const newConnected = Math.min(campaign.connectedLeads + Math.floor(campaign.callsPerSecond * 0.65), newDialed);
            await prisma.campaign.update({ where: { id: campaignId }, data: { dialedLeads: newDialed, connectedLeads: newConnected } });
        } catch { clearInterval(interval); }
    }, 2000);
}

export default router;
