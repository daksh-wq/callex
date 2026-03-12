import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import dns from 'dns';

// Fix for Node.js 18+ native fetch ENOTFOUND errors on macOS when resolving certain domains like api.elevenlabs.io over IPv6
dns.setDefaultResultOrder('ipv4first');

// Routes
import dashboardRouter from './routes/dashboard.js';
import supervisorRouter from './routes/supervisor.js';
import agentsRouter from './routes/agents.js';
import knowledgeRouter from './routes/knowledge.js';
import simulationRouter from './routes/simulation.js';
import dialerRouter from './routes/dialer.js';
import analyticsRouter from './routes/analytics.js';
import routingRouter from './routes/routing.js';
import integrationsRouter from './routes/integrations.js';
import securityRouter from './routes/security.js';
import settingsRouter from './routes/settings.js';
import qaRouter from './routes/qa.js';
import wfmRouter from './routes/wfm.js';
import telecomRouter from './routes/telecom.js';
import billingRouter from './routes/billing.js';
import reportsRouter from './routes/reports.js';
import authRouter from './routes/auth.js';
import followupsRouter from './routes/followups.js';

// WS handlers
import { setupSupervisorWS } from './ws/supervisor.js';
import { setupDashboardWS } from './ws/dashboard.js';

dotenv.config();
export const prisma = new PrismaClient();

const app = express();
const httpServer = createServer(app);
export const wss = new WebSocketServer({ server: httpServer });

// Middleware
// Middleware
app.use(cors({ origin: true, credentials: true })); // allow all for deep integration test
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/supervisor', supervisorRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/dialer', dialerRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/routing', routingRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/security', securityRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/qa', qaRouter);
app.use('/api/wfm', wfmRouter);
app.use('/api/telecom', telecomRouter);
app.use('/api/billing', billingRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/followups', followupsRouter);

// Set up public authenticated developer APIs
import externalRouter from './routes/external.js';
app.use('/api/v1', externalRouter);

// WebSocket routing
export const wsClients = new Map(); // callId -> Set<ws>
export const dashboardClients = new Set();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type');
    const callId = url.searchParams.get('callId');

    if (type === 'dashboard') {
        dashboardClients.add(ws);
        setupDashboardWS(ws);
        ws.on('close', () => dashboardClients.delete(ws));
    } else if (type === 'supervisor' && callId) {
        if (!wsClients.has(callId)) wsClients.set(callId, new Set());
        wsClients.get(callId).add(ws);
        setupSupervisorWS(ws, callId);
        ws.on('close', () => {
            wsClients.get(callId)?.delete(ws);
        });
    } else if (type === 'softphone') {
        ws.on('message', (msg) => {
            // Echo for softphone test
            ws.send(JSON.stringify({ type: 'transcript', text: '[STT simulation active]', ts: Date.now() }));
        });
    }
});

// Broadcast helper
export function broadcastToDashboard(data) {
    const msg = JSON.stringify(data);
    dashboardClients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

export function broadcastToCall(callId, data) {
    const msg = JSON.stringify(data);
    wsClients.get(callId)?.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// Serve the Enterprise Dashboard frontend (built Vite dist)
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DASHBOARD_DIST = path.resolve(__dirname, '../../frontend/dist');

// Serve static assets (JS, CSS, images, etc.)
app.use(express.static(DASHBOARD_DIST));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// SPA catch-all: any non-API route serves index.html (React Router handles the rest)
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(DASHBOARD_DIST, 'index.html'));
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
    console.log(`[ENTERPRISE] Backend running on http://localhost:${PORT}`);
    seedInitialData();
});

async function seedInitialData() {
    try {
        const count = await prisma.integration.count();
        if (count === 0) {
            const integrations = [
                { name: 'Salesforce', slug: 'salesforce' },
                { name: 'Stripe', slug: 'stripe' },
                { name: 'Zapier', slug: 'zapier' },
                { name: 'HubSpot', slug: 'hubspot' },
                { name: 'Salesforce', slug: 'salesforce', connected: true },
                { name: 'Twilio', slug: 'twilio', connected: true },
                { name: 'Zendesk', slug: 'zendesk' },
                { name: 'Slack', slug: 'slack' },
                { name: 'Segment', slug: 'segment' },
                { name: 'Intercom', slug: 'intercom' },
            ];
            await prisma.integration.createMany({ data: integrations });
            console.log('[SEED] Integrations seeded');
        }
        const agentCount = await prisma.agent.count();
        if (agentCount === 0) {
            await prisma.agent.create({
                data: {
                    name: 'Recharge Assistant',
                    description: 'Primary inbound voice agent for DishTV recharge',
                    status: 'active',
                    systemPrompt: 'You are a helpful DishTV customer service agent. Help customers with their recharge queries.',
                    openingLine: 'Hello! This is DishTV support. How can I help you today?',
                    voice: 'nova',
                    language: 'en-IN',
                }
            });
            console.log('[SEED] Default agent seeded');
        }
    } catch (e) {
        console.error('[SEED] Error:', e.message);
    }
}
