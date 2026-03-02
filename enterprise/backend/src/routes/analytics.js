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

// POST /api/analytics/calls/:id/acw - trigger LLM summarization (mocked)
router.post('/calls/:id/acw', async (req, res) => {
    const call = await prisma.call.findUnique({ where: { id: req.params.id } });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const summary = `Executive Summary: Call with ${call.phoneNumber} lasted ${call.duration || 'N/A'}s. Customer sentiment: ${call.sentiment}. Agent handled the query professionally.`;
    const structuredData = JSON.stringify({
        intent: 'recharge_inquiry',
        amount: '₹200',
        agreed: call.sentiment === 'positive',
        followUpRequired: call.sentiment === 'angry',
    });
    const redacted = (call.transcript || '').replace(/\d{10,}/g, '[REDACTED]').replace(/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g, '****-****-****-****');

    const updated = await prisma.call.update({
        where: { id: req.params.id },
        data: { summary, structuredData, redactedTranscript: redacted }
    });
    res.json(updated);
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
