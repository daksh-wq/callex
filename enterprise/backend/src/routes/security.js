import { Router } from 'express';
import { prisma } from '../index.js';
import crypto from 'crypto';

const router = Router();

// GET /api/security/voice-signatures
router.get('/voice-signatures', async (req, res) => {
    res.json(await prisma.voiceSignature.findMany({ orderBy: { createdAt: 'desc' } }));
});

// POST /api/security/voice-signatures
router.post('/voice-signatures', async (req, res) => {
    const { phrase, description } = req.body;
    // Mock SHA-256 hash of audio segment
    const hashExample = crypto.createHash('sha256').update(phrase + Date.now()).digest('hex');
    const sig = await prisma.voiceSignature.create({ data: { phrase, description, hashExample } });
    res.json(sig);
});

// DELETE /api/security/voice-signatures/:id
router.delete('/voice-signatures/:id', async (req, res) => {
    await prisma.voiceSignature.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// POST /api/security/pci - toggle PCI recording pause
router.post('/pci', async (req, res) => {
    const { callId, paused } = req.body;
    await prisma.call.update({ where: { id: callId }, data: { recordingPaused: paused } });
    await prisma.systemEvent.create({ data: { type: 'pci.recording', message: `Recording ${paused ? 'paused' : 'resumed'} for call ${callId}`, severity: 'warning' } });
    res.json({ success: true, paused });
});

// POST /api/security/hash-audio - hash audio chunk for legal verification
router.post('/hash-audio', async (req, res) => {
    const { audioChunk, callId } = req.body;
    const hash = crypto.createHash('sha256').update(audioChunk || '').digest('hex');
    res.json({ hash, callId, ts: new Date().toISOString(), algorithm: 'SHA-256' });
});

export default router;
