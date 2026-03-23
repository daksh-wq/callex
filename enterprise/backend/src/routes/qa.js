import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';

const router = Router();

// GET /api/qa/dispositions
router.get('/dispositions', async (req, res) => {
    try {
        const snap = await db.collection('dispositions').orderBy('name', 'asc').get();
        res.json(queryToArray(snap));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qa/dispositions
router.post('/dispositions', async (req, res) => {
    try {
        const { name, category, requiresNote } = req.body;
        const data = { name, category, requiresNote: requiresNote || false, active: true, createdAt: new Date() };
        const ref = await db.collection('dispositions').add(data);
        res.json({ id: ref.id, ...data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/qa/dispositions/:id
router.put('/dispositions/:id', async (req, res) => {
    try {
        const doc = await db.collection('dispositions').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Disposition not found' });

        const { name, category, requiresNote, active } = req.body;
        const updates = { updatedAt: new Date() };
        if (name !== undefined) updates.name = name;
        if (category !== undefined) updates.category = category;
        if (requiresNote !== undefined) updates.requiresNote = requiresNote;
        if (active !== undefined) updates.active = active;

        await db.collection('dispositions').doc(req.params.id).update(updates);
        res.json({ id: req.params.id, ...doc.data(), ...updates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/qa/dispositions/:id
router.delete('/dispositions/:id', async (req, res) => {
    try {
        const doc = await db.collection('dispositions').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Disposition not found' });
        await db.collection('dispositions').doc(req.params.id).delete();
        res.json({ message: 'Disposition deleted successfully', id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/qa/scores/:callId
router.get('/scores/:callId', async (req, res) => {
    try {
        const snap = await db.collection('qaScores').where('callId', '==', req.params.callId).limit(1).get();
        if (snap.empty) return res.json(null);
        const score = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (score.scoredByUserId) {
            const userDoc = await db.collection('users').doc(score.scoredByUserId).get();
            score.user = userDoc.exists ? { name: userDoc.data().name, email: userDoc.data().email } : null;
        }
        res.json(score);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/qa/scores
router.post('/scores', async (req, res) => {
    try {
        const { callId, scoredByUserId, score, feedback, rubric } = req.body;
        const snap = await db.collection('qaScores').where('callId', '==', callId).limit(1).get();
        const data = { callId, score, feedback, rubric: JSON.stringify(rubric), scoredByUserId, createdAt: new Date() };

        if (!snap.empty) {
            await db.collection('qaScores').doc(snap.docs[0].id).update(data);
            res.json({ id: snap.docs[0].id, ...data });
        } else {
            const ref = await db.collection('qaScores').add(data);
            res.json({ id: ref.id, ...data });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
