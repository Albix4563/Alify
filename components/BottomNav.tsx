'use client';

import { Home, Search, Heart, Sparkles, User, LogOut, Library } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';
import { usePlayerStore } from '@/lib/store';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

export function BottomNav({ currentView, setCurrentView }: any) {
  const [hidden, setHidden] = useState(false);
  const [lastY, setLastY] = useState(0);
  const { currentTrack } = usePlayerStore();
  const { logout } = useAuth();
  
  // Show menu indicator
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const mainArea = document.getElementById('main-scroll-area');
    if (!mainArea) return;

    const handleScroll = () => {
      const latest = mainArea.scrollTop;
      if (latest - lastY > 20 && latest > 50) {
        // Scroll down
        setHidden(true);
        setShowMenu(false);
      } else if (lastY - latest > 20) {
        // Scroll up
        setHidden(false);
      }
      setLastY(latest);
    };

    mainArea.addEventListener('scroll', handleScroll, { passive: true });
    return () => mainArea.removeEventListener('scroll', handleScroll);
  }, [lastY]);

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'search', icon: Search, label: 'Cerca' },
    { id: 'library', icon: Library, label: 'Libreria' },
    { id: 'ai-dj', icon: Sparkles, label: 'Ai DJ' }
  ];

  const handleLogout = () => {
    logout();
    toast.info('Disconnesso con successo!');
  }

  // The Player now floats above the BottomNav on mobile.
  const bottomOffset = 'bottom-6';

  return (
    <>
      <AnimatePresence>
        {!hidden && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`fixed ${bottomOffset} left-4 right-4 z-40 md:hidden flex justify-center`}
          >
            <div className="w-full max-w-[400px] bg-black/60 backdrop-blur-3xl border border-white/20 rounded-[24px] p-2 flex items-center justify-around shadow-[0_8px_30px_rgb(0,0,0,0.6)] relative">
              {navItems.map((item) => {
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                        setCurrentView(item.id);
                        setShowMenu(false);
                    }}
                    className={`flex flex-col items-center justify-center w-14 h-12 rounded-2xl relative transition-all ${
                      isActive ? 'text-white' : 'text-blue-200/60 hover:text-white'
                    }`}
                  >
                    {isActive && (
                       <motion.div
                         layoutId="bottomNavIndicator"
                         className="absolute inset-0 bg-white/10 rounded-2xl"
                         transition={{ type: "spring", stiffness: 300, damping: 30 }}
                       />
                    )}
                    <item.icon className="w-5 h-5 relative z-10 mb-0.5" strokeWidth={isActive ? 2.5 : 2} />
                    <span className="text-[10px] font-medium relative z-10">{item.label}</span>
                  </button>
                );
              })}
              
              <div className="w-[1px] h-8 bg-white/10 mx-1"></div>
              
              <button
                onClick={() => setShowMenu(!showMenu)}
                className={`flex flex-col items-center justify-center w-14 h-12 rounded-2xl relative transition-all ${
                  showMenu ? 'text-white bg-white/10' : 'text-blue-200/60 hover:text-white'
                }`}
              >
                <User className="w-5 h-5 relative z-10 mb-0.5" />
                <span className="text-[10px] font-medium relative z-10">Account</span>
              </button>
            </div>

            <AnimatePresence>
              {showMenu && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute bottom-full right-0 mb-4 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-xl w-48 origin-bottom-right"
                >
                   <button onClick={handleLogout} className="flex items-center gap-3 text-sm font-medium text-red-400 hover:text-red-300 w-full p-2 bg-white/5 rounded-xl transition-colors">
                     <LogOut className="w-4 h-4" /> Disconnetti
                   </button>
                </motion.div>
              )}
            </AnimatePresence>

          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
