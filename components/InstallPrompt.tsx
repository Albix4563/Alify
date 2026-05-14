'use client';

import { useState, useEffect } from 'react';
import { Download, X, Share, PlusSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true); // default true to avoid hydration mismatch, check in useEffect
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(isPWA);

    if (isPWA) return;

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    if (isIOSDevice) {
        const dismissed = localStorage.getItem('pwa_prompt_dismissed');
        if (!dismissed) {
             // Delay to not bombard immediately
             setTimeout(() => setShowPrompt(true), 3000);
        }
    }

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const dismissed = localStorage.getItem('pwa_prompt_dismissed');
      if (!dismissed) {
          setShowPrompt(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    }
  };

  const dismissPrompt = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  if (isStandalone) return null;

  return (
    <AnimatePresence>
      {showPrompt && (
        <motion.div
           initial={{ opacity: 0, y: 50 }}
           animate={{ opacity: 1, y: 0 }}
           exit={{ opacity: 0, y: 50 }}
           className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 bg-[#121215]/95 backdrop-blur-xl border border-white/10 p-5 rounded-[24px] shadow-2xl z-[100]"
        >
          <div className="flex justify-between items-start mb-2">
             <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-sky-500/10 rounded-[14px] border border-sky-500/20 flex items-center justify-center">
                     <Download className="w-6 h-6 text-sky-400" />
                 </div>
                 <div>
                     <h3 className="font-bold text-white text-base">Installa Albify</h3>
                     <p className="text-sm text-white/50 leading-tight mt-0.5">Accesso più rapido dalla schermata Home</p>
                 </div>
             </div>
             <button onClick={dismissPrompt} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                 <X className="w-4 h-4" />
             </button>
          </div>

          <div className="mt-5">
             {isIOS ? (
                <div className="bg-white/5 rounded-[16px] p-4 text-sm text-white/80">
                    <p className="font-medium mb-3 text-white">Come installare su iOS:</p>
                    <ol className="space-y-3">
                        <li className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-xs">1</div>
                            <span>Tocca il tasto Condividi <Share className="inline w-4 h-4 mx-1 text-sky-400" /> in basso</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-xs">2</div>
                            <span>Scegli <strong>&quot;Aggiungi alla schermata Home&quot;</strong> <PlusSquare className="inline w-4 h-4 mx-1 text-sky-400" /></span>
                        </li>
                        <li className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-xs">3</div>
                            <span>Tocca <strong>&quot;Aggiungi&quot;</strong> in alto a destra</span>
                        </li>
                    </ol>
                </div>
             ) : (
                <button 
                  onClick={handleInstall}
                  className="w-full py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-bold transition-all shadow-[0_4px_20px_rgba(14,165,233,0.3)] hover:shadow-[0_4px_25px_rgba(14,165,233,0.4)] active:scale-95"
                >
                  Installa App
                </button>
             )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
