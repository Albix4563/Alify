import type {Metadata} from 'next';
import './globals.css';
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { AuthProvider } from '@/lib/auth-context';
import { BackgroundEffects } from '@/components/BackgroundEffects';
import { InstallPrompt } from '@/components/InstallPrompt';

import { Toaster } from 'sonner';

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'Albify',
  description: 'Web app based on YouTube.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/assets/logo.png',
    apple: '/assets/logo.png',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning className="bg-background text-white">
        <BackgroundEffects />
        <AuthProvider>
          {children}
          <InstallPrompt />
          <Toaster theme="dark" position="top-center" toastOptions={{ className: 'bg-black/80 backdrop-blur-md text-white border-white/10 shadow-2xl' }} />
        </AuthProvider>
      </body>
    </html>
  );
}
