'use client';

import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/Sidebar';
import { Player } from '@/components/Player';
import { AuthForm } from '@/components/AuthForm';
import { useState } from 'react';
import { MainContent } from '@/components/MainContent';
import { BottomNav } from '@/components/BottomNav';

export default function Home() {
  const { user, loading } = useAuth();
  
  const [currentView, setCurrentView] = useState('home');
  const [currentPlaylist, setCurrentPlaylist] = useState(null);
  const [createPlaylistDialog, setCreatePlaylistDialog] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  if (loading) {
    return <div className="h-[100dvh] w-full flex items-center justify-center bg-transparent text-sky-400">Caricamento...</div>;
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-transparent text-white font-sans overflow-hidden relative z-10">
      <div className="flex flex-1 overflow-hidden w-full relative">
        <Sidebar 
          currentView={currentView} 
          setCurrentView={setCurrentView}
          currentPlaylist={currentPlaylist}
          setCurrentPlaylist={setCurrentPlaylist}
          setCreatePlaylistDialog={setCreatePlaylistDialog}
          isVisible={isSidebarVisible}
          setIsVisible={setIsSidebarVisible}
        />
        
        <main id="main-scroll-area" className="flex-1 w-full bg-transparent overflow-y-auto overflow-x-hidden relative z-0 overscroll-y-contain">
          <MainContent 
             currentView={currentView} 
             currentPlaylist={currentPlaylist}
             setCurrentView={setCurrentView}
             createPlaylistDialog={createPlaylistDialog}
             setCreatePlaylistDialog={setCreatePlaylistDialog}
             setCurrentPlaylist={setCurrentPlaylist}
             isSidebarVisible={isSidebarVisible}
             setIsSidebarVisible={setIsSidebarVisible}
          />
        </main>
      </div>
      <BottomNav currentView={currentView} setCurrentView={setCurrentView} />
      <Player />
    </div>
  );
}
