'use client';

import { MotionConfig } from 'motion/react';
import { AuthProvider } from '@/lib/auth-context';
import { Toaster } from 'sonner';

// Suppress the reduced motion warning from logs
if (typeof console !== 'undefined') {
  const originalLog = console.log;
  const originalWarn = console.warn;
  
  console.log = function(...args) {
    if (typeof args[0] === 'string' && args[0].includes('Reduced Motion enabled')) return;
    originalLog.apply(console, args);
  };
  
  console.warn = function(...args) {
    if (typeof args[0] === 'string' && args[0].includes('Reduced Motion enabled')) return;
    originalWarn.apply(console, args);
  };
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        {children}
        <Toaster theme="dark" position="top-center" toastOptions={{ className: 'bg-black/80 backdrop-blur-md text-white border-white/10 shadow-2xl' }} />
      </AuthProvider>
    </MotionConfig>
  );
}
