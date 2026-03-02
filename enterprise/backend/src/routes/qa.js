import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = express.Router();

// GET /api/qa/dispositions - Get all dispositions
router.get('/dispositions', async (req, res) => {
    try {
        const dispositions = await prisma.disposition.findMany({ orderBy: { name: 'asc' } });
        res.json(dispositions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qa/dispositions - Create a disposition
router.post('/dispositions', async (req, res) => {
    try {
        const { name, category, requiresNote } = req.body;
        const disposition = await prisma.disposition.create({
            data: { name, category, requiresNote, active: true },
        });
        res.json(disposition);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/qa/scores/:callId - Get score for a call
router.get('/scores/:callId', async (req, res) => {
    try {
        const score = await prisma.qAScore.findUnique({
            where: { callId: req.params.callId },
            include: { user: { select: { name: true, email: true } } }
        });
        res.json(score || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qa/scores - Submit a QA Score for a call
router.post('/scores', async (req, res) => {
    try {
        const { callId, scoredByUserId, score, feedback, rubric } = req.body;
        const result = await prisma.qAScore.upsert({
            where: { callId },
            update: { score, feedback, rubric: JSON.stringify(rubric), scoredByUserId },
            create: { callId, score, feedback, rubric: JSON.stringify(rubric), scoredByUserId },
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
