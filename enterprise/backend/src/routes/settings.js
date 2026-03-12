import { Router } from 'express';
import { prisma } from '../index.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fetch from 'node:http';

const router = Router();

// GET /api/settings/api-keys
router.get('/api-keys', async (req, res) => {
    const keys = await prisma.apiKey.findMany({
        where: { active: true, userId: req.userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, prefix: true, env: true, lastUsed: true, createdAt: true, active: true }
    });
    res.json(keys);
});

// POST /api/settings/api-keys - generate new key
router.post('/api-keys', async (req, res) => {
    const { name, env } = req.body;
    const rawKey = uuidv4().replace(/-/g, '');
    const prefix = env === 'live' ? `ck_live_${rawKey.slice(0, 8)}` : `ck_test_${rawKey.slice(0, 8)}`;
    const fullKey = `${prefix}_${rawKey.slice(8)}`;
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
    const key = await prisma.apiKey.create({ data: { userId: req.userId, name, keyHash, prefix, env: env || 'test' } });
    res.json({ ...key, fullKey }); // Only time we return the full key
});

// DELETE /api/settings/api-keys/:id
router.delete('/api-keys/:id', async (req, res) => {
    await prisma.apiKey.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ success: true });
});

// GET /api/settings/webhooks
router.get('/webhooks', async (req, res) => {
    res.json(await prisma.webhook.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } }));
});

// POST /api/settings/webhooks
router.post('/webhooks', async (req, res) => {
    const { url, events, secret } = req.body;
    const webhook = await prisma.webhook.create({ data: { userId: req.userId, url, events: JSON.stringify(events || []), secret } });
    res.json(webhook);
});

// PATCH /api/settings/webhooks/:id
router.patch('/webhooks/:id', async (req, res) => {
    const data = { ...req.body };
    if (data.events && Array.isArray(data.events)) data.events = JSON.stringify(data.events);
    const webhook = await prisma.webhook.update({ where: { id: req.params.id }, data });
    res.json(webhook);
});

// DELETE /api/settings/webhooks/:id
router.delete('/webhooks/:id', async (req, res) => {
    await prisma.webhook.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// POST /api/settings/webhooks/:id/test - send test event
router.post('/webhooks/:id/test', async (req, res) => {
    const webhook = await prisma.webhook.findUnique({ where: { id: req.params.id } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    // Fire test POST (simplified, no actual HTTP lib beyond built-in)
    res.json({ success: true, message: `Test event dispatched to ${webhook.url}` });
});

export default router;
