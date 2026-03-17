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

        let query = db.collection('agents').where('userId', '==', req.apiUser.userId);
        const snap = await query.get();
        let agents = queryToArray(snap);
        if (status) agents = agents.filter(a => a.status === status);

        // Sort by createdAt descending
        agents.sort((a, b) => {
            const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return tb - ta;
        });

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
            voice: voice || 'MF4J4IDTRo0AxOO4dpFR', language: language || 'en-US', sttEngine: sttEngine || 'callex-1.1', llmModel: llmModel || 'callex-1.3',
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
        const pvSnap = await db.collection('promptVersions').where('agentId', '==', req.params.id).get();
        const versions = queryToArray(pvSnap);
        versions.sort((a, b) => (b.version || 0) - (a.version || 0));
        agent.PromptVersion = versions;
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

// ═══════════════════════════════════════════════
// CALLS API
// ═══════════════════════════════════════════════

// GET /v1/calls — List calls (paginated)
router.get('/calls', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const status = req.query.status;
        const agentId = req.query.agentId;
        const apiUserId = req.apiUser.userId;

        console.log(`[EXT-API] GET /v1/calls — apiUserId: ${apiUserId}, status: ${status || 'any'}, agentId: ${agentId || 'any'}`);

        // 1. Get calls directly owned by this user
        const directSnap = await db.collection('calls').where('userId', '==', apiUserId).get();
        let calls = queryToArray(directSnap);
        console.log(`[EXT-API] Direct userId match: ${calls.length} calls`);

        // 2. Fallback: also get calls that belong to this user's agents but lack userId
        const agentsSnap = await db.collection('agents').where('userId', '==', apiUserId).get();
        const userAgentIds = agentsSnap.docs.map(d => d.id);
        console.log(`[EXT-API] User owns ${userAgentIds.length} agents: [${userAgentIds.join(', ')}]`);

        if (userAgentIds.length > 0) {
            const existingCallIds = new Set(calls.map(c => c.id));
            // Query in chunks of 30 (Firestore 'in' limit)
            for (let i = 0; i < userAgentIds.length; i += 30) {
                const chunk = userAgentIds.slice(i, i + 30);
                const agentCallsSnap = await db.collection('calls').where('agentId', 'in', chunk).get();
                agentCallsSnap.forEach(doc => {
                    if (!existingCallIds.has(doc.id)) {
                        calls.push({ id: doc.id, ...doc.data() });
                        existingCallIds.add(doc.id);
                    }
                });
            }
            console.log(`[EXT-API] After agent fallback: ${calls.length} total calls`);
        }

        // Also include any calls without userId AND without agentId (orphaned calls)
        // These won't be caught by either query above

        // Filter by status
        if (status) calls = calls.filter(c => c.status === status);
        // Filter by agent
        if (agentId) calls = calls.filter(c => c.agentId === agentId);

        // Sort by startedAt descending
        calls.sort((a, b) => {
            const ta = a.startedAt?.toDate ? a.startedAt.toDate().getTime() : new Date(a.startedAt || 0).getTime();
            const tb = b.startedAt?.toDate ? b.startedAt.toDate().getTime() : new Date(b.startedAt || 0).getTime();
            return tb - ta;
        });

        const total = calls.length;
        const paginated = calls.slice((page - 1) * limit, page * limit).map(c => ({
            id: c.id,
            phoneNumber: c.phoneNumber || '',
            agentId: c.agentId || '',
            agentName: c.agentName || '',
            status: c.status || 'unknown',
            duration: c.duration || 0,
            sentiment: c.sentiment || 'neutral',
            hasTranscript: !!(c.transcript && c.transcript.length > 0),
            hasRecording: !!(c.recordingUrl || c.recordingFilename),
            recordingUrl: c.recordingUrl || c.recordingFilename || null,
            startedAt: c.startedAt,
            endedAt: c.endedAt || null,
        }));

        console.log(`[EXT-API] Returning ${paginated.length} calls (page ${page}, total ${total})`);
        res.json({ calls: paginated, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (e) {
        console.error('[EXT-API ERROR] GET /v1/calls failed:', e);
        res.status(500).json({ error: 'Failed to list calls' });
    }
});

// GET /v1/calls/:id — Get full call details including transcript
router.get('/calls/:id', async (req, res) => {
    try {
        const doc = await db.collection('calls').doc(req.params.id).get();
        const call = docToObj(doc);
        if (!call) return res.status(404).json({ error: 'Call not found' });

        // Get agent name if available
        let agentName = call.agentName || '';
        if (!agentName && call.agentId) {
            try {
                const agentDoc = await db.collection('agents').doc(call.agentId).get();
                if (agentDoc.exists) agentName = agentDoc.data().name || '';
            } catch (e) { /* ignore */ }
        }

        res.json({
            id: call.id,
            phoneNumber: call.phoneNumber || '',
            agentId: call.agentId || '',
            agentName,
            status: call.status || 'unknown',
            duration: call.duration || 0,
            sentiment: call.sentiment || 'neutral',
            transcript: call.transcript || '',
            transcriptMessages: call.transcriptMessages || [],
            recordingUrl: call.recordingUrl || call.recordingFilename || null,
            summary: call.summary || null,
            outcome: call.outcome || null,
            startedAt: call.startedAt,
            endedAt: call.endedAt || null,
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to retrieve call' });
    }
});

// GET /v1/calls/:id/transcript — Get just the transcript for a call
router.get('/calls/:id/transcript', async (req, res) => {
    try {
        const doc = await db.collection('calls').doc(req.params.id).get();
        const call = docToObj(doc);
        if (!call) return res.status(404).json({ error: 'Call not found' });

        res.json({
            callId: call.id,
            transcript: call.transcript || '',
            messages: call.transcriptMessages || [],
            messageCount: (call.transcriptMessages || []).length,
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to retrieve transcript' });
    }
});

// ═══════════════════════════════════════════════
// VOICES API
// ═══════════════════════════════════════════════

// GET /v1/voices — List all available Callex voices
router.get('/voices', async (req, res) => {
    try {
        const voices = [
            {
                id: 'MF4J4IDTRo0AxOO4dpFR',
                name: 'Devi',
                description: 'Clear Hindi female voice — crisp and natural',
                language: 'hi-IN',
                gender: 'female',
                style: 'professional',
                isDefault: true,
            },
            {
                id: '1qEiC6qsybMkmnNdVMbK',
                name: 'Monika',
                description: 'Modulated professional female voice',
                language: 'hi-IN',
                gender: 'female',
                style: 'professional',
                isDefault: false,
            },
            {
                id: 'qDuRKMlYmrm8trt5QyBn',
                name: 'Taksh',
                description: 'Powerful and commanding male voice',
                language: 'hi-IN',
                gender: 'male',
                style: 'authoritative',
                isDefault: false,
            },
            {
                id: 'LQ2auZHpAQ9h4azztqMT',
                name: 'Parveen',
                description: 'Confident male voice — warm and persuasive',
                language: 'hi-IN',
                gender: 'male',
                style: 'confident',
                isDefault: false,
            },
            {
                id: 's6cZdgI3j07hf4frz4Q8',
                name: 'Arvi',
                description: 'Desi conversational female voice — friendly and casual',
                language: 'hi-IN',
                gender: 'female',
                style: 'conversational',
                isDefault: false,
            },
        ];

        res.json({ voices, total: voices.length });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to list voices' });
    }
});

// ═══════════════════════════════════════════════
// SUPERVISOR API (LIVE CALLS)
// ═══════════════════════════════════════════════

// GET /v1/supervisor/calls — List all active calls
router.get('/supervisor/calls', async (req, res) => {
    try {
        const apiUserId = req.apiUser.userId;
        console.log(`[EXT-API] GET /v1/supervisor/calls — apiUserId: ${apiUserId}`);

        // Query active calls only (single field) to avoid composite index requirement
        const activeSnap = await db.collection('calls').where('status', '==', 'active').get();
        console.log(`[EXT-API] Total active calls in DB: ${activeSnap.size}`);

        // Get this user's agent IDs for fallback matching
        const agentsSnap = await db.collection('agents').where('userId', '==', apiUserId).get();
        const userAgentIds = new Set(agentsSnap.docs.map(d => d.id));
        console.log(`[EXT-API] User owns ${userAgentIds.size} agents: [${[...userAgentIds].join(', ')}]`);

        const calls = [];
        for (const doc of activeSnap.docs) {
            const callData = doc.data();
            // Include call if: userId matches OR call belongs to user's agent
            const userIdMatch = callData.userId === apiUserId;
            const agentMatch = callData.agentId && userAgentIds.has(callData.agentId);

            if (!userIdMatch && !agentMatch) continue;

            const call = { id: doc.id, ...callData };
            if (call.agentId && !call.agentName) {
                try {
                    const agentDoc = await db.collection('agents').doc(call.agentId).get();
                    if (agentDoc.exists) call.agentName = agentDoc.data().name;
                } catch (e) { /* ignore */ }
            }
            calls.push({
                id: call.id,
                phoneNumber: call.phoneNumber || '',
                agentId: call.agentId || '',
                agentName: call.agentName || 'Unknown Agent',
                status: call.status || 'active',
                sentiment: call.sentiment || 'neutral',
                startedAt: call.startedAt
            });
        }
        calls.sort((a, b) => {
            const da = a.startedAt?.toDate ? a.startedAt.toDate().getTime() : new Date(a.startedAt || 0).getTime();
            const db2 = b.startedAt?.toDate ? b.startedAt.toDate().getTime() : new Date(b.startedAt || 0).getTime();
            return db2 - da;
        });
        console.log(`[EXT-API] Returning ${calls.length} active calls for user ${apiUserId}`);
        res.json(calls);
    } catch (e) {
        console.error('[EXT-API ERROR] GET /v1/supervisor/calls failed:', e);
        res.status(500).json({ error: 'Failed to list active calls' });
    }
});

// POST /v1/supervisor/calls/:id/whisper
router.post('/supervisor/calls/:id/whisper', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });
        
        const doc = await db.collection('calls').doc(req.params.id).get();
        const call = docToObj(doc);
        if (!call || call.userId !== req.apiUser.userId) return res.status(404).json({ error: 'Call not found' });
        
        import('../index.js').then(({ broadcastToCall }) => {
            broadcastToCall(req.params.id, { type: 'whisper', message, ts: Date.now() });
        });
        
        const newTranscript = (call.transcript || '') + `\n[SYSTEM WHISPER]: ${message}`;
        await db.collection('calls').doc(req.params.id).update({ transcript: newTranscript });
        res.json({ success: true, message });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to whisper to AI' });
    }
});

// POST /v1/supervisor/calls/:id/barge
router.post('/supervisor/calls/:id/barge', async (req, res) => {
    try {
        const doc = await db.collection('calls').doc(req.params.id).get();
        const call = docToObj(doc);
        if (!call || call.userId !== req.apiUser.userId) return res.status(404).json({ error: 'Call not found' });
        if (call.status !== 'active') return res.status(400).json({ error: 'Cannot barge into a call that is not active' });

        import('../index.js').then(({ broadcastToCall }) => {
            broadcastToCall(req.params.id, { type: 'barge', ts: Date.now() });
        });

        await db.collection('calls').doc(req.params.id).update({ status: 'transferred' });
        await db.collection('systemEvents').add({ type: 'call.barged', message: `API user barged into call ${req.params.id}`, severity: 'warning', meta: '{}', createdAt: new Date() });
        res.json({ success: true });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to barge into call' });
    }
});

// ═══════════════════════════════════════════════
// DASHBOARD API
// ═══════════════════════════════════════════════

// GET /v1/dashboard/kpis
router.get('/dashboard/kpis', async (req, res) => {
    try {
        const agentsSnap = await db.collection('agents').where('userId', '==', req.apiUser.userId).get();
        const agentIds = agentsSnap.docs.map(d => d.id);

        let activeCalls = 0, completedToday = 0, allCalls = [], queueDepth = 0;
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

        if (agentIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < agentIds.length; i += 30) chunks.push(agentIds.slice(i, i + 30));

            for (const chunk of chunks) {
                const callsSnap = await db.collection('calls').where('agentId', 'in', chunk).get();
                callsSnap.forEach(d => {
                    const c = d.data();
                    if (c.userId && c.userId !== req.apiUser.userId) return; // safety check
                    allCalls.push(c);
                    if (c.status === 'active') activeCalls++;
                    if (c.status === 'completed' && c.startedAt && new Date(c.startedAt.toDate ? c.startedAt.toDate() : c.startedAt) >= todayStart) completedToday++;
                });
            }
        }

        const queueSnap = await db.collection('calls').where('status', '==', 'active').where('userId', '==', req.apiUser.userId).get();
        queueSnap.forEach(d => { if (!d.data().agentId) queueDepth++; });

        const avgMOS = allCalls.filter(c => c.mosScore).reduce((a, b, _, arr) => a + b.mosScore / arr.length, 0) || 4.2;
        const angryCount = allCalls.filter(c => c.sentiment === 'angry').length;
        const slaRate = allCalls.length > 0 ? Math.round((1 - angryCount / allCalls.length) * 100) : 100;

        res.json({
            activeCalls, completedToday,
            avgMOS: Math.round(avgMOS * 100) / 100,
            slaPercent: slaRate,
            apiFallbackRate: 0.5,
            aiAgentsAvailable: agentIds.length,
            humanAgentsAvailable: 2,
            queueDepth,
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: 'Failed to metrics' });
    }
});

// ═══════════════════════════════════════════════
// DEBUG API
// ═══════════════════════════════════════════════

// GET /v1/debug/my-identity — Shows which userId is linked to the API key
router.get('/debug/my-identity', async (req, res) => {
    try {
        const apiUserId = req.apiUser.userId;
        const agentsSnap = await db.collection('agents').where('userId', '==', apiUserId).get();
        const agentIds = agentsSnap.docs.map(d => d.id);
        const callsSnap = await db.collection('calls').where('userId', '==', apiUserId).get();

        res.json({
            userId: apiUserId,
            env: req.apiUser.env,
            keyId: req.apiUser.keyId,
            ownedAgents: agentIds.length,
            agentIds,
            callsWithUserId: callsSnap.size,
            message: 'If ownedAgents is 0, your API key may be linked to the wrong user account.'
        });
    } catch (e) {
        console.error('[EXT-API ERROR] GET /v1/debug/my-identity failed:', e);
        res.status(500).json({ error: 'Failed to retrieve identity info' });
    }
});

export default router;
