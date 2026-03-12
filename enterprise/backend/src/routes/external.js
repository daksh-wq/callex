import { Router } from 'express';
import { prisma } from '../index.js';
import { requireApiKey } from '../middleware/auth.js';

const router = Router();

// Apply auth middleware to ALL external v1 routes
router.use(requireApiKey);

// GET /v1/agents - List all agents with pagination
router.get('/agents', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const status = req.query.status; // optional filter: draft, active, paused

        const where = status ? { status } : {};
        const skip = (page - 1) * limit;

        const [agents, total] = await Promise.all([
            prisma.agent.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.agent.count({ where }),
        ]);

        res.json({
            agents,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to list agents' });
    }
});

// POST /v1/agents - Create a new Agent purely via API
router.post('/agents', async (req, res) => {
    try {
        const {
            name, description, systemPrompt, openingLine, voice, language, sttEngine, llmModel,
            fillerPhrases, prosodyRate, prosodyPitch, ipaLexicon, tools, topK, similarityThresh,
            fallbackMessage, profanityFilter, topicRestriction, backgroundAmbience, speakingStyle,
            bargeInMode, patienceMs, maxDuration, temperature, maxTokens, strictToolCalling,
            ringTimeout, voicemailLogic, webhookUrl, autoSummary, autoSentiment, recordCall, processDtmf,
            amdPrecision, voicemailDropAudio, sentimentRouting, competitorAlerts, supervisorWhisper,
            piiRedaction, geoCallerId, multiAgentHandoff, objectionHandling, emotionalMirroring,
            complianceScript, dynamicCodeSwitching, dncLitigatorScrub, callBlending, costCapTokens,
            postCallSms, autoFollowUp, followUpDefaultDays, followUpDefaultTime
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: "Agent 'name' is required." });
        }

        const agent = await prisma.agent.create({
            data: {
                name, description: description || '', systemPrompt: systemPrompt || '', openingLine: openingLine || '',
                voice: voice || 'alloy', language: language || 'en-US', sttEngine: sttEngine || 'callex-1.1',
                llmModel: llmModel || 'callex-1.3',
                fillerPhrases: JSON.stringify(fillerPhrases || ['Let me check...', 'One moment...']),
                prosodyRate: prosodyRate || 1.0, prosodyPitch: prosodyPitch || 1.0,
                ipaLexicon: JSON.stringify(ipaLexicon || {}),
                tools: JSON.stringify(tools || []),
                topK: topK || 5, similarityThresh: similarityThresh || 0.75,
                fallbackMessage: fallbackMessage || "I'm sorry, I don't have that information right now.",
                profanityFilter: profanityFilter || 'redact',
                topicRestriction: topicRestriction || false,
                backgroundAmbience: backgroundAmbience || 'none',
                speakingStyle: speakingStyle || 'professional',
                bargeInMode: bargeInMode || 'balanced',
                patienceMs: patienceMs || 800,
                maxDuration: maxDuration || 30,
                temperature: temperature || 0.7,
                maxTokens: maxTokens || 250,
                strictToolCalling: strictToolCalling ?? true,
                ringTimeout: ringTimeout || 30,
                voicemailLogic: voicemailLogic || 'hangup',
                webhookUrl: webhookUrl || null,
                autoSummary: autoSummary ?? true,
                autoSentiment: autoSentiment ?? true,
                recordCall: recordCall ?? true,
                processDtmf: processDtmf ?? true,
                amdPrecision: amdPrecision || 'balanced',
                voicemailDropAudio: voicemailDropAudio || null,
                sentimentRouting: sentimentRouting ?? false,
                competitorAlerts: competitorAlerts || '',
                supervisorWhisper: supervisorWhisper ?? true,
                piiRedaction: piiRedaction ?? true,
                geoCallerId: geoCallerId ?? false,
                multiAgentHandoff: multiAgentHandoff ?? false,
                objectionHandling: objectionHandling || 'standard',
                emotionalMirroring: emotionalMirroring ?? true,
                complianceScript: complianceScript || null,
                dynamicCodeSwitching: dynamicCodeSwitching ?? true,
                dncLitigatorScrub: dncLitigatorScrub ?? true,
                callBlending: callBlending ?? false,
                costCapTokens: costCapTokens || 5000,
                postCallSms: postCallSms || null,
                autoFollowUp: autoFollowUp ?? true,
                followUpDefaultDays: followUpDefaultDays || 1,
                followUpDefaultTime: followUpDefaultTime || '10:00',
            }
        });

        // Auto-create initial PromptVersion
        await prisma.promptVersion.create({
            data: {
                agentId: agent.id,
                version: 1,
                prompt: systemPrompt || '',
                isActive: true,
                label: 'v1 - Initial'
            }
        });

        res.status(201).json({
            message: "Agent successfully created.",
            agentId: agent.id,
            agent
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: "Failed to create agent" });
    }
});

// GET /v1/agents/:id - Retrieve an existing agent via API
router.get('/agents/:id', async (req, res) => {
    try {
        const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
            include: { PromptVersion: { orderBy: { version: 'desc' } } }
        });
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        res.json(agent);
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: "Failed to retrieve agent" });
    }
});

// PUT /v1/agents/:id - Update an existing agent via API
router.put('/agents/:id', async (req, res) => {
    try {
        const existing = await prisma.agent.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ error: 'Agent not found' });

        const data = { ...req.body };

        // Serialize JSON fields if provided as arrays/objects
        if (data.fillerPhrases && Array.isArray(data.fillerPhrases)) data.fillerPhrases = JSON.stringify(data.fillerPhrases);
        if (data.ipaLexicon && typeof data.ipaLexicon === 'object') data.ipaLexicon = JSON.stringify(data.ipaLexicon);
        if (data.tools && Array.isArray(data.tools)) data.tools = JSON.stringify(data.tools);

        // Prevent overwriting the id or timestamps
        delete data.id;
        delete data.createdAt;
        delete data.updatedAt;

        const agent = await prisma.agent.update({ where: { id: req.params.id }, data });

        res.json({
            message: 'Agent updated successfully.',
            agentId: agent.id,
            agent,
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to update agent' });
    }
});

// DELETE /v1/agents/:id - Delete an agent via API
router.delete('/agents/:id', async (req, res) => {
    try {
        const existing = await prisma.agent.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ error: 'Agent not found' });

        // Delete related records first (Prisma SQLite doesn't always cascade)
        await prisma.promptVersion.deleteMany({ where: { agentId: req.params.id } });
        await prisma.followUp.deleteMany({ where: { agentId: req.params.id } });
        await prisma.agent.delete({ where: { id: req.params.id } });

        res.json({
            message: 'Agent deleted successfully.',
            agentId: req.params.id,
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

export default router;
