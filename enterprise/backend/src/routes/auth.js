import { Router } from 'express';
import { prisma } from '../index.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'callex-enterprise-secret-2025';

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        // Auto-create admin on first login
        if (email === 'admin@callex.ai' && password === 'admin123') {
            const hashed = await bcrypt.hash(password, 10);
            user = await prisma.user.create({ data: { email, name: 'Admin', password: hashed, role: 'admin' } });
        } else {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        // User already exists — return a token instead of erroring
        const valid = await bcrypt.compare(password, existing.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ userId: existing.id, email: existing.email, role: existing.role }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: { id: existing.id, email: existing.email, name: existing.name, role: existing.role } });
    }
    
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, name: name || email.split('@')[0], password: hashed, role: 'admin' } });
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
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
