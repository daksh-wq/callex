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

    const login = (email, password, role = 'user') => {
        localStorage.setItem('userRole', role);
        setUserRole(role);
        return signInWithEmailAndPassword(auth, email, password);
    };
    const signup = (email, password, displayName, role = 'user') => {
        localStorage.setItem('userRole', role);
        setUserRole(role);
        return createUserWithEmailAndPassword(auth, email, password).then(async (cred) => {
            await updateProfile(cred.user, { displayName });
            return cred;
        });
    };
    const loginWithGoogle = (role = 'user') => {
        localStorage.setItem('userRole', role);
        setUserRole(role);
        return signInWithPopup(auth, googleProvider);
    };
    const logout = () => {
        localStorage.removeItem('userRole');
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
