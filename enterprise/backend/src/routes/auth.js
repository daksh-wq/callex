import { Router } from 'express';
import { db } from '../firebase.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'callex-enterprise-secret-2025';

// Super-admin credentials
const SUPER_ADMIN_USERNAME = 'callex2025';
const SUPER_ADMIN_PASSWORD = 'callex2025';

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check for super-admin login
        if (email === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD) {
            // Ensure super-admin exists in Firestore
            const snap = await db.collection('users').where('email', '==', 'superadmin@callex.ai').limit(1).get();
            let admin;
            if (snap.empty) {
                const hashed = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
                const ref = await db.collection('users').add({ email: 'superadmin@callex.ai', name: 'Super Admin', password: hashed, role: 'superadmin', createdAt: new Date() });
                admin = { id: ref.id, email: 'superadmin@callex.ai', name: 'Super Admin', role: 'superadmin' };
            } else {
                admin = { id: snap.docs[0].id, ...snap.docs[0].data() };
            }
            const token = jwt.sign({ userId: admin.id, email: admin.email, role: 'superadmin' }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name, role: 'superadmin' } });
        }

        // Regular user login
        const snap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (snap.empty) return res.status(401).json({ error: 'Invalid credentials' });

        const user = { id: snap.docs[0].id, ...snap.docs[0].data() };
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (e) {
        console.error('[AUTH] Login error:', e);
        res.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const snap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!snap.empty) {
            const existing = { id: snap.docs[0].id, ...snap.docs[0].data() };
            const valid = await bcrypt.compare(password, existing.password);
            if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
            const token = jwt.sign({ userId: existing.id, email: existing.email, role: existing.role }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({ token, user: { id: existing.id, email: existing.email, name: existing.name, role: existing.role } });
        }

        const hashed = await bcrypt.hash(password, 10);
        const ref = await db.collection('users').add({ email, name: name || email.split('@')[0], password: hashed, role: 'user', createdAt: new Date() });
        const token = jwt.sign({ userId: ref.id, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: ref.id, email, name: name || email.split('@')[0], role: 'user' } });
    } catch (e) {
        console.error('[AUTH] Register error:', e);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({ error: 'No token' });
    try {
        const payload = jwt.verify(auth, JWT_SECRET);
        res.json(payload);
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});

export default router;
