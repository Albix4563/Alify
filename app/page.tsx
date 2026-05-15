'use client';

import { useAuth } from '@/lib/auth-context';
import { usePlayerStore } from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { Player } from '@/components/Player';
import { AuthForm } from '@/components/AuthForm';
import { useEffect, useState, Component, useCallback } from 'react';
import { MainContent } from '@/components/MainContent';
import { BottomNav } from '@/components/BottomNav';

const VALID_VIEWS = new Set(['home', 'search', 'library', 'playlist', 'profile', 'changelog', 'import']);

// Simple error boundary to prevent Player crashes from taking down the whole page
class PlayerErrorBoundary extends Component<{ children: React.ReactNode; resetKey: string }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; resetKey: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error('Player error boundary caught:', error);
  }
  componentDidUpdate(prevProps: { resetKey: string }) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      // Silently recover — the next track change or user interaction will remount
      return null;
    }
    return this.props.children;
  }
}

class MainContentErrorBoundary extends Component<
  { children: React.ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error('MainContent error boundary caught:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 md:p-8">
          <div className="max-w-xl rounded-[28px] border border-red-500/20 bg-[#121215]/85 p-6 text-white shadow-2xl backdrop-blur-2xl">
            <h2 className="text-lg font-bold">La schermata non si e caricata correttamente.</h2>
            <p className="mt-2 text-sm text-blue-100/70">
              Ho bloccato il crash del contenuto per evitare una schermata vuota.
            </p>
            <button
              onClick={this.props.onReset}
              className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/20"
            >
              Torna alla Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Home() {
  const { user, loading } = useAuth();
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.videoId || 'none');
  
  const [currentView, setCurrentView] = useState('home');
  const [currentPlaylist, setCurrentPlaylist] = useState<any | null>(null);
  const [createPlaylistDialog, setCreatePlaylistDialog] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  const setSafeCurrentView = useCallback((nextView: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('albify:collapse-player'));
    }
    setCurrentView(VALID_VIEWS.has(nextView) ? nextView : 'home');
  }, []);

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
          setCurrentView={setSafeCurrentView}
          currentPlaylist={currentPlaylist}
          setCurrentPlaylist={setCurrentPlaylist}
          setCreatePlaylistDialog={setCreatePlaylistDialog}
          isVisible={isSidebarVisible}
          setIsVisible={setIsSidebarVisible}
        />
        
        <main id="main-scroll-area" className="flex-1 w-full bg-transparent overflow-y-auto overflow-x-hidden relative z-0 overscroll-y-contain">
          <MainContentErrorBoundary
            key={`${currentView}:${currentPlaylist?.id ?? 'none'}:${currentTrackId}`}
            onReset={() => setSafeCurrentView('home')}
          >
            <MainContent 
               currentView={currentView} 
               currentPlaylist={currentPlaylist}
               setCurrentView={setSafeCurrentView}
               createPlaylistDialog={createPlaylistDialog}
               setCreatePlaylistDialog={setCreatePlaylistDialog}
               setCurrentPlaylist={setCurrentPlaylist}
               isSidebarVisible={isSidebarVisible}
               setIsSidebarVisible={setIsSidebarVisible}
            />
          </MainContentErrorBoundary>
        </main>
      </div>
      <BottomNav currentView={currentView} setCurrentView={setSafeCurrentView} />
      <PlayerErrorBoundary resetKey={currentTrackId}>
        <Player />
      </PlayerErrorBoundary>
    </div>
  );
}
