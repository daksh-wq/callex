import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';

const router = Router();

// GET /api/analytics
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 50, sentiment, minDuration, disposition } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        let query = db.collection('calls').where('userId', '==', req.userId).orderBy('startedAt', 'desc');
        const snap = await query.get();
        let calls = queryToArray(snap);

        // Apply filters in JS (Firestore doesn't support complex compound queries easily)
        if (sentiment) calls = calls.filter(c => c.sentiment === sentiment);
        if (minDuration) calls = calls.filter(c => (c.duration || 0) >= parseInt(minDuration, 10));
        if (disposition) calls = calls.filter(c => c.dispositionId === disposition);

        const total = calls.length;
        const paginated = calls.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        // Enrich with agent/campaign data
        for (const call of paginated) {
            if (call.agentId) {
                const agentDoc = await db.collection('agents').doc(call.agentId).get();
                call.agent = agentDoc.exists ? docToObj(agentDoc) : null;
            }
            if (call.campaignId) {
                const campDoc = await db.collection('campaigns').doc(call.campaignId).get();
                call.campaign = campDoc.exists ? docToObj(campDoc) : null;
            }
        }

        res.json({ calls: paginated, total });
    } catch (error) {
        console.error("Error fetching calls:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /api/analytics/calls/:id
router.get('/calls/:id', async (req, res) => {
    const doc = await db.collection('calls').doc(req.params.id).get();
    const call = docToObj(doc);
    if (!call || call.userId !== req.userId) return res.status(404).json({ error: 'Call not found' });
    if (call.agentId) {
        const agentDoc = await db.collection('agents').doc(call.agentId).get();
        call.agent = agentDoc.exists ? { name: agentDoc.data().name } : null;
    }
    res.json(call);
});

// POST /api/analytics/calls/:id/acw
router.post('/calls/:id/acw', async (req, res) => {
    try {
        const doc = await db.collection('calls').doc(req.params.id).get();
        const call = docToObj(doc);
        if (!call) return res.status(404).json({ error: 'Call not found' });

        const rawTranscript = call.transcript || 'No transcript available.';
        const redactedMsg = rawTranscript
            .replace(/\b\d{10,}\b/g, '[REDACTED PHONE]')
            .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '****-****-****-****');

        if (!process.env.GEMINI_API_KEY) {
            const updateData = { summary: `System Auto-Summary: Call with ${call.phoneNumber} lasted ${call.duration}s.`, redactedTranscript: redactedMsg };
            await db.collection('calls').doc(req.params.id).update(updateData);
            return res.json({ ...call, ...updateData });
        }

        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `Analyze this call transcript between an AI agent and a customer.\nTranscript:\n---\n${redactedMsg}\n---\n\nReturn ONLY raw strict JSON containing:\n1. "summary": A concise 2-sentence executive summary.\n2. "intent": The primary reason for the call.\n3. "agreed": boolean.\n4. "followUpRequired": boolean.`;

        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { systemInstruction: "You are an expert Q&A Call Center Analyst.", temperature: 0.2 } });

        let jsonText = (response.text || "{}").replace(/```json/gi, '').replace(/```/g, '').trim();
        let structured = {};
        try { structured = JSON.parse(jsonText); } catch { structured = { summary: jsonText.substring(0, 200) }; }

        const updateData = {
            summary: structured.summary || 'Summary unavailable.',
            structuredData: JSON.stringify({ intent: structured.intent || 'unknown', agreed: structured.agreed || false, followUpRequired: structured.followUpRequired || false }),
            redactedTranscript: redactedMsg
        };
        await db.collection('calls').doc(req.params.id).update(updateData);
        res.json({ ...call, ...updateData });
    } catch (err) {
        console.error('[ACW Error]', err);
        res.status(500).json({ error: 'AI Summarization failed' });
    }
});

// GET /api/analytics/stats
router.get('/stats', async (req, res) => {
    const snap = await db.collection('calls').get();
    const calls = queryToArray(snap);
    const total = calls.length;
    const completed = calls.filter(c => c.status === 'completed').length;
    const sentiment = {
        positive: calls.filter(c => c.sentiment === 'positive').length,
        neutral: calls.filter(c => c.sentiment === 'neutral').length,
        negative: calls.filter(c => c.sentiment === 'negative').length,
        angry: calls.filter(c => c.sentiment === 'angry').length,
    };
    res.json({ total, completed, sentiment });
});

export default router;
