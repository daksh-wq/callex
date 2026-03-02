import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = express.Router();

// GET /api/billing/stats - Get current month billing
router.get('/stats', async (req, res) => {
    try {
        // e.g. "2026-02"
        const currentMonth = new Date().toISOString().substring(0, 7);

        let stat = await prisma.billingStat.findUnique({
            where: { month: currentMonth }
        });

        if (!stat) {
            stat = await prisma.billingStat.create({
                data: { month: currentMonth }
            });
        }
        res.json(stat);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/billing/increment - Internal route to add usage (mock)
router.post('/increment', async (req, res) => {
    try {
        const { telecomMins, llmTokens, sttMinutes, costIncrement } = req.body;
        const currentMonth = new Date().toISOString().substring(0, 7);

        const stat = await prisma.billingStat.upsert({
            where: { month: currentMonth },
            update: {
                telecomMins: { increment: telecomMins || 0 },
                llmTokens: { increment: llmTokens || 0 },
                sttMinutes: { increment: sttMinutes || 0 },
                totalCostUsd: { increment: costIncrement || 0.0 }
            },
            create: {
                month: currentMonth,
                telecomMins: telecomMins || 0,
                llmTokens: llmTokens || 0,
                sttMinutes: sttMinutes || 0,
                totalCostUsd: costIncrement || 0.0
            }
        });
        res.json(stat);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
