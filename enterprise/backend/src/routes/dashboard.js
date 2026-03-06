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
    const slaRate = allCalls.length > 0 ? Math.round((1 - angryCount / allCalls.length) * 100) : 100;

    // Genuine queue depth = active calls not yet assigned an agent
    const queueDepth = await prisma.call.count({ where: { status: 'active', agentId: null } });

    // Count active agents vs human staff fallback
    const aiAgentsAvailable = await prisma.agent.count({ where: { status: 'active' } });
    const errorEvents = await prisma.systemEvent.count({ where: { severity: 'error' } });
    const totalEvents = await prisma.systemEvent.count();
    const fallbackRate = totalEvents > 0 ? (errorEvents / totalEvents) * 100 : 0;

    res.json({
        activeCalls,
        completedToday,
        avgMOS: Math.round(avgMOS * 100) / 100,
        slaPercent: slaRate,
        apiFallbackRate: Math.round(fallbackRate * 10) / 10,
        aiAgentsAvailable,
        humanAgentsAvailable: 2, // Hardcoded human floor for UI
        queueDepth,
    });
});

// GET /api/dashboard/ab-test - A/B test comparison
router.get('/ab-test', async (req, res) => {
    const calls = await prisma.call.findMany({
        where: { status: 'completed', agentId: { not: null } },
        include: { agent: { select: { llmModel: true } } }
    });

    const stats = {};
    for (const c of calls) {
        if (!c.agent) continue;
        const model = c.agent.llmModel;
        if (!stats[model]) stats[model] = { calls: 0, durationSum: 0, mosSum: 0, conversions: 0 };
        stats[model].calls++;
        stats[model].durationSum += c.duration || 0;
        stats[model].mosSum += c.mosScore || 0;
        if (c.sentiment === 'positive') stats[model].conversions++;
    }

    const models = Object.keys(stats).sort((a, b) => stats[b].calls - stats[a].calls);
    if (models.length < 2) {
        // Not enough real data for A/B, return zeroes
        return res.json({
            champion: { model: 'Callex-1.3', csat: 0, avgDuration: 0, conversions: 0, calls: 0 },
            challenger: { model: 'Callex-1.2', csat: 0, avgDuration: 0, conversions: 0, calls: 0 },
            winner: 'none', confidence: 0
        });
    }

    const m1 = models[0]; const m2 = models[1];
    const calc = (m) => ({
        model: m,
        csat: stats[m].calls > 0 ? (stats[m].mosSum / stats[m].calls).toFixed(1) : 0,
        avgDuration: stats[m].calls > 0 ? Math.round(stats[m].durationSum / stats[m].calls) : 0,
        conversions: stats[m].conversions,
        calls: stats[m].calls
    });

    const champ = calc(m1);
    const chal = calc(m2);
    const winner = parseFloat(champ.csat) >= parseFloat(chal.csat) ? 'champion' : 'challenger';

    res.json({
        champion: champ,
        challenger: chal,
        winner,
        confidence: Math.min(99, 50 + (stats[m1].calls + stats[m2].calls)),
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
