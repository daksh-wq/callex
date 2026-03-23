import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';
import { requireApiKey } from '../middleware/auth.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max
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
router.post('/agents', upload.single('file'), async (req, res) => {
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

        // If file is uploaded during creation, process knowledge immediately
        if (req.file) {
            const { buffer, mimetype, originalname } = req.file;
            const GEMINI_API_KEY = process.env.GENARTML_SERVER_KEY || process.env.GEMINI_API_KEY;
            
            if (GEMINI_API_KEY) {
                let knowledgeText = '';
                let rawText = await extractFileText(buffer, mimetype, originalname);

                if (rawText) {
                    const { GoogleGenAI } = await import('@google/genai');
                    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
                    const response = await genAI.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: [{
                            role: 'user',
                            parts: [{ text: `You are a Knowledge Extractor for an AI calling agent. Extract ALL useful information from this text content.\n\nOutput a clean, structured knowledge base in this EXACT format:\nKNOWLEDGE BASE:\n[Write all extracted information as clear Q&A pairs, facts, pricing details, product info, policies, etc.]\n\nTOPICS COVERED:\n[Comma-separated list of main topics found]\n\nTOTAL ITEMS:\n[Number]\n\nSAMPLE QUESTIONS:\n[List 5 example customer questions]\n\nHere is the content:\n${rawText}` }]
                        }]
                    });
                    knowledgeText = response.text;
                } else {
                    knowledgeText = await parseDocumentWithGemini(buffer, mimetype, originalname, GEMINI_API_KEY);
                }

                if (knowledgeText && knowledgeText.length > 50) {
                    const topicsMatch = knowledgeText.match(/TOPICS COVERED:\s*\n?(.*?)(?:\n\n|\nTOTAL|\nSAMPLE)/s);
                    const totalMatch = knowledgeText.match(/TOTAL ITEMS:\s*\n?(\d+)/);
                    const sampleMatch = knowledgeText.match(/SAMPLE QUESTIONS:\s*\n?([\s\S]*?)$/);
                    const knowledgeMatch = knowledgeText.match(/KNOWLEDGE BASE:\s*\n?([\s\S]*?)(?:\nTOPICS COVERED)/);

                    data.knowledgeTopics = topicsMatch ? topicsMatch[1].trim().split(',').map(t => t.trim()).filter(Boolean) : [];
                    data.knowledgeBase = knowledgeMatch ? knowledgeMatch[1].trim() : knowledgeText;
                    
                    data.trainingSummary = {
                        agentName: data.name,
                        purpose: data.description || 'General purpose calling agent',
                        openingLine: data.openingLine || '',
                        knowledgeTopics: data.knowledgeTopics,
                        totalFaqs: totalMatch ? parseInt(totalMatch[1]) : 0,
                        sampleQuestions: sampleMatch ? sampleMatch[1].trim().split('\n').map(q => q.replace(/^[-\d.)\s]+/, '').trim()).filter(q => q.length > 5).slice(0, 5) : [],
                        lastTrainedAt: new Date().toISOString(),
                        lastTrainedFile: originalname,
                        hasSystemPrompt: !!(data.systemPrompt && data.systemPrompt.length > 10),
                        hasKnowledgeBase: true,
                    };
                }
            }
        }

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
// KNOWLEDGE UPLOAD (Agent Training from PDF/Excel/CSV/TXT)
// ═══════════════════════════════════════════════

/**
 * Helper: Extract raw text from uploaded file buffer based on MIME type.
 * Supports PDF (via Gemini vision), Excel, CSV, and plain text.
 */
async function extractFileText(fileBuffer, mimetype, originalname) {
    const textContent = [];

    // ── Plain Text / CSV ──
    if (mimetype === 'text/plain' || mimetype === 'text/csv' || originalname.endsWith('.csv') || originalname.endsWith('.txt')) {
        return fileBuffer.toString('utf-8');
    }

    // ── Excel (.xlsx, .xls) ──
    if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimetype === 'application/vnd.ms-excel' ||
        originalname.endsWith('.xlsx') || originalname.endsWith('.xls')) {
        // Parse Excel using a simple row-by-row extraction
        // We'll send the base64 to Gemini for intelligent parsing
        return null; // Signal to use Gemini vision for Excel too
    }

    // ── PDF ──
    if (mimetype === 'application/pdf' || originalname.endsWith('.pdf')) {
        return null; // Signal to use Gemini vision
    }

    // ── Unsupported ──
    return null;
}

/**
 * Use Gemini to intelligently parse a document (PDF/Excel/image) into structured knowledge.
 */
async function parseDocumentWithGemini(fileBuffer, mimetype, originalname, apiKey) {
    const { GoogleGenAI } = await import('@google/genai');
    const genAI = new GoogleGenAI({ apiKey });

    const base64Data = fileBuffer.toString('base64');

    // Map common mimetypes for Gemini
    let geminiMime = mimetype;
    if (originalname.endsWith('.xlsx')) geminiMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (originalname.endsWith('.xls')) geminiMime = 'application/vnd.ms-excel';
    if (originalname.endsWith('.csv')) geminiMime = 'text/csv';

    const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
            role: 'user',
            parts: [
                {
                    inlineData: {
                        mimeType: geminiMime,
                        data: base64Data
                    }
                },
                {
                    text: `You are a Knowledge Extractor for an AI calling agent. Extract ALL useful information from this document.

Output a clean, structured knowledge base in this EXACT format:

KNOWLEDGE BASE:
[Write all extracted information as clear Q&A pairs, facts, pricing details, product info, policies, etc. Organize by topic. Use simple language that a phone agent can speak naturally.]

TOPICS COVERED:
[Comma-separated list of main topics found]

TOTAL ITEMS:
[Number of distinct knowledge items/FAQs extracted]

SAMPLE QUESTIONS:
[List 5 example questions a customer might ask that this knowledge can answer]

Rules:
- Extract EVERY piece of information, don't skip anything
- Convert tables/charts into readable text
- Convert pricing into spoken format (e.g., "twenty five lakh rupees" not "₹25L")
- If in Hindi, keep it in Hindi. If English, keep English. If mixed, keep mixed.
- Be thorough — this knowledge will be the agent's entire brain for calls`
                }
            ]
        }]
    });

    return response.text;
}

// POST /v1/agents/:id/knowledge — Upload document to train agent
router.post('/agents/:id/knowledge', upload.single('file'), async (req, res) => {
    try {
        // 1. Verify agent ownership
        const doc = await db.collection('agents').doc(req.params.id).get();
        const existing = docToObj(doc);
        if (!existing || existing.userId !== req.apiUser.userId) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        // 2. Validate file
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded. Send a file with field name "file".' });
        }

        const { buffer, mimetype, originalname, size } = req.file;
        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv', 'text/plain',
        ];
        const allowedExtensions = ['.pdf', '.xlsx', '.xls', '.csv', '.txt'];
        const ext = '.' + originalname.split('.').pop().toLowerCase();

        if (!allowedTypes.includes(mimetype) && !allowedExtensions.includes(ext)) {
            return res.status(400).json({
                error: 'Unsupported file type. Allowed: PDF, Excel (.xlsx/.xls), CSV, TXT',
                received: { mimetype, extension: ext }
            });
        }

        console.log(`[KNOWLEDGE] Processing ${originalname} (${(size / 1024).toFixed(1)}KB) for agent ${req.params.id}`);

        // 3. Extract text content
        const GEMINI_API_KEY = process.env.GENARTML_SERVER_KEY || process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Server configuration error: AI API key not set' });
        }

        let knowledgeText = '';
        let rawText = await extractFileText(buffer, mimetype, originalname);

        if (rawText) {
            // For plain text/CSV, we still send to Gemini for intelligent structuring
            const { GoogleGenAI } = await import('@google/genai');
            const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

            const response = await genAI.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `You are a Knowledge Extractor for an AI calling agent. Extract ALL useful information from this text content.

Output a clean, structured knowledge base in this EXACT format:

KNOWLEDGE BASE:
[Write all extracted information as clear Q&A pairs, facts, pricing details, product info, policies, etc.]

TOPICS COVERED:
[Comma-separated list of main topics found]

TOTAL ITEMS:
[Number of distinct knowledge items/FAQs extracted]

SAMPLE QUESTIONS:
[List 5 example questions a customer might ask that this knowledge can answer]

Here is the content:
${rawText}`
                    }]
                }]
            });
            knowledgeText = response.text;
        } else {
            // For PDF/Excel, use Gemini vision to parse the file directly
            knowledgeText = await parseDocumentWithGemini(buffer, mimetype, originalname, GEMINI_API_KEY);
        }

        if (!knowledgeText || knowledgeText.length < 50) {
            return res.status(422).json({ error: 'Could not extract meaningful knowledge from the uploaded file. Please try a different file.' });
        }

        // 4. Parse the structured output to extract metadata
        const topicsMatch = knowledgeText.match(/TOPICS COVERED:\s*\n?(.*?)(?:\n\n|\nTOTAL|\nSAMPLE)/s);
        const totalMatch = knowledgeText.match(/TOTAL ITEMS:\s*\n?(\d+)/);
        const sampleMatch = knowledgeText.match(/SAMPLE QUESTIONS:\s*\n?([\s\S]*?)$/);
        const knowledgeMatch = knowledgeText.match(/KNOWLEDGE BASE:\s*\n?([\s\S]*?)(?:\nTOPICS COVERED)/);

        const topics = topicsMatch ? topicsMatch[1].trim().split(',').map(t => t.trim()).filter(Boolean) : [];
        const totalItems = totalMatch ? parseInt(totalMatch[1]) : 0;
        const sampleQuestions = sampleMatch
            ? sampleMatch[1].trim().split('\n').map(q => q.replace(/^[-\d.)\s]+/, '').trim()).filter(q => q.length > 5).slice(0, 5)
            : [];
        const extractedKnowledge = knowledgeMatch ? knowledgeMatch[1].trim() : knowledgeText;

        // 5. Merge with existing knowledge (append, don't replace)
        const existingKnowledge = existing.knowledgeBase || '';
        const mergedKnowledge = existingKnowledge
            ? `${existingKnowledge}\n\n--- New Knowledge (from ${originalname}) ---\n\n${extractedKnowledge}`
            : extractedKnowledge;

        // 6. Generate training summary
        const trainingSummary = {
            agentName: existing.name,
            purpose: existing.description || 'General purpose calling agent',
            openingLine: existing.openingLine || '',
            knowledgeTopics: [...new Set([...(existing.knowledgeTopics || []), ...topics])],
            totalFaqs: totalItems,
            sampleQuestions,
            lastTrainedAt: new Date().toISOString(),
            lastTrainedFile: originalname,
            hasSystemPrompt: !!(existing.systemPrompt && existing.systemPrompt.length > 10),
            hasKnowledgeBase: true,
        };

        // 7. Save to Firestore
        await db.collection('agents').doc(req.params.id).update({
            knowledgeBase: mergedKnowledge,
            knowledgeTopics: trainingSummary.knowledgeTopics,
            trainingSummary,
            updatedAt: new Date(),
        });

        console.log(`[KNOWLEDGE] ✅ Agent ${req.params.id} trained with ${originalname} (${totalItems} items, ${topics.length} topics)`);

        res.json({
            message: 'Knowledge uploaded and processed successfully',
            trainingSummary,
            knowledgeSize: mergedKnowledge.length,
        });
    } catch (e) {
        console.error('[KNOWLEDGE ERROR]', e);
        res.status(500).json({ error: 'Failed to process knowledge file', details: e.message });
    }
});

// DELETE /v1/agents/:id/knowledge — Clear agent knowledge base
router.delete('/agents/:id/knowledge', async (req, res) => {
    try {
        const doc = await db.collection('agents').doc(req.params.id).get();
        const existing = docToObj(doc);
        if (!existing || existing.userId !== req.apiUser.userId) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        await db.collection('agents').doc(req.params.id).update({
            knowledgeBase: '',
            knowledgeTopics: [],
            trainingSummary: null,
            updatedAt: new Date(),
        });

        res.json({ message: 'Knowledge base cleared successfully' });
    } catch (e) {
        console.error('[KNOWLEDGE ERROR]', e);
        res.status(500).json({ error: 'Failed to clear knowledge base' });
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
        const { status, agentId, startDate, endDate } = req.query;
        const apiUserId = req.apiUser.userId;
        const isSuperAdmin = apiUserId === 'superadmin-hardcoded-id';

        console.log(`[EXT-API] GET /v1/calls — apiUserId: ${apiUserId}, superAdmin: ${isSuperAdmin}, status: ${status || 'any'}, agentId: ${agentId || 'any'}`);

        let callsMap = new Map();

        if (isSuperAdmin) {
            const allSnap = await db.collection('calls').get();
            allSnap.docs.forEach(doc => callsMap.set(doc.id, { id: doc.id, ...doc.data() }));
        } else {
            // 1. Get calls directly owned by this user
            const directSnap = await db.collection('calls').where('userId', '==', apiUserId).get();
            directSnap.docs.forEach(doc => {
                callsMap.set(doc.id, { id: doc.id, ...doc.data() });
            });
            console.log(`[EXT-API] Direct userId match: ${callsMap.size} calls`);

            // 2. Fallback: also get calls that belong to this user's agents but lack userId
            const agentsSnap = await db.collection('agents').where('userId', '==', apiUserId).get();
            const userAgentIds = agentsSnap.docs.map(d => d.id);
            console.log(`[EXT-API] User owns ${userAgentIds.length} agents`);

            if (userAgentIds.length > 0) {
                // Query in chunks of 30 (Firestore 'in' limit)
                for (let i = 0; i < userAgentIds.length; i += 30) {
                    const chunk = userAgentIds.slice(i, i + 30);
                    const agentCallsSnap = await db.collection('calls').where('agentId', 'in', chunk).get();
                    agentCallsSnap.forEach(doc => {
                        if (!callsMap.has(doc.id)) {
                            callsMap.set(doc.id, { id: doc.id, ...doc.data() });
                        }
                    });
                }
            }
        }

        let calls = Array.from(callsMap.values());
        console.log(`[EXT-API] Total calls found (direct + fallback): ${calls.length}`);

        // 3. Filter by status/agentId/date if provided (filtered in memory to avoid complex indexes)
        if (startDate) {
            const startMs = new Date(startDate).getTime();
            if (!isNaN(startMs)) {
                calls = calls.filter(c => {
                    const ts = c.startedAt?.toDate ? c.startedAt.toDate().getTime() : new Date(c.startedAt || 0).getTime();
                    return ts >= startMs;
                });
            }
        }
        if (endDate) {
            const endMs = new Date(endDate).getTime();
            if (!isNaN(endMs)) {
                calls = calls.filter(c => {
                    const ts = c.startedAt?.toDate ? c.startedAt.toDate().getTime() : new Date(c.startedAt || 0).getTime();
                    return ts <= endMs;
                });
            }
        }
        if (status) calls = calls.filter(c => c.status === status);
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
            transcript: c.transcript || '',
            transcriptMessages: c.transcriptMessages || [],
            hasTranscript: !!(c.transcript && c.transcript.length > 0),
            hasRecording: !!(c.recordingUrl || c.recordingFilename),
            recordingUrl: c.recordingUrl || c.recordingFilename || null,
            summary: c.summary || null,
            outcome: c.outcome || null,
            notes: c.notes || null,
            agreed: c.agreed || false,
            commitmentDate: c.commitmentDate || null,
            disposition: c.disposition || c.outcome || 'Unclear',
            structuredData: c.structuredData ? (typeof c.structuredData === 'string' ? JSON.parse(c.structuredData) : c.structuredData) : null,
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

        const userId = req.apiUser.userId;
        const isSuperAdmin = userId === 'superadmin-hardcoded-id';
        let owned = isSuperAdmin || call.userId === userId;
        if (!owned && call.agentId) {
            const agentDoc = await db.collection('agents').doc(call.agentId).get();
            owned = agentDoc.exists && agentDoc.data().userId === userId;
        }
        if (!owned) return res.status(404).json({ error: 'Call not found' });

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
            notes: call.notes || null,
            agreed: call.agreed || false,
            commitmentDate: call.commitmentDate || null,
            disposition: call.disposition || call.outcome || 'Unclear',
            structuredData: call.structuredData ? (typeof call.structuredData === 'string' ? JSON.parse(call.structuredData) : call.structuredData) : null,
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

        // Ownership check
        const userId = req.apiUser.userId;
        const isSuperAdmin = userId === 'superadmin-hardcoded-id';
        let owned = isSuperAdmin || call.userId === userId;
        if (!owned && call.agentId) {
            const agentDoc = await db.collection('agents').doc(call.agentId).get();
            owned = agentDoc.exists && agentDoc.data().userId === userId;
        }
        if (!owned) return res.status(404).json({ error: 'Call not found' });

        const messages = call.transcriptMessages || [];

        res.json({
            callId: call.id,
            phoneNumber: call.phoneNumber || '',
            agentId: call.agentId || '',
            agentName: call.agentName || '',
            duration: call.duration || 0,
            transcript: call.transcript || '',
            messages: messages,
            messageCount: messages.length,
            startedAt: call.startedAt,
            endedAt: call.endedAt || null,
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
        const isSuperAdmin = apiUserId === 'superadmin-hardcoded-id';
        console.log(`[EXT-API] GET /v1/supervisor/calls — apiUserId: ${apiUserId}, isSuperAdmin: ${isSuperAdmin}`);

        // Query active calls only (single field) to avoid composite index requirement
        const activeSnap = await db.collection('calls').where('status', '==', 'active').get();
        console.log(`[EXT-API] Total active calls in DB: ${activeSnap.size}`);

        // Get this user's agent IDs for fallback matching
        const agentsSnap = await db.collection('agents').where('userId', '==', apiUserId).get();
        const userAgentIds = new Set(agentsSnap.docs.map(d => d.id));
        console.log(`[EXT-API] User owns ${userAgentIds.size} agents`);

        const calls = [];
        const now = Date.now();
        const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

        for (const doc of activeSnap.docs) {
            const callData = doc.data();
            
            // Ghost call protection: If call is older than 2 hours, ignore it
            const startedAt = callData.startedAt?.toDate ? callData.startedAt.toDate().getTime() : new Date(callData.startedAt || 0).getTime();
            if (now - startedAt > MAX_AGE_MS) continue;

            // Include call if: userId matches OR call belongs to user's agent OR user is superadmin
            const userIdMatch = callData.userId === apiUserId;
            const agentMatch = callData.agentId && userAgentIds.has(callData.agentId);

            if (!isSuperAdmin && !userIdMatch && !agentMatch) continue;

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
                transcript: call.transcript || '',
                transcriptMessages: call.transcriptMessages || [],
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
        if (!call) return res.status(404).json({ error: 'Call not found' });

        // Ownership check: userId match OR agentId belongs to this user OR user is superadmin
        const userId = req.apiUser.userId;
        const isSuperAdmin = userId === 'superadmin-hardcoded-id';
        let owned = isSuperAdmin || call.userId === userId;
        if (!owned && call.agentId) {
            const agentDoc = await db.collection('agents').doc(call.agentId).get();
            owned = agentDoc.exists && agentDoc.data().userId === userId;
        }
        if (!owned) return res.status(404).json({ error: 'Call not found' });

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
        if (!call) return res.status(404).json({ error: 'Call not found' });
        if (call.status !== 'active') return res.status(400).json({ error: 'Cannot barge into a call that is not active' });

        // Ownership check: userId match OR agentId belongs to this user OR user is superadmin
        const userId = req.apiUser.userId;
        const isSuperAdmin = userId === 'superadmin-hardcoded-id';
        let owned = isSuperAdmin || call.userId === userId;
        if (!owned && call.agentId) {
            const agentDoc = await db.collection('agents').doc(call.agentId).get();
            owned = agentDoc.exists && agentDoc.data().userId === userId;
        }
        if (!owned) return res.status(404).json({ error: 'Call not found' });

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

// ═══════════════════════════════════════════════
// DISPOSITIONS CRUD API
// ═══════════════════════════════════════════════

// GET /v1/dispositions — List all dispositions for this account
router.get('/dispositions', async (req, res) => {
    try {
        const userId = req.apiUser.userId;
        // Get dispositions owned by this user, plus global ones (no userId)
        const snap = await db.collection('dispositions').get();
        let dispositions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Filter: show user's own + global dispositions
        dispositions = dispositions.filter(d => !d.userId || d.userId === userId);
        // Sort by name
        dispositions.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        res.json({ dispositions });
    } catch (e) {
        console.error('[EXT-API ERROR] GET /v1/dispositions:', e);
        res.status(500).json({ error: 'Failed to list dispositions' });
    }
});

// POST /v1/dispositions — Create a new disposition
router.post('/dispositions', async (req, res) => {
    try {
        const { name, category, requiresNote } = req.body;
        if (!name) return res.status(400).json({ error: "Disposition 'name' is required." });

        const data = {
            name,
            category: category || 'General',
            requiresNote: requiresNote || false,
            active: true,
            userId: req.apiUser.userId,
            createdAt: new Date()
        };
        const ref = await db.collection('dispositions').add(data);
        res.status(201).json({ id: ref.id, ...data });
    } catch (e) {
        console.error('[EXT-API ERROR] POST /v1/dispositions:', e);
        res.status(500).json({ error: 'Failed to create disposition' });
    }
});

// GET /v1/dispositions/:id — Get a single disposition by ID
router.get('/dispositions/:id', async (req, res) => {
    try {
        const doc = await db.collection('dispositions').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Disposition not found' });

        const disposition = { id: doc.id, ...doc.data() };
        // Verify ownership: allow if global or user's own
        if (disposition.userId && disposition.userId !== req.apiUser.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json(disposition);
    } catch (e) {
        console.error('[EXT-API ERROR] GET /v1/dispositions/:id:', e);
        res.status(500).json({ error: 'Failed to get disposition' });
    }
});

// PUT /v1/dispositions/:id — Update a disposition
router.put('/dispositions/:id', async (req, res) => {
    try {
        const doc = await db.collection('dispositions').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Disposition not found' });

        const existing = doc.data();
        // Only allow updating own dispositions
        if (existing.userId && existing.userId !== req.apiUser.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { name, category, requiresNote, active } = req.body;
        const updates = { updatedAt: new Date() };
        if (name !== undefined) updates.name = name;
        if (category !== undefined) updates.category = category;
        if (requiresNote !== undefined) updates.requiresNote = requiresNote;
        if (active !== undefined) updates.active = active;

        await db.collection('dispositions').doc(req.params.id).update(updates);
        res.json({ id: req.params.id, ...existing, ...updates });
    } catch (e) {
        console.error('[EXT-API ERROR] PUT /v1/dispositions/:id:', e);
        res.status(500).json({ error: 'Failed to update disposition' });
    }
});

// DELETE /v1/dispositions/:id — Delete a disposition
router.delete('/dispositions/:id', async (req, res) => {
    try {
        const doc = await db.collection('dispositions').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Disposition not found' });

        const existing = doc.data();
        // Only allow deleting own dispositions
        if (existing.userId && existing.userId !== req.apiUser.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.collection('dispositions').doc(req.params.id).delete();
        res.json({ message: 'Disposition deleted successfully', id: req.params.id });
    } catch (e) {
        console.error('[EXT-API ERROR] DELETE /v1/dispositions/:id:', e);
        res.status(500).json({ error: 'Failed to delete disposition' });
    }
});

export default router;
