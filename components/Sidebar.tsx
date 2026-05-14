'use client';

import { useAuth } from '@/lib/auth-context';
import { Home, Search, Heart, ListMusic, Plus, PlaySquare, Sparkles, Library, PanelLeftClose, Download } from 'lucide-react';
import { ReactElement, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';
import { motion } from 'motion/react';
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
  ];

  return (
    <motion.aside 
      initial={false}
      animate={{ width: isVisible ? 256 : 80 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="bg-white/5 backdrop-blur-2xl hidden md:flex flex-col border-r border-white/10 h-full z-10 flex-shrink-0 relative overflow-hidden transition-all"
    >
      <div className="absolute inset-y-0 right-0 w-[1px] bg-gradient-to-b from-transparent via-blue-500/20 to-transparent"></div>
      
      <div className="p-3 md:p-4 pb-2 overflow-y-auto flex-1 custom-scrollbar z-10 w-full overflow-x-hidden">
        <div className={`flex items-center mb-4 ${isVisible ? 'justify-between gap-2.5' : 'justify-center flex-col gap-4'}`}>
          <div className="flex items-center justify-center cursor-pointer overflow-hidden" onClick={() => setCurrentView('home')}>
            <div className={`transition-all rounded-xl flex items-center justify-center flex-shrink-0 relative drop-shadow-lg ${isVisible ? 'w-32 h-16 object-left' : 'w-12 h-12'}`}>
              <img src="/assets/logo.png" alt="Albify" className="w-full h-full object-contain" style={{ objectPosition: isVisible ? 'left center' : 'center' }} />
            </div>
          </div>
          <button 
            onClick={() => setIsVisible(!isVisible)} 
            className="text-blue-200/50 hover:text-white transition-colors" 
            title={isVisible ? "Nascondi Sidebar" : "Espandi Sidebar"}
          >
            <PanelLeftClose className={`w-5 h-5 transition-transform ${!isVisible ? 'rotate-180' : ''}`} />
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
                    ${currentView === item.id ? 'text-white bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-blue-100/60 hover:text-white hover:bg-white/5'} ${!isVisible && 'justify-center'}`}
                  title={!isVisible ? item.label : undefined}
                >
                  <item.icon className="w-6 h-6 min-w-6 drop-shadow-sm" />
                  {isVisible && <span>{item.label}</span>}
                </button>
             </div>
          ))}
        </nav>

        <div className="mt-8">
          {isVisible ? (
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-blue-200/50 mb-4 px-2">Le tue Playlist</h2>
          ) : (
            <div className="h-[1px] w-8 bg-white/10 mx-auto mb-4" />
          )}
          <div className="space-y-1">
            <button 
              className={`flex items-center gap-3 w-full text-left text-blue-100/60 hover:text-white hover:bg-white/5 py-2 px-2 rounded-lg transition-colors group ${!isVisible && 'justify-center'}`} 
              onClick={() => setCreatePlaylistDialog(true)}
              title={!isVisible ? "Crea Playlist" : undefined}
            >
              <div className="w-6 h-6 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center group-hover:bg-blue-500/20 transition-colors flex-shrink-0">
                 <Plus className="w-4 h-4 text-blue-100/80 group-hover:text-white transition-colors" />
              </div>
              {isVisible && <span className="font-bold text-sm truncate">Crea Playlist</span>}
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
                        ${currentPlaylist?.id === p.id && currentView === 'playlist' ? 'text-white font-medium bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-blue-100/60 hover:text-white hover:bg-white/5 font-medium'} ${!isVisible && 'justify-center'}`}
                       onClick={() => { setCurrentPlaylist(p); setCurrentView('playlist'); }}
                       title={!isVisible ? p.title : undefined}
                    >
                       <ListMusic className="w-5 h-5 min-w-5 opacity-70 flex-shrink-0" />
                       {isVisible && <span className="truncate">{p.title}</span>}
                    </button>
                  </div>
               ))}
            </div>
          </div>
        </div>
      </div>
      <div className={`p-4 pt-2 z-10 backdrop-blur-md bg-white/5 border-t border-white/10 w-full ${!isVisible && 'px-2'}`}>
        {isVisible && (
          <button 
            onClick={() => setCurrentView('changelog')} 
            className="w-full flex items-center justify-between px-3 py-1.5 mb-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors group"
          >
            <span className="text-[11px] font-bold text-blue-200/60 group-hover:text-blue-200/80 uppercase tracking-widest">v0.5 (Beta)</span>
            <span className="text-[10px] text-white/50 group-hover:text-white transition-colors bg-white/5 px-2 py-0.5 rounded-full font-medium border border-white/5">Change log</span>
          </button>
        )}
        <div className={`bg-black/20 backdrop-blur-xl border ${currentView === 'profile' ? 'border-sky-500/50 bg-white/10' : 'border-white/10 hover:bg-white/10'} rounded-2xl p-4 cursor-pointer transition-colors flex ${isVisible ? 'flex-col gap-1' : 'justify-center items-center py-4'} shadow-lg`}
             onClick={() => setCurrentView('profile')}
             title={!isVisible ? "Profilo" : undefined}
        >
          {isVisible ? (
            <>
              <p className="text-[10px] text-blue-300/80 font-bold tracking-wider mb-1 drop-shadow-sm">ACCOUNT</p>
              <h3 className="text-[13px] font-bold text-white mb-2 truncate drop-shadow-sm">{user?.displayName || 'Utente'}</h3>
              <button 
                onClick={(e) => { e.stopPropagation(); logout(); toast.info('Disconnesso con successo!'); }} 
                className="w-full py-1.5 bg-gradient-to-r from-blue-700 to-sky-600 text-white text-[11px] font-bold rounded-full transition-all hover:brightness-110"
              >
                Disconnettiti
              </button>
            </>
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-sky-500 flex items-center justify-center text-white font-bold text-sm uppercase">
              {user?.displayName ? user.displayName.charAt(0) : 'U'}
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

