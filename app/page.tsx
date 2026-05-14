'use client';

import { useAuth } from '@/lib/auth-context';
import { usePlayerStore } from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { Player } from '@/components/Player';
import { AuthForm } from '@/components/AuthForm';
import { useEffect, useState, Component } from 'react';
import { MainContent } from '@/components/MainContent';
import { BottomNav } from '@/components/BottomNav';

// Simple error boundary to prevent Player crashes from taking down the whole page
class PlayerErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error('Player error boundary caught:', error);
  }
  render() {
    if (this.state.hasError) {
      // Silently recover — the next track change or user interaction will remount
      return null;
    }
    return this.props.children;
  }
}

export default function Home() {
  const { user, loading } = useAuth();
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId || 'none');
  
  const [currentView, setCurrentView] = useState('home');
  const [currentPlaylist, setCurrentPlaylist] = useState(null);
  const [createPlaylistDialog, setCreatePlaylistDialog] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  useEffect(() => {
    requestAnimationFrame(() => {
      document.getElementById('main-scroll-area')?.scrollTo({ top: 0 });
    });
  }, [currentView, currentPlaylist?.id]);

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
      <PlayerErrorBoundary key={currentTrackId}>
        <Player />
      </PlayerErrorBoundary>
    </div>
  );
}
