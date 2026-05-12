import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';
import { usePlayerStore, AudioQuality } from '@/lib/store';
import { Settings, Save, AlertTriangle, Trash2, Key, History, Sparkles, Loader2, User, Shield, HardDrive, ShieldAlert, Wifi, Zap, Volume2, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { updateProfile, deleteUser } from 'firebase/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { motion } from 'motion/react';

export function ProfileView() {
    const { user } = useAuth();
    const [nickname, setNickname] = useState('');
    const [lastChanged, setLastChanged] = useState<Date | null>(null);
    const [loading, setLoading] = useState(false);
    const { audioQuality, setAudioQuality } = usePlayerStore();
    
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; desc: string; action: () => void; isDestructive?: boolean } | null>(null);

    useEffect(() => {
        if (!user) return;
        setNickname(user.displayName || '');
        
        async function fetchProfileData() {
            try {
                const docRef = doc(db, 'users', user!.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.lastNicknameChange) {
                        setLastChanged(data.lastNicknameChange.toDate());
                    }
                    if (data.audioQuality) {
                        setAudioQuality(data.audioQuality as AudioQuality);
                    }
                }
            } catch (err) {
                 // handle silently if not exists
            }
        }
        fetchProfileData();
    }, [user, setAudioQuality]);

    const handleSaveQuality = async (quality: AudioQuality) => {
        if (!user) {
            setAudioQuality(quality);
            return;
        }
        
        setAudioQuality(quality);
        try {
            const docRef = doc(db, 'users', user.uid);
            await setDoc(docRef, { audioQuality: quality }, { merge: true });
            toast.success(`Qualità audio impostata a: ${quality.charAt(0).toUpperCase() + quality.slice(1)}`);
        } catch (error) {
            console.error('Error updating audio quality:', error);
        }
    };

    const handleSaveNickname = async () => {
        if (!user) return;
        if (!nickname.trim()) {
            toast.error('Il nickname non può essere vuoto.');
            return;
        }

        if (lastChanged) {
            const now = new Date();
            const daysSince = Math.floor((now.getTime() - lastChanged.getTime()) / (1000 * 3600 * 24));
            if (daysSince < 30) {
                toast.error(`Puoi cambiare il nome solo una volta al mese. Riprova tra ${30 - daysSince} giorni.`);
                return;
            }
        }

        setLoading(true);
        try {
            await updateProfile(user, { displayName: nickname });
            const docRef = doc(db, 'users', user.uid);
            await setDoc(docRef, { 
                 lastNicknameChange: new Date()
            }, { merge: true });
            setLastChanged(new Date());
            toast.success('Nickname aggiornato con successo!');
        } catch (error) {
            console.error('Error updating nickname:', error);
            toast.error('Errore durante l\'aggiornamento del nickname.');
        } finally {
            setLoading(false);
        }
    };

    const deletePlaylists = async () => {
        if (!user) return;
        setLoading(true);
        try {
             const q = query(collection(db, 'playlists'), where('ownerId', '==', user.uid));
             const snapshot = await getDocs(q);
             const batch = writeBatch(db);
             snapshot.docs.forEach(d => batch.delete(d.ref));
             await batch.commit();
             toast.success('Tutte le playlist eliminate.');
        } catch (e) {
             handleFirestoreError(e, OperationType.DELETE, 'playlists');
             toast.error('Errore durante l\'eliminazione delle playlist.');
        } finally {
             setLoading(false);
             setConfirmDialog(null);
        }
    };

    const deleteHistory = async () => {
        if (!user) return;
        setLoading(true);
        try {
             const q = query(collection(db, `users/${user.uid}/history`));
             const snapshot = await getDocs(q);
             const batch = writeBatch(db);
             snapshot.docs.forEach(d => batch.delete(d.ref));
             await batch.commit();
             toast.success('Cronologia eliminata.');
        } catch (e) {
             console.error(e);
             toast.error('Errore durante l\'eliminazione della cronologia.');
        } finally {
             setLoading(false);
             setConfirmDialog(null);
        }
    };

    const deleteAccount = async () => {
        if (!user) return;
        setLoading(true);
        try {
             await deleteUser(user);
             toast.success('Account eliminato con successo. Arrivederci!');
        } catch (error: any) {
             console.error(error);
             if (error.code === 'auth/requires-recent-login') {
                 toast.error('Per eliminare l\'account è necessario effettuare nuovamente l\'accesso per motivi di sicurezza.');
             } else {
                 toast.error('Si è verificato un errore durante l\'eliminazione dell\'account.');
             }
        } finally {
             setLoading(false);
             setConfirmDialog(null);
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 md:p-6 pb-32 max-w-6xl mx-auto w-full relative z-10"
        >
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-8">
                <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4 sm:gap-6 text-center sm:text-left">
                    <div className="w-24 h-24 sm:w-20 sm:h-20 md:w-28 md:h-28 rounded-full bg-gradient-to-br from-blue-500 to-sky-400 p-1 shadow-2xl relative shrink-0">
                         <div className="w-full h-full bg-[#111] rounded-full flex items-center justify-center overflow-hidden border-2 border-transparent">
                             {user?.photoURL ? (
                                <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                             ) : (
                                <div className="w-full h-full flex items-center justify-center text-4xl md:text-5xl font-bold text-white bg-black/50">
                                    {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                                </div>
                             )}
                         </div>
                    </div>
                    <div className="overflow-hidden max-w-full flex flex-col items-center sm:items-start">
                        <h1 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-white tracking-tight drop-shadow-md truncate max-w-full">
                            {user?.displayName || 'Profilo'}
                        </h1>
                        <p className="text-blue-300/70 text-xs sm:text-sm md:text-base font-medium mt-2 bg-black/20 px-3 py-1.5 rounded-full inline-flex border border-white/5 truncate max-w-full">
                            {user?.email}
                        </p>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="general" className="w-full flex-col">
                <TabsList className="bg-black/40 border border-white/10 p-2 rounded-3xl mb-8 flex flex-col md:flex-row h-auto w-full justify-start gap-2 shadow-inner">
                    <TabsTrigger value="general" className="rounded-xl px-6 py-4 md:py-3 w-full md:w-auto after:hidden data-active:bg-white/10 data-active:text-white !text-blue-200/60 data-active:!text-white font-medium transition-all flex items-center justify-center md:justify-start gap-2 border-none ring-0 focus-visible:ring-0 focus-visible:outline-none dark:data-active:bg-white/10 dark:data-active:border-none !shadow-none">
                        <User className="w-5 h-5 md:w-4 md:h-4" /> Generale
                    </TabsTrigger>
                    <TabsTrigger value="data" className="rounded-xl px-6 py-4 md:py-3 w-full md:w-auto after:hidden data-active:bg-white/10 data-active:text-white !text-blue-200/60 data-active:!text-white font-medium transition-all flex items-center justify-center md:justify-start gap-2 border-none ring-0 focus-visible:ring-0 focus-visible:outline-none dark:data-active:bg-white/10 dark:data-active:border-none !shadow-none">
                        <HardDrive className="w-5 h-5 md:w-4 md:h-4" /> Dati e Cronologia
                    </TabsTrigger>
                    <TabsTrigger value="security" className="rounded-xl px-6 py-4 md:py-3 w-full md:w-auto after:hidden data-active:bg-red-500/20 data-active:text-red-400 !text-blue-200/60 data-active:!text-red-400 font-medium transition-all flex items-center justify-center md:justify-start gap-2 border-none ring-0 focus-visible:ring-0 focus-visible:outline-none dark:data-active:bg-red-500/20 dark:data-active:border-none !shadow-none">
                        <ShieldAlert className="w-5 h-5 md:w-4 md:h-4" /> Sicurezza Account
                    </TabsTrigger>
                </TabsList>

                {/* --- TAB GENERALE --- */}
                <TabsContent value="general" className="space-y-6">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-[#121215]/80 border border-white/10 rounded-[28px] md:rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-lg">
                        <div className="flex items-center gap-3 mb-6 md:mb-8">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                <Key className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white tracking-tight">Impostazioni Identità</h2>
                                <p className="text-sm text-blue-200/60">Gestisci come appari agli altri utenti.</p>
                            </div>
                        </div>
                        <div className="max-w-xl">
                            <label className="block text-sm font-semibold text-white/80 mb-3">Nickname</label>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <input 
                                    type="text" 
                                    value={nickname}
                                    onChange={(e) => setNickname(e.target.value)}
                                    className="flex-1 bg-black/60 border border-white/10 rounded-xl px-4 py-4 md:px-5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder-white/20 shadow-inner"
                                    placeholder="Il tuo nickname"
                                />
                                <button 
                                    onClick={handleSaveNickname}
                                    disabled={loading || nickname === user?.displayName}
                                    className="bg-white/10 hover:bg-white/20 text-white border border-white/10 px-6 py-4 md:px-8 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    Salva Nickname
                                </button>
                            </div>
                            <p className="text-xs text-white/40 mt-3 font-medium flex items-center gap-2">
                                <Shield className="w-3.5 h-3.5" />
                                Modificabile ogni 30 giorni. Ultima modifica: {lastChanged ? lastChanged.toLocaleDateString() : 'Mai'}.
                            </p>
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-[#121215]/80 border border-white/10 rounded-[28px] md:rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-lg mt-6">
                        <div className="flex items-center gap-3 mb-6 md:mb-8">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                <Activity className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white tracking-tight">Qualità Audio e Video</h2>
                                <p className="text-sm text-blue-200/60">Configura la qualità in base alla tua connessione.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {[
                                { id: 'basso', label: 'Basso', icon: Wifi, desc: 'Connessione debole, video 360p, audio standard.' },
                                { id: 'medio', label: 'Medio', icon: Zap, desc: 'Default. Connessione buona, video 720p.' },
                                { id: 'alto', label: 'Alto', icon: Volume2, desc: 'Connessione ottima, video 1080p, audio HQ.' },
                                { id: 'auto', label: 'Auto', icon: Sparkles, desc: 'Adattamento automatico (Medio → Basso).' },
                            ].map((q) => (
                                <button
                                    key={q.id}
                                    onClick={() => handleSaveQuality(q.id as AudioQuality)}
                                    className={`flex flex-col p-5 rounded-[20px] border transition-all text-left group ${
                                        audioQuality === q.id 
                                        ? 'bg-blue-500/10 border-blue-500/50 ring-2 ring-blue-500/20' 
                                        : 'bg-black/40 border-white/5 hover:border-white/20'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className={`p-2 rounded-xl ${audioQuality === q.id ? 'bg-blue-500 text-white' : 'bg-white/5 text-blue-200/60 group-hover:text-blue-200'}`}>
                                            <q.icon className="w-5 h-5" />
                                        </div>
                                        {audioQuality === q.id && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,1)]" />}
                                    </div>
                                    <h3 className={`font-bold ${audioQuality === q.id ? 'text-white' : 'text-blue-100/70'}`}>{q.label}</h3>
                                    <p className="text-[11px] text-blue-200/40 mt-1 leading-tight">{q.desc}</p>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                </TabsContent>

                {/* --- TAB DATI E CRONOLOGIA --- */}
                <TabsContent value="data" className="space-y-6">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                        <div className="bg-[#121215]/80 hover:bg-[#18181c] transition-colors border border-white/10 rounded-[24px] md:rounded-3xl p-6 md:p-8 flex flex-col shadow-sm backdrop-blur-xl">
                            <div className="p-3 bg-blue-500/10 rounded-2xl w-fit mb-4 md:mb-5 border border-blue-500/20"><History className="text-blue-400 w-6 h-6" /></div>
                            <h3 className="font-bold text-white text-base md:text-lg mb-2 tracking-tight">Cronologia Ascolti</h3>
                            <p className="text-sm text-blue-200/60 mb-6 md:mb-8 flex-1 leading-relaxed">Rimuovi la traccia di tutti i brani che hai riprodotto finora sulla piattaforma.</p>
                            <button onClick={() => setConfirmDialog({
                                title: 'Svuota Cronologia',
                                desc: 'Sei sicuro di voler eliminare la tua cronologia degli ascolti? L\'azione è irreversibile.',
                                action: deleteHistory
                            })} className="text-white hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-3 md:py-4 rounded-xl text-sm md:text-base font-bold transition-all w-full text-center">Svuota Cronologia</button>
                        </div>
                        
                        <div className="bg-[#121215]/80 hover:bg-[#18181c] transition-colors border border-white/10 rounded-[24px] md:rounded-3xl p-6 md:p-8 flex flex-col shadow-sm backdrop-blur-xl">
                            <div className="p-3 bg-orange-500/10 rounded-2xl w-fit mb-4 md:mb-5 border border-orange-500/20"><Settings className="text-orange-400 w-6 h-6" /></div>
                            <h3 className="font-bold text-white text-base md:text-lg mb-2 tracking-tight">Tutte le Playlist</h3>
                            <p className="text-sm text-blue-200/60 mb-6 md:mb-8 flex-1 leading-relaxed">Elimina in modo definitivo tutte le tue raccolte e compilation create in precedenza.</p>
                            <button onClick={() => setConfirmDialog({
                                title: 'Elimina Tutto',
                                desc: 'Attenzione: stai per eliminare permanentemente tutte le tue playlist.',
                                action: deletePlaylists,
                                isDestructive: true
                            })} className="text-orange-400 hover:bg-orange-500/10 border border-orange-500/20 px-4 py-3 md:py-4 rounded-xl text-sm md:text-base font-bold transition-all w-full text-center">Elimina Playlist</button>
                        </div>
                    </motion.div>
                </TabsContent>

                {/* --- TAB SICUREZZA --- */}
                <TabsContent value="security" className="space-y-6">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-500/5 backdrop-blur-xl border border-red-500/20 rounded-[28px] md:rounded-3xl p-6 md:p-8 max-w-2xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                                <AlertTriangle className="w-6 h-6 text-red-500" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-red-500 tracking-tight">Eliminazione Account</h2>
                            </div>
                        </div>
                        <p className="text-base text-red-200/70 mb-8 leading-relaxed">
                            L&apos;eliminazione dell&apos;account è permanente. Tutti i tuoi dati, la cronologia, le playlist condivise e le configurazioni andranno persi in modo irreversibile. Assicurati di non voler recuperare l&apos;account prima di procedere.
                        </p>
                        <button 
                             onClick={() => setConfirmDialog({
                                    title: 'Richiesta Eliminazione Definitiva',
                                    desc: 'Sei assolutamente sicuro di voler chiudere il tuo account e rimuovere tutti i dati dai server?',
                                    action: deleteAccount,
                                    isDestructive: true
                                })}
                            className="bg-red-500/20 hover:bg-red-500/40 text-red-200 border border-red-500/30 px-6 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                            <Trash2 className="w-5 h-5" /> Procedi con l&apos;eliminazione
                        </button>
                    </motion.div>
                </TabsContent>

            </Tabs>

            <Dialog open={!!confirmDialog} onOpenChange={(open) => { if(!open) setConfirmDialog(null) }}>
                 <DialogContent className="bg-[#121215]/95 backdrop-blur-3xl border-white/10 text-white sm:max-w-[425px] rounded-[28px] shadow-2xl p-8">
                    <DialogHeader className="mb-4">
                        <DialogTitle className="text-2xl font-bold tracking-tight">{confirmDialog?.title}</DialogTitle>
                        <DialogDescription className="text-blue-100/60 mt-3 text-base leading-relaxed">
                            {confirmDialog?.desc}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-8 flex gap-3 sm:justify-end">
                        <Button variant="ghost" className="text-white hover:bg-white/10 rounded-xl px-6 py-6 font-semibold" onClick={() => setConfirmDialog(null)}>
                            Annulla
                        </Button>
                        <Button 
                            variant="destructive" 
                            className={`rounded-xl px-6 py-6 font-bold shadow-lg border ${confirmDialog?.isDestructive ? 'bg-red-600 hover:bg-red-500 border-red-500/50 text-white' : 'bg-white hover:bg-gray-200 text-black border-transparent'}`} 
                            onClick={confirmDialog?.action}
                        >
                            Conferma
                        </Button>
                    </DialogFooter>
                 </DialogContent>
            </Dialog>
        </motion.div>
    );
}

