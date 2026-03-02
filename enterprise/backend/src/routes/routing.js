import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

// GET /api/routing/rules
router.get('/rules', async (req, res) => {
    res.json(await prisma.routingRule.findMany({ orderBy: { priority: 'asc' } }));
});

// POST /api/routing/rules
router.post('/rules', async (req, res) => {
    const rule = await prisma.routingRule.create({ data: req.body });
    res.json(rule);
});

// PATCH /api/routing/rules/:id
router.patch('/rules/:id', async (req, res) => {
    const rule = await prisma.routingRule.update({ where: { id: req.params.id }, data: req.body });
    res.json(rule);
});

// DELETE /api/routing/rules/:id
router.delete('/rules/:id', async (req, res) => {
    await prisma.routingRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// POST /api/routing/evaluate - evaluate routing for a given intent
router.post('/evaluate', async (req, res) => {
    const { intentTag, sentiment } = req.body;
    const rules = await prisma.routingRule.findMany({ where: { active: true }, orderBy: { priority: 'asc' } });
    const matched = rules.find(r => r.intentTag.toLowerCase() === intentTag?.toLowerCase());
    res.json({ matched: matched || null, action: matched?.destination || 'agent' });
});

export default router;
