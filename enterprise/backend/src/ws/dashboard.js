import { broadcastToDashboard } from '../index.js';
import { prisma } from '../index.js';

// Push live KPI updates every 5 seconds to connected dashboard clients
let dashboardInterval = null;

export function setupDashboardWS(ws) {
    // Send initial data immediately
    sendDashboardUpdate(ws);

    if (!dashboardInterval) {
        dashboardInterval = setInterval(async () => {
            const data = await buildKPIPayload();
            broadcastToDashboard({ type: 'kpi', data });
        }, 5000);
    }

    ws.on('close', () => { });
    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch { }
    });
}

async function buildKPIPayload() {
    const activeCalls = await prisma.call.count({ where: { status: 'active' } });
    const events = await prisma.systemEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });

    // Live metrics from DB
    const allCalls = await prisma.call.findMany({ select: { mosScore: true, sentiment: true } });
    const avgMOS = allCalls.filter(c => c.mosScore).reduce((a, b, _, arr) => a + b.mosScore / arr.length, 0) || 4.2;
    const angryCount = allCalls.filter(c => c.sentiment === 'angry').length;
    const slaPercent = allCalls.length > 0 ? Math.round((1 - angryCount / allCalls.length) * 100) : 100;

    const agents = await prisma.agent.count({ where: { status: 'active' } });
    const queueDepth = await prisma.call.count({ where: { status: 'active', agentId: null } });

    const errorEvents = await prisma.systemEvent.count({ where: { severity: 'error' } });
    const totalEvents = await prisma.systemEvent.count();
    const fallbackRate = totalEvents > 0 ? (errorEvents / totalEvents) * 100 : 0;

    return {
        activeCalls,
        avgMOS: avgMOS.toFixed(2),
        slaPercent,
        apiFallbackRate: fallbackRate.toFixed(1),
        aiAgentsAvailable: agents || 0,
        humanAgentsAvailable: 2, // Hardcoded floor
        queueDepth,
        events,
    };
}

async function sendDashboardUpdate(ws) {
    try {
        const data = await buildKPIPayload();
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'kpi', data }));
    } catch { }
}
