'use client';

import { useAuth } from '@/lib/auth-context';
import { Home, Search, Heart, ListMusic, Plus, PlaySquare, Sparkles, Library, PanelLeftClose } from 'lucide-react';
import { ReactElement, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export function Sidebar({ currentView, setCurrentView, currentPlaylist, setCurrentPlaylist, setCreatePlaylistDialog, isVisible, setIsVisible }: any) {
  const { user, logout } = useAuth();
  const [playlists, setPlaylists] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'playlists'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const lists: any[] = [];
        snapshot.forEach((doc) => lists.push({ id: doc.id, ...doc.data() }));
        setPlaylists(lists);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'playlists'));
    return () => unsubscribe();
  }, [user]);

  const navItems = [
    { id: 'home', icon: Home, label: 'Pagina Iniziale' },
    { id: 'search', icon: Search, label: 'Cerca' },
    { id: 'library', icon: Library, label: 'La tua Libreria' },
    { id: 'ai-dj', icon: Sparkles, label: 'DJ Automatico' }
  ];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.aside 
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 256, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="bg-white/5 backdrop-blur-2xl hidden md:flex flex-col border-r border-white/10 h-full z-10 flex-shrink-0 relative overflow-hidden"
        >
          <div className="absolute inset-y-0 right-0 w-[1px] bg-gradient-to-b from-transparent via-blue-500/20 to-transparent"></div>
          
          <div className="p-6 pb-2 overflow-y-auto flex-1 custom-scrollbar z-10 w-64">
            <div className="flex items-center gap-2.5 mb-8 justify-between">
              <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setCurrentView('home')}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.4)] flex-shrink-0 backdrop-blur-sm border border-white/20">
                  <div className="w-[14px] h-[14px] bg-white rounded-full"></div>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md">Albify</h1>
              </div>
              <button onClick={() => setIsVisible(false)} className="text-blue-200/50 hover:text-white transition-colors" title="Nascondi Sidebar">
                <PanelLeftClose className="w-5 h-5" />
              </button>
            </div>
            
            <nav className="space-y-2 relative">
              {navItems.map((item) => (
                 <div key={item.id} className="relative">
                    {currentView === item.id && (
                      <motion.div
                        layoutId="waterDrop"
                        className="absolute -left-3 top-[10%] bottom-[10%] w-1.5 bg-gradient-to-b from-sky-400 to-blue-500 rounded-r-full shadow-[0_0_8px_rgba(56,189,248,0.6)]"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    <button 
                      onClick={() => setCurrentView(item.id)} 
                      className={`flex items-center gap-4 font-bold transition-colors w-full text-left text-sm py-2 px-2 rounded-lg 
                        ${currentView === item.id ? 'text-white bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-blue-100/60 hover:text-white hover:bg-white/5'}`}
                    >
                      <item.icon className="w-6 h-6 drop-shadow-sm" /> {item.label}
                    </button>
                 </div>
              ))}
            </nav>

            <div className="mt-8">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-blue-200/50 mb-4 px-2">Le tue Playlist</h2>
              <div className="space-y-1">
                <button className="flex items-center gap-3 w-full text-left text-blue-100/60 hover:text-white hover:bg-white/5 py-2 px-2 rounded-lg transition-colors group" onClick={() => setCreatePlaylistDialog(true)}>
                  <div className="w-6 h-6 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                     <Plus className="w-4 h-4 text-blue-100/80 group-hover:text-white transition-colors" />
                  </div>
                  <span className="font-bold text-sm">Crea Playlist</span>
                </button>
                
                <div className="pt-2 space-y-1">
                   {playlists.map((p) => (
                      <div key={p.id} className="relative">
                         {currentPlaylist?.id === p.id && currentView === 'playlist' && (
                            <motion.div
                              layoutId="waterDrop"
                              className="absolute -left-3 top-[10%] bottom-[10%] w-1.5 bg-gradient-to-b from-sky-400 to-blue-400 rounded-r-full shadow-[0_0_8px_rgba(56,189,248,0.6)]"
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            />
                         )}
                        <button 
                           className={`flex items-center gap-3 w-full text-left text-sm truncate py-2 px-2 rounded-lg transition-colors 
                            ${currentPlaylist?.id === p.id && currentView === 'playlist' ? 'text-white font-medium bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-blue-100/60 hover:text-white hover:bg-white/5 font-medium'}`}
                           onClick={() => { setCurrentPlaylist(p); setCurrentView('playlist'); }}
                        >
                           <ListMusic className="w-4 h-4 min-w-4 opacity-70" />
                           <span className="truncate">{p.title}</span>
                        </button>
                      </div>
                   ))}
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 pt-2 z-10 backdrop-blur-md bg-white/5 border-t border-white/10 w-64">
            <div className={`bg-black/20 backdrop-blur-xl border ${currentView === 'profile' ? 'border-sky-500/50 bg-white/10' : 'border-white/10 hover:bg-white/10'} rounded-2xl p-4 cursor-pointer transition-colors flex flex-col gap-1 shadow-lg`}
                 onClick={() => setCurrentView('profile')}>
              <p className="text-[10px] text-blue-300/80 font-bold tracking-wider mb-1 drop-shadow-sm">ACCOUNT</p>
              <h3 className="text-[13px] font-bold text-white mb-2 truncate drop-shadow-sm">{user?.displayName || 'Utente'}</h3>
              <button onClick={(e) => { e.stopPropagation(); logout(); toast.info('Disconnesso con successo!'); }} className="w-full py-1.5 bg-gradient-to-r from-blue-700 to-sky-600 text-white text-[11px] font-bold rounded-full transition-all hover:brightness-110">Disconnettiti</button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

