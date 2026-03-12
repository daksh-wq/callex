import { Router } from 'express';
import { prisma } from '../index.js';
import bcrypt from 'bcryptjs';

const router = Router();

// ═══════════════════════════════════════════════
// MIDDLEWARE: Super-admin only
// ═══════════════════════════════════════════════
function requireSuperAdmin(req, res, next) {
    if (req.userRole !== 'superadmin') {
        return res.status(403).json({ error: 'Super-admin access required' });
    }
    next();
}
router.use(requireSuperAdmin);

// ═══════════════════════════════════════════════
// GET /api/admin/stats — Platform-wide statistics
// ═══════════════════════════════════════════════
router.get('/stats', async (req, res) => {
    try {
        const [
            totalUsers, totalAgents, totalCalls, totalCampaigns,
            totalApiKeys, activeCalls, totalDocs
        ] = await Promise.all([
            prisma.user.count(),
            prisma.agent.count(),
            prisma.call.count(),
            prisma.campaign.count(),
            prisma.apiKey.count({ where: { active: true } }),
            prisma.call.count({ where: { status: 'active' } }),
            prisma.knowledgeDoc.count(),
        ]);

        res.json({
            totalUsers,
            totalAgents,
            totalCalls,
            totalCampaigns,
            totalApiKeys,
            activeCalls,
            totalDocs,
        });
    } catch (e) {
        console.error('[ADMIN] Stats error:', e);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ═══════════════════════════════════════════════
// GET /api/admin/users — All users with activity stats
// ═══════════════════════════════════════════════
router.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, email: true, name: true, role: true, createdAt: true,
                _count: {
                    select: {
                        Agents: true,
                        Campaigns: true,
                        Calls: true,
                        ApiKey: true,
                        KnowledgeDocs: true,
                        Webhooks: true,
                        RoutingRules: true,
                        FollowUps: true,
                    }
                }
            }
        });

        const enriched = users.map(u => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            createdAt: u.createdAt,
            agents: u._count.Agents,
            campaigns: u._count.Campaigns,
            calls: u._count.Calls,
            apiKeys: u._count.ApiKey,
            knowledgeDocs: u._count.KnowledgeDocs,
            webhooks: u._count.Webhooks,
            routingRules: u._count.RoutingRules,
            followUps: u._count.FollowUps,
        }));

        res.json(enriched);
    } catch (e) {
        console.error('[ADMIN] Users error:', e);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ═══════════════════════════════════════════════
// GET /api/admin/users/:id — Detailed user activity
// ═══════════════════════════════════════════════
router.get('/users/:id', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: { id: true, email: true, name: true, role: true, createdAt: true }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Get all user's data
        const [agents, campaigns, apiKeys, calls, docs, webhooks, followups] = await Promise.all([
            prisma.agent.findMany({ where: { userId: user.id }, select: { id: true, name: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
            prisma.campaign.findMany({ where: { userId: user.id }, select: { id: true, name: true, status: true, totalLeads: true, connectedLeads: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
            prisma.apiKey.findMany({ where: { userId: user.id }, select: { id: true, name: true, prefix: true, env: true, active: true, lastUsed: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
            prisma.call.findMany({ where: { userId: user.id }, take: 50, select: { id: true, phoneNumber: true, status: true, sentiment: true, duration: true, startedAt: true }, orderBy: { startedAt: 'desc' } }),
            prisma.knowledgeDoc.findMany({ where: { userId: user.id }, select: { id: true, name: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
            prisma.webhook.findMany({ where: { userId: user.id }, select: { id: true, url: true, active: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
            prisma.followUp.findMany({ where: { userId: user.id }, select: { id: true, phoneNumber: true, status: true, scheduledFor: true, reason: true }, orderBy: { scheduledFor: 'desc' } }),
        ]);

        res.json({
            user,
            agents,
            campaigns,
            apiKeys,
            recentCalls: calls,
            knowledgeDocs: docs,
            webhooks,
            followups,
        });
    } catch (e) {
        console.error('[ADMIN] User detail error:', e);
        res.status(500).json({ error: 'Failed to fetch user details' });
    }
});

// ═══════════════════════════════════════════════
// POST /api/admin/users — Create a new user
// ═══════════════════════════════════════════════
router.post('/users', async (req, res) => {
    try {
        const { email, name, password, role } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(409).json({ error: 'User with this email already exists' });

        const hashed = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, name: name || email.split('@')[0], password: hashed, role: role || 'user' }
        });

        res.json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt });
    } catch (e) {
        console.error('[ADMIN] Create user error:', e);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// ═══════════════════════════════════════════════
// PATCH /api/admin/users/:id — Update user (role, name)
// ═══════════════════════════════════════════════
router.patch('/users/:id', async (req, res) => {
    try {
        const { name, role } = req.body;
        const data = {};
        if (name) data.name = name;
        if (role) data.role = role;

        const user = await prisma.user.update({ where: { id: req.params.id }, data });
        res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
    } catch (e) {
        console.error('[ADMIN] Update user error:', e);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// ═══════════════════════════════════════════════
// DELETE /api/admin/users/:id — Delete user & all their data
// ═══════════════════════════════════════════════
router.delete('/users/:id', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot delete super-admin' });

        // Delete user's data in order (foreign keys)
        await prisma.apiKey.deleteMany({ where: { userId: user.id } });
        await prisma.webhook.deleteMany({ where: { userId: user.id } });
        await prisma.followUp.deleteMany({ where: { userId: user.id } });
        await prisma.knowledgeDoc.deleteMany({ where: { userId: user.id } });
        await prisma.routingRule.deleteMany({ where: { userId: user.id } });
        await prisma.campaign.deleteMany({ where: { userId: user.id } });

        // Delete agents and their prompt versions
        const agentIds = (await prisma.agent.findMany({ where: { userId: user.id }, select: { id: true } })).map(a => a.id);
        if (agentIds.length) {
            await prisma.promptVersion.deleteMany({ where: { agentId: { in: agentIds } } });
            await prisma.agent.deleteMany({ where: { userId: user.id } });
        }

        await prisma.user.delete({ where: { id: user.id } });
        res.json({ success: true, message: `User ${user.email} and all their data deleted` });
    } catch (e) {
        console.error('[ADMIN] Delete user error:', e);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

export default router;
