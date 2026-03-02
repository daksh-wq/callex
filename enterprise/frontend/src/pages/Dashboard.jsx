import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../store/index.js';
import { TrendingUp, Phone, Zap, Shield, Users, Activity, RadioTower } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const WS_URL = `ws://${window.location.host.replace('3000', '4000')}`;

function KPICard({ icon: Icon, label, value, color = 'orange', sub }) {
    const colors = { orange: 'bg-orange-50 text-orange-600', green: 'bg-emerald-50 text-emerald-600', blue: 'bg-blue-50 text-blue-600', red: 'bg-red-50 text-red-600' };
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

const genChartData = () => Array.from({ length: 12 }, (_, i) => ({
    time: `${i * 5}m`, calls: Math.floor(Math.random() * 40 + 10), mos: +(Math.random() * 0.8 + 3.6).toFixed(2),
}));

export default function Dashboard() {
    const [kpis, setKPIs] = useState(null);
    const [abTest, setABTest] = useState(null);
    const [events, setEvents] = useState([]);
    const [chartData, setChartData] = useState(genChartData());
    const wsRef = useRef(null);
    const { showToast } = useStore();

    useEffect(() => {
        Promise.all([api.kpis(), api.abTest(), api.events()]).then(([k, ab, ev]) => {
            setKPIs(k); setABTest(ab); setEvents(ev);
        }).catch(() => showToast('Failed to load dashboard data', 'error'));

        // WebSocket for live updates
        const ws = new WebSocket(`${WS_URL}?type=dashboard`);
        wsRef.current = ws;
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'kpi') {
                    setKPIs(msg.data);
                    setChartData(genChartData());
                    if (msg.data.events?.length) setEvents(msg.data.events);
                }
            } catch { }
        };
        return () => ws.close();
    }, []);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
                    <p className="text-sm text-gray-400 mt-0.5">Real-time AI ops overview</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-xl">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-xs font-semibold text-emerald-700">Live</span>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard icon={Phone} label="Active Calls" value={kpis?.activeCalls ?? 0} color="orange" sub="right now" />
                <KPICard icon={Activity} label="Avg Network MOS" value={kpis?.avgMOS ?? '—'} color="blue" sub="quality score" />
                <KPICard icon={Shield} label="SLA Rate" value={kpis ? `${kpis.slaPercent}%` : '—'} color="green" sub="target: 95%" />
                <KPICard icon={Zap} label="API Fallback Rate" value={kpis ? `${kpis.apiFallbackRate}%` : '—'} color="red" sub="last 30m" />
            </div>

            {/* Second row */}
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

                {/* Workforce */}
                <div className="card">
                    <h2 className="section-title mb-4">Workforce Management</h2>
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
