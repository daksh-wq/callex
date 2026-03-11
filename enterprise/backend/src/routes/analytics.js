import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

// GET /api/analytics - Get call logs (with advanced filtering + disposition/recording)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 50, sentiment, minDuration, disposition } = req.query;

        const where = {};
        if (sentiment) where.sentiment = sentiment;
        if (minDuration) where.duration = { gte: parseInt(minDuration, 10) };
        if (disposition) where.dispositionId = disposition;

        const calls = await prisma.call.findMany({
            where,
            orderBy: { startedAt: 'desc' },
            skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
            take: parseInt(limit, 10),
            include: { agent: true, campaign: true, disposition: true, Recording: true, QAScore: true }
        });
        const total = await prisma.call.count({ where });
        res.json({ calls, total });
    } catch (error) {
        console.error("Error fetching calls:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /api/analytics/calls/:id - detailed call with ACW
router.get('/calls/:id', async (req, res) => {
    const call = await prisma.call.findUnique({
        where: { id: req.params.id },
        include: { agent: { select: { name: true } } }
    });
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
});

// POST /api/analytics/calls/:id/acw - trigger LLM summarization (REAL Gemini 2.5 Flash implementation)
import { GoogleGenAI } from '@google/genai';

router.post('/calls/:id/acw', async (req, res) => {
    try {
        const call = await prisma.call.findUnique({ where: { id: req.params.id } });
        if (!call) return res.status(404).json({ error: 'Call not found' });

        const rawTranscript = call.transcript || 'No transcript available.';

        // Strip PII (Basic regex redaction)
        const redactedMsg = rawTranscript
            .replace(/\b\d{10,}\b/g, '[REDACTED PHONE]')
            .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '****-****-****-****');

        // Check if API key is provided
        if (!process.env.GEMINI_API_KEY) {
            console.warn('[ACW] GEMINI_API_KEY missing - falling back to basic summary');
            return res.json(await prisma.call.update({
                where: { id: req.params.id },
                data: {
                    summary: `System Auto-Summary: Call with ${call.phoneNumber} lasted ${call.duration}s.`,
                    redactedTranscript: redactedMsg
                }
            }));
        }

        // Initialize Gemini
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const prompt = `
Analyze this call transcript between an AI agent and a customer.
Transcript:
---
${redactedMsg}
---

Return ONLY raw strict JSON containing:
1. "summary": A concise 2-sentence executive summary.
2. "intent": The primary reason for the call (e.g. "recharge_inquiry", "objection", "pricing").
3. "agreed": boolean (true if customer agreed to the main goal).
4. "followUpRequired": boolean.
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: "You are an expert Q&A Call Center Analyst.",
                temperature: 0.2
            }
        });

        // Clean JSON formatting
        let jsonText = response.text || "{}";
        jsonText = jsonText.replace(/```json/gi, '').replace(/```/g, '').trim();

        let structured = {};
        try {
            structured = JSON.parse(jsonText);
        } catch (e) {
            console.warn("[ACW] Failed to parse JSON from AI, using raw text", jsonText);
            structured = { summary: jsonText.substring(0, 200) };
        }

        // Update Database
        const updated = await prisma.call.update({
            where: { id: req.params.id },
            data: {
                summary: structured.summary || 'Summary unavailable.',
                structuredData: JSON.stringify({
                    intent: structured.intent || 'unknown',
                    agreed: structured.agreed || false,
                    followUpRequired: structured.followUpRequired || false
                }),
                redactedTranscript: redactedMsg
            }
        });

        res.json(updated);
    } catch (err) {
        console.error('[ACW Error]', err);
        res.status(500).json({ error: 'AI Summarization failed' });
    }
});

// GET /api/analytics/stats - aggregate stats
router.get('/stats', async (req, res) => {
    const total = await prisma.call.count();
    const completed = await prisma.call.count({ where: { status: 'completed' } });
    const sentiment = {
        positive: await prisma.call.count({ where: { sentiment: 'positive' } }),
        neutral: await prisma.call.count({ where: { sentiment: 'neutral' } }),
        negative: await prisma.call.count({ where: { sentiment: 'negative' } }),
        angry: await prisma.call.count({ where: { sentiment: 'angry' } }),
    };
    res.json({ total, completed, sentiment });
});

export default router;
