import { Router } from 'express';
import { prisma, broadcastToCall } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/supervisor/calls - all active calls
router.get('/calls', async (req, res) => {
    const calls = await prisma.call.findMany({
        where: { status: 'active' },
        include: { agent: { select: { name: true } } },
        orderBy: { startedAt: 'desc' },
    });
    res.json(calls);
});

// POST /api/supervisor/calls - simulate a new active call (for demo)
router.post('/calls', async (req, res) => {
    const { phoneNumber, agentId } = req.body;
    const sentiments = ['positive', 'neutral', 'negative', 'angry'];
    const call = await prisma.call.create({
        data: {
            phoneNumber: phoneNumber || `+1${Math.floor(3000000000 + Math.random() * 6999999999)}`,
            agentId: agentId || null,
            status: 'active',
            sentiment: sentiments[Math.floor(Math.random() * 4)],
            transcript: '',
        }
    });
    await prisma.systemEvent.create({ data: { type: 'call.started', message: `Call started from ${call.phoneNumber}`, severity: 'info' } });
    res.json(call);
});

// PATCH /api/supervisor/calls/:id/end - end a call
router.patch('/calls/:id/end', async (req, res) => {
    const call = await prisma.call.update({
        where: { id: req.params.id },
        data: { status: 'completed', endedAt: new Date(), duration: Math.floor(Math.random() * 300 + 30) }
    });
    await prisma.systemEvent.create({ data: { type: 'call.ended', message: `Call ended: ${call.phoneNumber}`, severity: 'info' } });
    res.json(call);
});

// POST /api/supervisor/calls/:id/whisper - inject whisper prompt
router.post('/calls/:id/whisper', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    // Broadcast to supervisor WS listeners on this call
    broadcastToCall(req.params.id, { type: 'whisper', message, ts: Date.now() });
    // Append to transcript
    const call = await prisma.call.findUnique({ where: { id: req.params.id } });
    const newTranscript = (call?.transcript || '') + `\n[SYSTEM WHISPER]: ${message}`;
    await prisma.call.update({ where: { id: req.params.id }, data: { transcript: newTranscript } });
    res.json({ success: true, message });
});

// POST /api/supervisor/calls/:id/barge - trigger barge/takeover
router.post('/calls/:id/barge', async (req, res) => {
    broadcastToCall(req.params.id, { type: 'barge', ts: Date.now() });
    await prisma.call.update({ where: { id: req.params.id }, data: { status: 'transferred' } });
    await prisma.systemEvent.create({ data: { type: 'call.barged', message: `Supervisor barged into call ${req.params.id}`, severity: 'warning' } });
    res.json({ success: true });
});

// GET /api/supervisor/calls/:id/transcript
router.get('/calls/:id/transcript', async (req, res) => {
    const call = await prisma.call.findUnique({ where: { id: req.params.id }, select: { transcript: true, sentiment: true, phoneNumber: true } });
    res.json(call || { transcript: '', sentiment: 'neutral' });
});

// PATCH /api/supervisor/calls/:id/sentiment
router.patch('/calls/:id/sentiment', async (req, res) => {
    const { sentiment } = req.body;
    const call = await prisma.call.update({ where: { id: req.params.id }, data: { sentiment } });
    res.json(call);
});

export default router;
