import { prisma } from '../index.js';
import crypto from 'crypto';

export async function requireApiKey(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header. Expected Format: Bearer <your_api_key>' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Empty bearer token' });
    }

    try {
        // Hash the provided token (SHA-256) to match the database records
        const keyHash = crypto.createHash('sha256').update(token).digest('hex');

        // Look up the key
        const apiKey = await prisma.apiKey.findUnique({
            where: { keyHash }
        });

        if (!apiKey || !apiKey.active) {
            return res.status(403).json({ error: 'Invalid or revoked API Key.' });
        }

        // Update lastUsed asynchronously (don't block the request)
        prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsed: new Date() }
        }).catch(e => console.error('[AUTH ERROR] Failed to update lastUsed:', e));

        // Attach user and env to request for further routing logic
        req.apiUser = { userId: apiKey.userId, env: apiKey.env, keyId: apiKey.id };
        next();
    } catch (e) {
        console.error('[AUTH ERROR]', e);
        return res.status(500).json({ error: 'Internal server error during authentication' });
    }
}
