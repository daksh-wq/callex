import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = express.Router();

// GET /api/wfm/states - Get current state of all users
router.get('/states', async (req, res) => {
    try {
        // In reality, this would group by user and get their most recent state
        // For SQLite, we pull recent states and reduce in JS
        const states = await prisma.wfmState.findMany({
            orderBy: { timestamp: 'desc' },
            include: { user: { select: { id: true, name: true, role: true } } },
            take: 100 // simplistic approach
        });

        // Return latest state per user
        const latestPerUser = [];
        const seen = new Set();
        for (const s of states) {
            if (!seen.has(s.userId)) {
                seen.add(s.userId);
                latestPerUser.push(s);
            }
        }
        res.json(latestPerUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/wfm/states - Set user state (Available, Break, etc)
router.post('/states', async (req, res) => {
    try {
        const { userId, state } = req.body;

        // Find previous state to calculate duration
        const lastState = await prisma.wfmState.findFirst({
            where: { userId },
            orderBy: { timestamp: 'desc' }
        });

        if (lastState) {
            const duration = Math.floor((new Date() - new Date(lastState.timestamp)) / 1000);
            await prisma.wfmState.update({
                where: { id: lastState.id },
                data: { duration }
            });
        }

        const newState = await prisma.wfmState.create({
            data: { userId, state }
        });

        res.json(newState);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
