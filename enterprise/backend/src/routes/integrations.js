import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

// GET /api/integrations
router.get('/', async (req, res) => {
    res.json(await prisma.integration.findMany({ orderBy: { name: 'asc' } }));
});

// PATCH /api/integrations/:id/connect
router.patch('/:id/connect', async (req, res) => {
    const { config } = req.body;
    const integration = await prisma.integration.update({
        where: { id: req.params.id },
        data: { connected: true, config: JSON.stringify(config || {}) }
    });
    await prisma.systemEvent.create({ data: { type: 'integration.connected', message: `Integration "${integration.name}" connected`, severity: 'info' } });
    res.json(integration);
});

// PATCH /api/integrations/:id/disconnect
router.patch('/:id/disconnect', async (req, res) => {
    const integration = await prisma.integration.update({
        where: { id: req.params.id },
        data: { connected: false, config: '{}' }
    });
    res.json(integration);
});

export default router;
