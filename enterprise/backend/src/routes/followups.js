import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

// GET /api/followups
router.get('/', async (req, res) => {
    try {
        const followups = await prisma.followUp.findMany({
            include: { agent: true },
            orderBy: { scheduledFor: 'asc' }
        });
        res.json(followups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/followups (Simulating an AI adding a scheduled callback)
router.post('/', async (req, res) => {
    try {
        const { phoneNumber, agentId, campaignId, scheduledFor, reason } = req.body;
        const record = await prisma.followUp.create({
            data: { phoneNumber, agentId, campaignId, scheduledFor: new Date(scheduledFor), reason, status: 'pending' }
        });
        res.json(record);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/followups/:id/status
router.patch('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const record = await prisma.followUp.update({
            where: { id: req.params.id },
            data: { status }
        });
        res.json(record);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
