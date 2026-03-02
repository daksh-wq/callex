import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

// GET /api/agents
router.get('/', async (req, res) => {
    const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(agents);
});

// GET /api/agents/:id
router.get('/:id', async (req, res) => {
    const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
        include: { PromptVersion: { orderBy: { version: 'desc' } } }
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
});

// POST /api/agents
router.post('/', async (req, res) => {
    const { name, description, systemPrompt, openingLine, voice, language, sttEngine, llmModel,
        fillerPhrases, prosodyRate, prosodyPitch, ipaLexicon, tools, topK, similarityThresh,
        fallbackMessage, profanityFilter, topicRestriction, backgroundAmbience, speakingStyle,
        bargeInMode, patienceMs, maxDuration, temperature, maxTokens, strictToolCalling,
        ringTimeout, voicemailLogic, webhookUrl, autoSummary, autoSentiment, recordCall, processDtmf,
        amdPrecision, voicemailDropAudio, sentimentRouting, competitorAlerts, supervisorWhisper,
        piiRedaction, geoCallerId, multiAgentHandoff, objectionHandling, emotionalMirroring,
        complianceScript, dynamicCodeSwitching, dncLitigatorScrub, callBlending, costCapTokens,
        postCallSms, autoFollowUp, followUpDefaultDays, followUpDefaultTime
    } = req.body;
    const agent = await prisma.agent.create({
        data: {
            name, description, systemPrompt, openingLine, voice: voice || 'alloy',
            language: language || 'en-US', sttEngine: sttEngine || 'callex-1.1',
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
    await prisma.promptVersion.create({ data: { agentId: agent.id, version: 1, prompt: systemPrompt || '', isActive: true, label: 'v1 - Initial' } });
    res.json(agent);
});

// PATCH /api/agents/:id
router.patch('/:id', async (req, res) => {
    const data = { ...req.body };
    if (data.fillerPhrases && Array.isArray(data.fillerPhrases)) data.fillerPhrases = JSON.stringify(data.fillerPhrases);
    if (data.ipaLexicon && typeof data.ipaLexicon === 'object') data.ipaLexicon = JSON.stringify(data.ipaLexicon);
    if (data.tools && Array.isArray(data.tools)) data.tools = JSON.stringify(data.tools);
    const agent = await prisma.agent.update({ where: { id: req.params.id }, data });
    res.json(agent);
});

// DELETE /api/agents/:id
router.delete('/:id', async (req, res) => {
    await prisma.agent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// POST /api/agents/:id/prompt-version - save new prompt version
router.post('/:id/prompt-version', async (req, res) => {
    const { prompt, label } = req.body;
    const last = await prisma.promptVersion.findFirst({ where: { agentId: req.params.id }, orderBy: { version: 'desc' } });
    const version = (last?.version || 0) + 1;
    // Deactivate all previous
    await prisma.promptVersion.updateMany({ where: { agentId: req.params.id }, data: { isActive: false } });
    const pv = await prisma.promptVersion.create({ data: { agentId: req.params.id, version, prompt, label: label || `v${version}`, isActive: true } });
    res.json(pv);
});

// GET /api/agents/:id/prompt-versions
router.get('/:id/prompt-versions', async (req, res) => {
    const versions = await prisma.promptVersion.findMany({ where: { agentId: req.params.id }, orderBy: { version: 'desc' } });
    res.json(versions);
});

// PATCH /api/agents/:id/status
router.patch('/:id/status', async (req, res) => {
    const { status } = req.body;
    const agent = await prisma.agent.update({ where: { id: req.params.id }, data: { status } });
    res.json(agent);
});

export default router;
