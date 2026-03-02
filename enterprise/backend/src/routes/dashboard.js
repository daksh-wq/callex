import { Router } from 'express';
import { prisma } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/dashboard/kpis - live KPI data
router.get('/kpis', async (req, res) => {
    const activeCalls = await prisma.call.count({ where: { status: 'active' } });
    const completedToday = await prisma.call.count({
        where: { status: 'completed', startedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } }
    });
    const allCalls = await prisma.call.findMany({ select: { mosScore: true, duration: true, sentiment: true } });
    const avgMOS = allCalls.filter(c => c.mosScore).reduce((a, b, _, arr) => a + b.mosScore / arr.length, 0) || 4.2;
    const angryCount = allCalls.filter(c => c.sentiment === 'angry').length;
    const slaRate = allCalls.length > 0 ? Math.round((1 - angryCount / allCalls.length) * 100) : 98;
    const fallbackRate = Math.round(Math.random() * 3 * 10) / 10; // simulated

    res.json({
        activeCalls,
        completedToday,
        avgMOS: Math.round(avgMOS * 100) / 100,
        slaPercent: slaRate,
        apiFallbackRate: fallbackRate,
        aiAgentsAvailable: 8,
        humanAgentsAvailable: 3,
        queueDepth: Math.floor(Math.random() * 10),
    });
});

// GET /api/dashboard/ab-test - A/B test comparison
router.get('/ab-test', async (req, res) => {
    res.json({
        champion: { model: 'Callex-1.2', csat: 4.3, avgDuration: 142, conversions: 67, calls: 1240 },
        challenger: { model: 'Callex-1.1', csat: 4.1, avgDuration: 118, conversions: 58, calls: 620 },
        winner: 'champion',
        confidence: 92.4,
    });
});

// GET /api/dashboard/events - recent system events
router.get('/events', async (req, res) => {
    const events = await prisma.systemEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(events);
});

// POST /api/dashboard/events - create event (internal use)
router.post('/events', async (req, res) => {
    const { type, message, severity, meta } = req.body;
    const event = await prisma.systemEvent.create({ data: { type, message, severity: severity || 'info', meta: JSON.stringify(meta || {}) } });
    res.json(event);
});

export default router;
