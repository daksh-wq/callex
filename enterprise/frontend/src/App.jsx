import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LiveSupervisor from './pages/LiveSupervisor.jsx';
import AgentStudio from './pages/AgentStudio.jsx';
import KnowledgeBase from './pages/KnowledgeBase.jsx';
import Simulation from './pages/Simulation.jsx';
import Dialer from './pages/Dialer.jsx';
import Analytics from './pages/Analytics.jsx';
import Routing from './pages/Routing.jsx';
import Integrations from './pages/Integrations.jsx';
import Security from './pages/Security.jsx';
import Settings from './pages/Settings.jsx';
import WFM from './pages/WFM.jsx';
import QA from './pages/QA.jsx';
import Reports from './pages/Reports.jsx';
import Telecom from './pages/Telecom.jsx';
import Billing from './pages/Billing.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Toast from './components/Toast.jsx';
import { Loader2 } from 'lucide-react';

function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center animate-pulse">
                    <Loader2 size={20} className="text-white animate-spin" />
                </div>
                <p className="text-sm text-gray-400 font-medium">Loading Callex...</p>
            </div>
        </div>
    );
    if (!user) return <Navigate to="/login" replace />;
    return children;
}

export default function App() {
    return (
        <AuthProvider>
            <Toast />
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="supervisor" element={<LiveSupervisor />} />
                    <Route path="agents" element={<AgentStudio />} />
                    <Route path="knowledge" element={<KnowledgeBase />} />
                    <Route path="simulation" element={<Simulation />} />
                    <Route path="dialer" element={<Dialer />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="routing" element={<Routing />} />
                    <Route path="integrations" element={<Integrations />} />
                    <Route path="security" element={<Security />} />
                    <Route path="settings" element={<Settings />} />

                    {/* New Enterprise Routes */}
                    <Route path="wfm" element={<WFM />} />
                    <Route path="qa" element={<QA />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="telecom" element={<Telecom />} />
                    <Route path="billing" element={<Billing />} />
                    <Route path="followups" element={<FollowUps />} />
                </Route>
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
        </AuthProvider>
    );
}
