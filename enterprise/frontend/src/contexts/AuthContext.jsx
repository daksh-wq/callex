import { createContext, useContext, useEffect, useState } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile,
    sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.js';

const AuthContext = createContext(null);

const API_BASE = '/api';

/**
 * Sync with backend — auto-create user if needed, get JWT token
 */
async function syncBackendAuth(email, password, name) {
    try {
        // Try login first
        let res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (res.status === 401) {
            // User doesn't exist in backend yet — register
            res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name: name || email.split('@')[0] }),
            });
        }

        if (res.ok) {
            const data = await res.json();
            if (data.token) {
                localStorage.setItem('token', data.token);
                console.log('[AUTH] Backend JWT stored');
                return data;
            }
        }
    } catch (err) {
        console.warn('[AUTH] Backend sync failed (non-blocking):', err.message);
    }
    return null;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(localStorage.getItem('userRole') || 'user');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });
        return unsub;
    }, []);

    const login = async (email, password, role = 'user') => {
        localStorage.setItem('userRole', role);
        setUserRole(role);
        const cred = await signInWithEmailAndPassword(auth, email, password);
        // Bridge: sync with backend to get JWT
        await syncBackendAuth(email, password);
        return cred;
    };
    const signup = async (email, password, displayName, role = 'user') => {
        localStorage.setItem('userRole', role);
        setUserRole(role);
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName });
        // Bridge: register in backend and get JWT
        await syncBackendAuth(email, password, displayName);
        return cred;
    };
    const loginWithGoogle = async (role = 'user') => {
        localStorage.setItem('userRole', role);
        setUserRole(role);
        const cred = await signInWithPopup(auth, googleProvider);
        // Bridge: sync Google user with backend (use Firebase UID as password fallback)
        await syncBackendAuth(cred.user.email, cred.user.uid, cred.user.displayName);
        return cred;
    };
    const logout = () => {
        localStorage.removeItem('userRole');
        localStorage.removeItem('token');
        setUserRole('user');
        return signOut(auth);
    };
    const resetPassword = (email) => sendPasswordResetEmail(auth, email);

    return (
        <AuthContext.Provider value={{ user, userRole, loading, login, signup, loginWithGoogle, logout, resetPassword }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
