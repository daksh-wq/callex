import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/agents
router.get('/', async (req, res) => {
    const snap = await db.collection('agents').where('userId', '==', req.userId).get();
    const agents = queryToArray(snap);
    agents.sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
        return tb - ta;
    });
    res.json(agents);
});

// GET /api/agents/:id
router.get('/:id', async (req, res) => {
    const doc = await db.collection('agents').doc(req.params.id).get();
    const agent = docToObj(doc);
    if (!agent || agent.userId !== req.userId) return res.status(404).json({ error: 'Agent not found' });
    // Get prompt versions
    const pvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).get();
    const versions = queryToArray(pvSnap);
    versions.sort((a, b) => (b.version || 0) - (a.version || 0));
    agent.PromptVersion = versions;
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

    const data = {
        userId: req.userId,
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
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const ref = await db.collection('agents').add(data);
    const agent = { id: ref.id, ...data };

    await db.collection('promptVersions').add({
        agentId: ref.id, version: 1, prompt: systemPrompt || '', isActive: true, label: 'v1 - Initial', createdAt: new Date()
    });

    res.json(agent);
});

// PATCH /api/agents/:id
router.patch('/:id', async (req, res) => {
    const doc = await db.collection('agents').doc(req.params.id).get();
    const existing = docToObj(doc);
    if (!existing || existing.userId !== req.userId) return res.status(404).json({ error: 'Agent not found' });

    const data = { ...req.body, updatedAt: new Date() };
    if (data.fillerPhrases && Array.isArray(data.fillerPhrases)) data.fillerPhrases = JSON.stringify(data.fillerPhrases);
    if (data.ipaLexicon && typeof data.ipaLexicon === 'object') data.ipaLexicon = JSON.stringify(data.ipaLexicon);
    if (data.tools && Array.isArray(data.tools)) data.tools = JSON.stringify(data.tools);
    delete data.id;

    await db.collection('agents').doc(req.params.id).update(data);
    const updated = await db.collection('agents').doc(req.params.id).get();
    res.json(docToObj(updated));
});

// DELETE /api/agents/:id
router.delete('/:id', async (req, res) => {
    try {
        const doc = await db.collection('agents').doc(req.params.id).get();
        const existing = docToObj(doc);
        if (!existing || existing.userId !== req.userId) return res.status(404).json({ error: 'Agent not found' });

        // Delete related records to prevent orphaned data
        const pvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).get();
        const fuSnap = await db.collection('followUps').where('agentId', '==', req.params.id).get();
        
        const batch = db.batch();
        pvSnap.forEach(d => batch.delete(d.ref));
        fuSnap.forEach(d => batch.delete(d.ref));
        batch.delete(db.collection('agents').doc(req.params.id));
        
        await batch.commit();

        res.json({ success: true });
    } catch (e) {
        console.error('[AGENTS] Delete error:', e);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

// POST /api/agents/:id/prompt-version
router.post('/:id/prompt-version', async (req, res) => {
    const { prompt, label } = req.body;
    const pvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).orderBy('version', 'desc').limit(1).get();
    const lastVersion = pvSnap.empty ? 0 : pvSnap.docs[0].data().version;
    const version = lastVersion + 1;

    // Deactivate all previous
    const allPvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).get();
    const batch = db.batch();
    allPvSnap.forEach(d => batch.update(d.ref, { isActive: false }));

    const pvData = { agentId: req.params.id, version, prompt, label: label || `v${version}`, isActive: true, createdAt: new Date() };
    const pvRef = db.collection('promptVersions').doc();
    batch.set(pvRef, pvData);
    await batch.commit();

    res.json({ id: pvRef.id, ...pvData });
});

// GET /api/agents/:id/prompt-versions
router.get('/:id/prompt-versions', async (req, res) => {
    const snap = await db.collection('promptVersions').where('agentId', '==', req.params.id).orderBy('version', 'desc').get();
    res.json(queryToArray(snap));
});

// PATCH /api/agents/:id/status
router.patch('/:id/status', async (req, res) => {
    const { status } = req.body;
    await db.collection('agents').doc(req.params.id).update({ status, updatedAt: new Date() });
    const doc = await db.collection('agents').doc(req.params.id).get();
    res.json(docToObj(doc));
});

// POST /api/agents/tts-preview
router.post('/tts-preview', async (req, res) => {
    try {
        const { voiceId, prosodyRate, prosodyPitch } = req.body;
        if (!voiceId) return res.status(400).json({ error: 'Voice ID required' });

        let stability = 0.5, similarity = 0.5;
        if (prosodyRate > 1.2 || prosodyPitch > 1.2) stability = 0.3;
        if (prosodyRate < 0.8 || prosodyPitch < 0.8) stability = 0.8;

        const legacyVoiceMap = {
            'alloy': 'MF4J4IDTRo0AxOO4dpFR', 'echo': '1qEiC6qsybMkmnNdVMbK',
            'fable': 'qDuRKMlYmrm8trt5QyBn', 'onyx': 'LQ2auZHpAQ9h4azztqMT',
            'nova': 's6cZdgI3j07hf4frz4Q8', 'shimmer': 'MF4J4IDTRo0AxOO4dpFR'
        };
        const resolvedVoiceId = legacyVoiceMap[voiceId] || voiceId;
        const defaultVoiceId = 'MF4J4IDTRo0AxOO4dpFR';
        const ttsPayload = {
            text: "नमस्ते, मैं Callex हूँ। मैं आपकी कैसे मदद कर सकता हूँ?",
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability, similarity_boost: similarity }
        };

        let response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/stream`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg', 'Content-Type': 'application/json',
                'xi-api-key': 'ebc0cf6c4dd6f63022db2cbb3bb2323268e4ad660d19038e11e897d175345d39'
            },
            body: JSON.stringify(ttsPayload)
        });

        // Production fallback: if voice ID invalid, retry with default Callex voice
        if (!response.ok) {
            console.log(`[Callex Voice Engine] Voice ${resolvedVoiceId} failed (${response.status}), falling back to default...`);
            response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${defaultVoiceId}/stream`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg', 'Content-Type': 'application/json',
                    'xi-api-key': 'ebc0cf6c4dd6f63022db2cbb3bb2323268e4ad660d19038e11e897d175345d39'
                },
                body: JSON.stringify(ttsPayload)
            });
        }

        if (!response.ok) { const errText = await response.text(); throw new Error(`Voice Engine Error: ${response.status} ${errText}`); }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        for await (const chunk of response.body) { res.write(chunk); }
        res.end();
    } catch (e) {
        console.error("TTS Preview Error:", e);
        res.status(500).json({ error: 'Failed to generate TTS preview' });
    }
});

// POST /api/agents/clone-voice
router.post('/clone-voice', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
        const formData = new FormData();
        formData.append('name', req.body.name || 'Cloned Dashboard Voice');
        formData.append('description', 'Instant Voice Clone created via Agent Studio');
        const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
        formData.append('files', audioBlob, req.file.originalname || 'clone.mp3');

        const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
            method: 'POST',
            headers: { 'xi-api-key': process.env.CALLEX_VOICE_API_KEY || 'ebc0cf6c4dd6f63022db2cbb3bb2323268e4ad660d19038e11e897d175345d39' },
            body: formData
        });
        if (!response.ok) { const errText = await response.text(); throw new Error(`Voice Engine Error: ${response.status} ${errText}`); }
        const data = await response.json();
        res.json({ voiceId: data.voice_id });
    } catch (e) {
        console.error("Voice Cloning Error:", e);
        res.status(500).json({ error: 'Failed to clone voice' });
    }
});

export default router;
