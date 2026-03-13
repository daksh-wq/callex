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
