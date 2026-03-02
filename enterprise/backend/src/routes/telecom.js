import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const router = express.Router();

// === Phone Numbers ===

router.get('/numbers', async (req, res) => {
    try {
        const numbers = await prisma.phoneNumber.findMany({
            include: { routingRule: true }
        });
        res.json(numbers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/numbers', async (req, res) => {
    try {
        const { number, friendlyName, provider } = req.body;
        const result = await prisma.phoneNumber.create({
            data: { number, friendlyName, provider }
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/numbers/:id', async (req, res) => {
    try {
        await prisma.phoneNumber.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === DNC (Do Not Call) List ===

router.get('/dnc', async (req, res) => {
    try {
        const dnc = await prisma.dNCList.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(dnc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/dnc', async (req, res) => {
    try {
        const { number, reason, addedBy } = req.body;
        const dnc = await prisma.dNCList.create({
            data: { number, reason, addedBy }
        });
        res.json(dnc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/dnc/:id', async (req, res) => {
    try {
        await prisma.dNCList.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
