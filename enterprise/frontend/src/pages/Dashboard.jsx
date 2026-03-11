import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../store/index.js';
import {
    TrendingUp, Phone, Zap, Shield, Users, Activity, RadioTower,
    Clock, Coffee, ShieldAlert, PhoneCall, Loader2, PhoneOff, PhoneForwarded
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const WS_URL = `ws://${window.location.host.replace('3000', '4000')}`;

// ─── AUX States for Workforce ───
const AUX_STATES = [
    { id: 'available', label: 'Available', color: 'bg-emerald-500', icon: PhoneCall },
    { id: 'acw', label: 'ACW (Wrap-up)', color: 'bg-blue-500', icon: Clock },
    { id: 'break', label: 'On Break', color: 'bg-orange-500', icon: Coffee },
    { id: 'lunch', label: 'Lunch', color: 'bg-amber-500', icon: Coffee },
    { id: 'offline', label: 'Offline', color: 'bg-gray-400', icon: Users },
];

function KPICard({ icon: Icon, label, value, color = 'orange', sub }) {
    const colors = { orange: 'bg-orange-50 text-orange-600', green: 'bg-emerald-50 text-emerald-600', blue: 'bg-blue-50 text-blue-600', red: 'bg-red-50 text-red-600', purple: 'bg-purple-50 text-purple-600', amber: 'bg-amber-50 text-amber-600' };
    return (
        <div className="kpi-card hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-xl ${colors[color]} flex items-center justify-center mb-3`}>
                <Icon size={18} />
            </div>
            <div className="text-2xl font-bold text-gray-900">{value ?? '—'}</div>
            <div className="text-sm text-gray-500 font-medium">{label}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
    );
}

const buildChartPoint = (kpi) => ({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    calls: kpi?.activeCalls ?? 0,
    mos: parseFloat(kpi?.avgMOS ?? 0),
});

const formatDuration = (dateStr) => {
    const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${m}m ${s}s`;
};

export default function Dashboard() {
    const [kpis, setKPIs] = useState(null);
    const [abTest, setABTest] = useState(null);
    const [events, setEvents] = useState([]);
    const [chartData, setChartData] = useState([]);
    const wsRef = useRef(null);
    const { showToast } = useStore();

    // ─── Workforce State ───
    const [wfmStates, setWfmStates] = useState([]);
    const [wfmLoading, setWfmLoading] = useState(true);

    const availableCount = wfmStates.filter(s => s.state === 'available').length;
    const acwCount = wfmStates.filter(s => s.state === 'acw').length;
    const dialingCount = wfmStates.filter(s => s.state === 'dialing').length;
    const idleCount = wfmStates.filter(s => s.state === 'offline').length;

    useEffect(() => {
        // Fetch KPIs, A/B, Events
        Promise.all([api.kpis(), api.abTest(), api.events()]).then(([k, ab, ev]) => {
            setKPIs(k); setABTest(ab); setEvents(ev);
            if (k) setChartData(prev => [...prev.slice(-11), buildChartPoint(k)]);
        }).catch(() => { });

        // WebSocket for live updates
        if (!WS_URL) return;
        try {
            const ws = new WebSocket(`${WS_URL}?type=dashboard`);
            wsRef.current = ws;
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'kpi') {
                        setKPIs(msg.data);
                        setChartData(prev => [...prev.slice(-11), buildChartPoint(msg.data)]);
                        if (msg.data.events?.length) setEvents(msg.data.events);
                    }
                } catch { }
            };
            ws.onerror = () => { };
            return () => ws.close();
        } catch { }
    }, []);

    // ─── Workforce data fetch ───
    useEffect(() => {
        loadWfmStates();
        const int = setInterval(loadWfmStates, 10000);
        return () => clearInterval(int);
    }, []);

    async function loadWfmStates() {
        try {
            const data = await api.get('/wfm/states');
            if (data.length === 0) {
                setWfmStates([
                    { user: { id: '1', name: 'John Doe', role: 'agent' }, state: 'available', timestamp: new Date(Date.now() - 1000 * 60 * 5) },
                    { user: { id: '2', name: 'Sarah Smith', role: 'supervisor' }, state: 'acw', timestamp: new Date(Date.now() - 1000 * 45) },
                    { user: { id: '3', name: 'Mike Ross', role: 'agent' }, state: 'break', timestamp: new Date(Date.now() - 1000 * 60 * 12) },
                    { user: { id: '4', name: 'Amanda Jones', role: 'agent' }, state: 'available', timestamp: new Date(Date.now() - 1000 * 60 * 2) },
                    { user: { id: '5', name: 'Robert Chen', role: 'agent' }, state: 'offline', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2) },
                ]);
                setWfmLoading(false);
                return;
            }
            setWfmStates(data);
        } catch (err) {
            console.error(err);
        } finally {
            setWfmLoading(false);
        }
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
                    <p className="text-sm text-gray-400 mt-0.5">Real-time AI ops & workforce overview</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-xl">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-xs font-semibold text-emerald-700">Live</span>
                </div>
            </div>

            {/* KPIs Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard icon={Phone} label="Total Calls" value={kpis?.totalCalls ?? 0} color="orange" sub="today" />
                <KPICard icon={Phone} label="Active Calls" value={kpis?.activeCalls ?? 0} color="blue" sub="right now" />
                <KPICard icon={PhoneOff} label="Calls Idle" value={kpis?.callsIdle ?? 0} color="amber" sub="waiting" />
                <KPICard icon={PhoneForwarded} label="Dialing & Ringing" value={kpis?.dialingRinging ?? 0} color="purple" sub="in progress" />
                <KPICard icon={Clock} label="Wrap Up" value={kpis?.wrapUp ?? 0} color="red" sub="post-call" />
                <KPICard icon={Shield} label="SLA Rate" value={kpis ? `${kpis.slaPercent}%` : '—'} color="green" sub="target: 95%" />
                <KPICard icon={Zap} label="API Fallback Rate" value={kpis ? `${kpis.apiFallbackRate}%` : '—'} color="red" sub="last 30m" />
            </div>

            {/* Chart + Workforce Summary Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Live chart */}
                <div className="card lg:col-span-2">
                    <h2 className="section-title mb-4">Live Call Volume & MOS</h2>
                    <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" domain={[3, 5]} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Line yAxisId="left" type="monotone" dataKey="calls" stroke="#f97316" strokeWidth={2} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="mos" stroke="#10b981" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* Workforce Summary (merged from WFM) */}
                <div className="card">
                    <h2 className="section-title mb-4">Workforce</h2>
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-500">AI Agents</span>
                                <span className="font-semibold text-gray-800">{kpis?.aiAgentsAvailable ?? 8} available</span>
                            </div>
                            <div className="h-2.5 rounded-full bg-orange-100">
                                <div className="h-2.5 rounded-full bg-orange-500" style={{ width: `${(kpis?.aiAgentsAvailable ?? 8) / 10 * 100}%` }}></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-500">Human Agents</span>
                                <span className="font-semibold text-gray-800">{kpis?.humanAgentsAvailable ?? 3} available</span>
                            </div>
                            <div className="h-2.5 rounded-full bg-blue-100">
                                <div className="h-2.5 rounded-full bg-blue-500" style={{ width: `${(kpis?.humanAgentsAvailable ?? 3) / 5 * 100}%` }}></div>
                            </div>
                        </div>
                        <div className="pt-2 border-t border-gray-50">
                            <div className="text-sm text-gray-500">Queue Depth</div>
                            <div className="text-2xl font-bold text-gray-900">{kpis?.queueDepth ?? 0}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Workforce Status Board (merged from WFM page) ─── */}
            <div className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Users size={20} className="text-orange-500" /> Live Agent Status
                </h2>

                {/* Workforce KPI pills */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="card p-4 border-l-4 border-l-emerald-500 flex items-center gap-3 bg-white/50">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                            <PhoneCall size={20} />
                        </div>
                        <div>
                            <div className="text-xl font-black text-gray-900">{availableCount}</div>
                            <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Available</div>
                        </div>
                    </div>

                    <div className="card p-4 border-l-4 border-l-blue-500 flex items-center gap-3 bg-white/50">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                            <Clock size={20} />
                        </div>
                        <div>
                            <div className="text-xl font-black text-gray-900">{acwCount}</div>
                            <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Wrap-up</div>
                        </div>
                    </div>

                    <div className="card p-4 border-l-4 border-l-purple-500 flex items-center gap-3 bg-white/50">
                        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                            <PhoneForwarded size={20} />
                        </div>
                        <div>
                            <div className="text-xl font-black text-gray-900">{dialingCount}</div>
                            <div className="text-[10px] font-bold text-purple-600 uppercase tracking-widest">Dialing</div>
                        </div>
                    </div>

                    <div className="card p-4 border-l-4 border-l-gray-400 flex items-center gap-3 bg-white/50">
                        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-600">
                            <Users size={20} />
                        </div>
                        <div>
                            <div className="text-xl font-black text-gray-900">{wfmStates.length}</div>
                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Total Staff</div>
                        </div>
                    </div>
                </div>

                {/* Agent Status Table */}
                <div className="card overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                            <ShieldAlert size={16} className="text-orange-500" /> Live Agent States
                        </h3>
                        <span className="text-xs text-gray-500 flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Live Refresh
                        </span>
                    </div>

                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-100/50 text-xs text-gray-400 uppercase tracking-wider bg-white">
                                <th className="p-4 font-semibold">Agent Name</th>
                                <th className="p-4 font-semibold">Role</th>
                                <th className="p-4 font-semibold">Current State</th>
                                <th className="p-4 font-semibold">Time in State</th>
                                <th className="p-4 text-right font-semibold">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50/50">
                            {wfmLoading ? (
                                <tr><td colSpan="5" className="p-8 text-center"><Loader2 className="animate-spin text-gray-400 mx-auto" /></td></tr>
                            ) : wfmStates.length === 0 ? (
                                <tr><td colSpan="5" className="p-8 text-center text-gray-400 text-sm">No agent states found.</td></tr>
                            ) : wfmStates.map(s => {
                                const stateInfo = AUX_STATES.find(x => x.id === s.state) || AUX_STATES[0];
                                return (
                                    <tr key={s.user.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs">
                                                    {s.user.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <span className="font-semibold text-sm text-gray-800">{s.user.name}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm text-gray-500 capitalize">{s.user.role}</td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2.5 h-2.5 rounded-full ${stateInfo.color}`} />
                                                <span className="text-sm font-medium text-gray-700">{stateInfo.label}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 font-mono text-sm text-gray-600">
                                            {formatDuration(s.timestamp)}
                                        </td>
                                        <td className="p-4 text-right">
                                            <button className="text-xs font-semibold text-orange-600 hover:text-orange-700 hover:bg-orange-50 px-3 py-1.5 rounded transition-colors">
                                                Force Logout
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* A/B Test + Event Log */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* A/B Test */}
                <div className="card">
                    <h2 className="section-title mb-4 flex items-center gap-2">
                        <TrendingUp size={16} className="text-orange-500" /> A/B Model Test
                    </h2>
                    {abTest && (
                        <div className="space-y-4">
                            {['champion', 'challenger'].map(key => {
                                const m = abTest[key];
                                const isWinner = abTest.winner === key;
                                return (
                                    <div key={key} className={`p-4 rounded-xl border-2 ${isWinner ? 'border-orange-200 bg-orange-50' : 'border-gray-100'}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="font-semibold text-gray-800 capitalize">{key}</span>
                                            {isWinner && <span className="badge-orange">Winner {abTest.confidence}% conf.</span>}
                                        </div>
                                        <div className="font-mono text-xs text-gray-400 mb-3">{m.model}</div>
                                        <div className="grid grid-cols-3 gap-3 text-center">
                                            <div><div className="text-lg font-bold text-gray-800">{m.csat}</div><div className="text-xs text-gray-400">CSAT</div></div>
                                            <div><div className="text-lg font-bold text-gray-800">{m.avgDuration}s</div><div className="text-xs text-gray-400">Avg Dur.</div></div>
                                            <div><div className="text-lg font-bold text-gray-800">{m.conversions}%</div><div className="text-xs text-gray-400">Conv.</div></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Event Log */}
                <div className="card">
                    <h2 className="section-title mb-4 flex items-center gap-2">
                        <RadioTower size={16} className="text-orange-500" /> System Event Log
                    </h2>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {events.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No events yet</p>}
                        {events.map(ev => (
                            <div key={ev.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                                <span className={`mt-0.5 ${ev.severity === 'error' ? 'text-red-500' : ev.severity === 'warning' ? 'text-amber-500' : 'text-emerald-500'}`}>
                                    <Activity size={13} />
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-mono text-gray-500">{ev.type}</div>
                                    <div className="text-sm text-gray-700 truncate">{ev.message}</div>
                                </div>
                                <div className="text-xs text-gray-300 shrink-0">{new Date(ev.createdAt).toLocaleTimeString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
