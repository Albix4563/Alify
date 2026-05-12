'use client';

import { useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';
import { PlaySquare } from 'lucide-react';
import { toast } from 'sonner';

export function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success("Accesso effettuato con successo!");
      } else {
        if (!displayName) throw new Error('Display name is required');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        try {
            await setDoc(doc(db, 'users', userCredential.user.uid), {
                email, displayName, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
            });
            toast.success("Registrazione completata con successo!");
        } catch (dbError) {
            handleFirestoreError(dbError, OperationType.CREATE, `users/${userCredential.user.uid}`);
        }
      }
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const userCredential = await signInWithPopup(auth, provider);
      try {
        await setDoc(doc(db, 'users', userCredential.user.uid), {
            email: userCredential.user.email,
            displayName: userCredential.user.displayName,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        toast.success("Accesso effettuato con Google!");
      } catch (dbError) {
          handleFirestoreError(dbError, OperationType.CREATE, `users/${userCredential.user.uid}`);
      }
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center h-[100dvh] text-white relative z-10 w-full p-4 overflow-y-auto overscroll-y-contain">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-3xl p-8 rounded-2xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.37)] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/10 to-sky-400/10 z-[-1]" />
        
        <div className="flex flex-col items-center mb-8">
            <div className="w-44 h-44 mb-4 relative drop-shadow-xl overflow-hidden rounded-2xl">
                <img src="/assets/logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <p className="text-center text-blue-300/70 font-medium uppercase tracking-widest text-sm mt-4 drop-shadow-sm">
              {isLogin ? 'Accedi Al Tuo Account' : 'Crea Un Nuovo Account'}
            </p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-red-300 text-sm text-center font-bold bg-red-900/40 border border-red-500/50 p-3 rounded-lg shadow-inner">{error}</p>}
          
          {!isLogin && (
            <input
                type="text" placeholder="Nome Utente" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/50 focus:border-blue-400/50 transition-all placeholder-cyan-100/40 backdrop-blur-md shadow-inner" required
            />
          )}
          <input
            type="email" placeholder="Indirizzo Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/50 focus:border-blue-400/50 transition-all placeholder-cyan-100/40 backdrop-blur-md shadow-inner" required
          />
          <input
            type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/50 focus:border-blue-400/50 transition-all placeholder-cyan-100/40 backdrop-blur-md shadow-inner" required
          />
          
          <button type="submit" className="w-full py-3 bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold rounded-xl hover:shadow-[0_0_20px_rgba(52,211,153,0.5)] transition-all mt-4 transform hover:scale-[1.02] active:scale-[0.98]" disabled={loading}>
            {loading ? 'ATTENDI...' : (isLogin ? 'ACCEDI' : 'REGISTRATI')}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-center space-x-3">
          <div className="h-px bg-white/10 w-full" />
          <span className="text-xs text-blue-300/50 font-bold uppercase tracking-widest drop-shadow-sm">oppure</span>
          <div className="h-px bg-white/10 w-full" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="w-full mt-6 py-3 bg-white/5 border border-white/10 text-white font-bold rounded-xl hover:bg-white/10 hover:shadow-lg transition-all flex items-center justify-center space-x-3 backdrop-blur-sm"
          disabled={loading}
        >
          <svg className="w-5 h-5 drop-shadow-md" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
            <path d="M1 1h22v22H1z" fill="none" />
          </svg>
          <span className="drop-shadow-sm text-[13px]">Continua con Google</span>
        </button>

        <p className="text-xs text-center text-blue-200/60 w-full mt-8 font-medium">
          {isLogin ? "Non hai un account? " : "Hai già un account? "}
          <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-sky-400 hover:text-blue-400 hover:underline focus:outline-none font-bold transition-colors">
            {isLogin ? 'Registrati' : 'Accedi'}
          </button>
        </p>
      </div>
    </div>
  );
}
