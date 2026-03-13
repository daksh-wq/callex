import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';
import { broadcastToCall } from '../index.js';

const router = Router();

// GET /api/supervisor/calls
router.get('/calls', async (req, res) => {
    const snap = await db.collection('calls').where('status', '==', 'active').get();
    const calls = [];
    for (const doc of snap.docs) {
        const call = { id: doc.id, ...doc.data() };
        if (call.agentId) {
            const agentDoc = await db.collection('agents').doc(call.agentId).get();
            call.agent = agentDoc.exists ? { name: agentDoc.data().name } : null;
        }
        calls.push(call);
    }
    calls.sort((a, b) => {
        const da = a.startedAt?.toDate ? a.startedAt.toDate().getTime() : new Date(a.startedAt || 0).getTime();
        const db2 = b.startedAt?.toDate ? b.startedAt.toDate().getTime() : new Date(b.startedAt || 0).getTime();
        return db2 - da;
    });
    res.json(calls);
});

// POST /api/supervisor/calls
router.post('/calls', async (req, res) => {
    const { phoneNumber, agentId } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });
    const data = { phoneNumber, agentId: agentId || null, status: 'active', sentiment: 'neutral', transcript: '', mosScore: 4.5, startedAt: new Date() };
    const ref = await db.collection('calls').add(data);
    await db.collection('systemEvents').add({ type: 'call.started', message: `Call started from ${phoneNumber}`, severity: 'info', meta: '{}', createdAt: new Date() });
    import('../index.js').then(({ broadcastToDashboard }) => broadcastToDashboard({ type: 'refresh_kpi' }));
    res.json({ id: ref.id, ...data });
});

// PATCH /api/supervisor/calls/:id/end
router.patch('/calls/:id/end', async (req, res) => {
    const doc = await db.collection('calls').doc(req.params.id).get();
    const existing = docToObj(doc);
    const duration = existing?.startedAt ? Math.round((Date.now() - new Date(existing.startedAt.toDate ? existing.startedAt.toDate() : existing.startedAt).getTime()) / 1000) : 0;
    await db.collection('calls').doc(req.params.id).update({ status: 'completed', endedAt: new Date(), duration });
    await db.collection('systemEvents').add({ type: 'call.ended', message: `Call ended: ${existing?.phoneNumber}`, severity: 'info', meta: '{}', createdAt: new Date() });
    import('../index.js').then(({ broadcastToDashboard }) => broadcastToDashboard({ type: 'refresh_kpi' }));
    const updated = await db.collection('calls').doc(req.params.id).get();
    res.json(docToObj(updated));
});

// POST /api/supervisor/calls/:id/whisper
router.post('/calls/:id/whisper', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    broadcastToCall(req.params.id, { type: 'whisper', message, ts: Date.now() });
    const doc = await db.collection('calls').doc(req.params.id).get();
    const call = docToObj(doc);
    const newTranscript = (call?.transcript || '') + `\n[SYSTEM WHISPER]: ${message}`;
    await db.collection('calls').doc(req.params.id).update({ transcript: newTranscript });
    res.json({ success: true, message });
});

// POST /api/supervisor/calls/:id/barge
router.post('/calls/:id/barge', async (req, res) => {
    broadcastToCall(req.params.id, { type: 'barge', ts: Date.now() });
    await db.collection('calls').doc(req.params.id).update({ status: 'transferred' });
    await db.collection('systemEvents').add({ type: 'call.barged', message: `Supervisor barged into call ${req.params.id}`, severity: 'warning', meta: '{}', createdAt: new Date() });
    res.json({ success: true });
});

// GET /api/supervisor/calls/:id/transcript
router.get('/calls/:id/transcript', async (req, res) => {
    const doc = await db.collection('calls').doc(req.params.id).get();
    const call = docToObj(doc);
    res.json(call ? { transcript: call.transcript || '', sentiment: call.sentiment || 'neutral', phoneNumber: call.phoneNumber } : { transcript: '', sentiment: 'neutral' });
});

// PATCH /api/supervisor/calls/:id/sentiment
router.patch('/calls/:id/sentiment', async (req, res) => {
    const { sentiment } = req.body;
    await db.collection('calls').doc(req.params.id).update({ sentiment });
    const doc = await db.collection('calls').doc(req.params.id).get();
    res.json(docToObj(doc));
});

export default router;
