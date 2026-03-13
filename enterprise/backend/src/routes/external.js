import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';
import { requireApiKey } from '../middleware/auth.js';

const router = Router();
router.use(requireApiKey);

// GET /v1/agents
router.get('/agents', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const status = req.query.status;

        let query = db.collection('agents').where('userId', '==', req.apiUser.userId).orderBy('createdAt', 'desc');
        const snap = await query.get();
        let agents = queryToArray(snap);
        if (status) agents = agents.filter(a => a.status === status);

        const total = agents.length;
        const paginated = agents.slice((page - 1) * limit, page * limit);

        res.json({ agents: paginated, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to list agents' });
    }
});

// POST /v1/agents
router.post('/agents', async (req, res) => {
    try {
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

        if (!name) return res.status(400).json({ error: "Agent 'name' is required." });

        const data = {
            userId: req.apiUser.userId, name, description: description || '', systemPrompt: systemPrompt || '', openingLine: openingLine || '',
            voice: voice || 'alloy', language: language || 'en-US', sttEngine: sttEngine || 'callex-1.1', llmModel: llmModel || 'callex-1.3',
            fillerPhrases: JSON.stringify(fillerPhrases || ['Let me check...', 'One moment...']),
            prosodyRate: prosodyRate || 1.0, prosodyPitch: prosodyPitch || 1.0,
            ipaLexicon: JSON.stringify(ipaLexicon || {}), tools: JSON.stringify(tools || []),
            topK: topK || 5, similarityThresh: similarityThresh || 0.75,
            fallbackMessage: fallbackMessage || "I'm sorry, I don't have that information right now.",
            profanityFilter: profanityFilter || 'redact', topicRestriction: topicRestriction || false,
            backgroundAmbience: backgroundAmbience || 'none', speakingStyle: speakingStyle || 'professional',
            bargeInMode: bargeInMode || 'balanced', patienceMs: patienceMs || 800, maxDuration: maxDuration || 30,
            temperature: temperature || 0.7, maxTokens: maxTokens || 250, strictToolCalling: strictToolCalling ?? true,
            ringTimeout: ringTimeout || 30, voicemailLogic: voicemailLogic || 'hangup', webhookUrl: webhookUrl || null,
            autoSummary: autoSummary ?? true, autoSentiment: autoSentiment ?? true, recordCall: recordCall ?? true, processDtmf: processDtmf ?? true,
            amdPrecision: amdPrecision || 'balanced', voicemailDropAudio: voicemailDropAudio || null,
            sentimentRouting: sentimentRouting ?? false, competitorAlerts: competitorAlerts || '',
            supervisorWhisper: supervisorWhisper ?? true, piiRedaction: piiRedaction ?? true,
            geoCallerId: geoCallerId ?? false, multiAgentHandoff: multiAgentHandoff ?? false,
            objectionHandling: objectionHandling || 'standard', emotionalMirroring: emotionalMirroring ?? true,
            complianceScript: complianceScript || null, dynamicCodeSwitching: dynamicCodeSwitching ?? true,
            dncLitigatorScrub: dncLitigatorScrub ?? true, callBlending: callBlending ?? false,
            costCapTokens: costCapTokens || 5000, postCallSms: postCallSms || null,
            autoFollowUp: autoFollowUp ?? true, followUpDefaultDays: followUpDefaultDays || 1, followUpDefaultTime: followUpDefaultTime || '10:00',
            status: 'draft', createdAt: new Date(), updatedAt: new Date(),
        };

        const ref = await db.collection('agents').add(data);
        const agent = { id: ref.id, ...data };

        await db.collection('promptVersions').add({ agentId: ref.id, version: 1, prompt: systemPrompt || '', isActive: true, label: 'v1 - Initial', createdAt: new Date() });

        res.status(201).json({ message: "Agent successfully created.", agentId: ref.id, agent });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: "Failed to create agent" });
    }
});

// GET /v1/agents/:id
router.get('/agents/:id', async (req, res) => {
    try {
        const doc = await db.collection('agents').doc(req.params.id).get();
        const agent = docToObj(doc);
        if (!agent || agent.userId !== req.apiUser.userId) return res.status(404).json({ error: 'Agent not found' });
        const pvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).orderBy('version', 'desc').get();
        agent.PromptVersion = queryToArray(pvSnap);
        res.json(agent);
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: "Failed to retrieve agent" });
    }
});

// PUT /v1/agents/:id
router.put('/agents/:id', async (req, res) => {
    try {
        const doc = await db.collection('agents').doc(req.params.id).get();
        const existing = docToObj(doc);
        if (!existing || existing.userId !== req.apiUser.userId) return res.status(404).json({ error: 'Agent not found' });

        const data = { ...req.body, updatedAt: new Date() };
        if (data.fillerPhrases && Array.isArray(data.fillerPhrases)) data.fillerPhrases = JSON.stringify(data.fillerPhrases);
        if (data.ipaLexicon && typeof data.ipaLexicon === 'object') data.ipaLexicon = JSON.stringify(data.ipaLexicon);
        if (data.tools && Array.isArray(data.tools)) data.tools = JSON.stringify(data.tools);
        delete data.id; delete data.createdAt;

        await db.collection('agents').doc(req.params.id).update(data);
        const updated = await db.collection('agents').doc(req.params.id).get();
        res.json({ message: 'Agent updated successfully.', agentId: req.params.id, agent: docToObj(updated) });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to update agent' });
    }
});

// DELETE /v1/agents/:id
router.delete('/agents/:id', async (req, res) => {
    try {
        const doc = await db.collection('agents').doc(req.params.id).get();
        const existing = docToObj(doc);
        if (!existing || existing.userId !== req.apiUser.userId) return res.status(404).json({ error: 'Agent not found' });

        // Delete related records
        const pvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).get();
        const fuSnap = await db.collection('followUps').where('agentId', '==', req.params.id).get();
        const batch = db.batch();
        pvSnap.forEach(d => batch.delete(d.ref));
        fuSnap.forEach(d => batch.delete(d.ref));
        batch.delete(db.collection('agents').doc(req.params.id));
        await batch.commit();

        res.json({ message: 'Agent deleted successfully.', agentId: req.params.id });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

export default router;
