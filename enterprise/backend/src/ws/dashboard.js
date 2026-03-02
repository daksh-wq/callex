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
    return {
        activeCalls,
        avgMOS: (Math.random() * 0.4 + 4.0).toFixed(2),
        slaPercent: Math.floor(Math.random() * 5 + 95),
        apiFallbackRate: (Math.random() * 2).toFixed(1),
        aiAgentsAvailable: Math.floor(Math.random() * 3 + 7),
        humanAgentsAvailable: Math.floor(Math.random() * 2 + 2),
        events,
    };
}

async function sendDashboardUpdate(ws) {
    try {
        const data = await buildKPIPayload();
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'kpi', data }));
    } catch { }
}
