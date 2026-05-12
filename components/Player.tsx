'use client';

import { usePlayerStore, Track, AudioQuality } from '@/lib/store';
import { Pause, Play, SkipForward, Repeat, Repeat1, Shuffle, Maximize2, Minimize2, Loader2, Sparkles, ChevronDown, Activity } from 'lucide-react';
import ReactPlayer from 'react-youtube';
import { useRef, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

export function Player() {
  const { user } = useAuth();
  const { currentTrack, isPlaying, setIsPlaying, playNext, loopMode, setLoopMode, shuffleMode, setShuffleMode, videoExpanded, setVideoExpanded, queue, setQueue, audioQuality } = usePlayerStore();
  const playerRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [isFetchingDJ, setIsFetchingDJ] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
  const [lastY, setLastY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [seekAnimation, setSeekAnimation] = useState<'forward' | 'backward' | null>(null);

  const triggerSeekAnimation = (type: 'forward' | 'backward') => {
      setSeekAnimation(type);
      setTimeout(() => setSeekAnimation(null), 500);
  };

  useEffect(() => {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const mainArea = document.getElementById('main-scroll-area');
    if (!mainArea) return;

    const handleScroll = () => {
      const latest = mainArea.scrollTop;
      if (latest - lastY > 20 && latest > 50) {
        setScrollingDown(true);
      } else if (lastY - latest > 20) {
        setScrollingDown(false);
      }
      setLastY(latest);
    };

    mainArea.addEventListener('scroll', handleScroll, { passive: true });
    return () => mainArea.removeEventListener('scroll', handleScroll);
  }, [lastY]);

  useEffect(() => {
    if (currentTrack) {
        setCurrentTime(0);
        setDuration(0);
        if (window.innerWidth < 768) {
           setIsMobileExpanded(true);
        }
    }
    if (user && currentTrack) {
        setDoc(doc(db, 'users', user.uid, 'history', currentTrack.videoId), {
            track: currentTrack,
            playedAt: serverTimestamp()
        }, { merge: true }).catch(e => console.error("Error saving history:", e));
    }
  }, [currentTrack, user]);

  const safePlayerCall = async (method: string, args: any[] = []) => {
    try {
      const p = playerRef.current?.internalPlayer || playerRef.current?.getInternalPlayer?.();
      if (p && typeof p[method] === 'function') {
        return await p[method](...args);
      }
    } catch (e) {
      console.warn(`SafePlayerCall ${method} error:`, e);
    }
  };

  useEffect(() => {
    const applyQuality = async () => {
      if (!isReady) return;
      
      let target = 'default';
      const connection = (navigator as any).connection;

      if (audioQuality === 'basso') {
        target = 'medium'; // 360p
      } else if (audioQuality === 'medio') {
        target = 'hd720';
      } else if (audioQuality === 'alto') {
        target = 'hd1080';
      } else if (audioQuality === 'auto') {
        if (connection) {
          const type = connection.effectiveType;
          // In "auto", we default to "medio" and downgrade to "basso" if connection is poor
          if (type === '4g') {
            target = 'hd720';
          } else {
            target = 'medium';
          }
        } else {
          target = 'hd720'; // Default is Medium for Auto
        }
      }

      await safePlayerCall('setPlaybackQuality', [target]);
    };

    applyQuality();

    // Listen for connection changes in Auto mode
    const connection = (navigator as any).connection;
    if (audioQuality === 'auto' && connection) {
      const handleConnectionChange = () => {
         applyQuality();
      };
      connection.addEventListener('change', handleConnectionChange);
      return () => connection.removeEventListener('change', handleConnectionChange);
    }
  }, [audioQuality, isReady, currentTrack?.videoId]);

  const handleNext = useCallback(async () => {
    if (loopMode === 'one' && playerRef.current) {
        await safePlayerCall('seekTo', [0]);
        await safePlayerCall('playVideo');
        return;
    }
    
    playNext();
  }, [loopMode, playNext]);

  useEffect(() => {
    if (currentTrack && 'mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: currentTrack.title,
            artist: currentTrack.channelTitle,
            artwork: [{ src: currentTrack.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }]
        });
        navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
        navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
    }
  }, [currentTrack, setIsPlaying, handleNext]);

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
    if (!isPlaying) {
         safePlayerCall('playVideo');
    } else {
         safePlayerCall('pauseVideo');
    }
  };

  useEffect(() => {
     // react-youtube will handle autoplay on load and track change due to playerVars={autoplay: 1}.
     // We only sync play state on explicit UI triggers (via togglePlayPause),
     // but we can also have a strict check to ensure it doesn't get out of sync, safely ignoring videoId changes.
     if (isReady && playerRef.current) {
         if (isPlaying) safePlayerCall('playVideo');
         else safePlayerCall('pauseVideo');
     }
  }, [isPlaying]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && isReady && playerRef.current && !isSeeking) {
      interval = setInterval(async () => {
        try {
          const time = await safePlayerCall('getCurrentTime');
          const dur = await safePlayerCall('getDuration');
          if(time !== undefined) setCurrentTime(time);
          if(dur !== undefined && dur > 0 && duration === 0) setDuration(dur);
        } catch (e) {}
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isReady, isSeeking, duration]);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSeeking(true);
    setCurrentTime(parseFloat(e.target.value));
  };

  const handleSeekCommit = () => {
    safePlayerCall('seekTo', [currentTime]);
    setIsSeeking(false);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!currentTrack) return null;

  const toggleLoop = () => {
     if (loopMode === 'off') setLoopMode('all');
     else if (loopMode === 'all') setLoopMode('one');
     else setLoopMode('off');
  };

  const handlePlayerReady = (e: any) => {
      setIsReady(true);
      if (currentTime > 0) {
          e.target.seekTo(currentTime);
      }
      if (isPlaying) {
          e.target.playVideo();
      }
  };

  return (
    <>
      <div 
         className={`
           pointer-events-none
           ${isMobileExpanded && currentTrack ? 'fixed inset-0 z-[98] bg-black overflow-hidden flex items-center justify-center' : 'z-[101]'}
           ${!isMobileExpanded && videoExpanded && currentTrack ? 'relative w-full bg-black flex justify-center h-[350px] border-b border-white/10 z-[101]' : ''}
           ${(!isMobileExpanded && !videoExpanded) || !currentTrack ? 'fixed w-0 h-0 opacity-0 overflow-hidden z-[101]' : ''}
         `}
      >
          {!isMobileExpanded && videoExpanded && currentTrack && (
              <button 
                  onClick={() => setVideoExpanded(false)} 
                  className="absolute top-4 right-4 z-[102] pointer-events-auto p-2 bg-black/50 hover:bg-black/80 rounded-full text-white backdrop-blur-md transition-opacity opacity-0 group-hover:opacity-100"
              >
                  <Minimize2 className="w-5 h-5" />
              </button>
          )}
          <div className={`${isMobileExpanded && currentTrack ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[177.77vh] h-[100vh] min-w-[100vw] min-h-[56.25vw] max-w-none opacity-100 pointer-events-none [&>div]:w-full [&>div]:h-full [&_iframe]:w-full [&_iframe]:h-full' : 'w-full h-full [&>div]:w-full [&>div]:h-full [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:object-cover overflow-hidden pointer-events-none'}`}>
             <ReactPlayer 
                ref={playerRef}
                videoId={currentTrack?.videoId || ''}
                opts={{ width: '100%', height: '100%', playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, showinfo: 0, disablekb: 1, playsinline: 1 } }}
                onReady={handlePlayerReady}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnd={handleNext}
                onError={() => { 
                   if (currentTrack) {
                      toast.error("Brano non disponibile o errore di riproduzione."); 
                      handleNext(); 
                   }
                }}
             />
          </div>
      </div>

      {currentTrack && (
        <>
        <AnimatePresence>
          {isMobileExpanded && (
            <motion.div 
              initial={{ y: "100%", opacity: 0, filter: 'blur(20px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: "100%", opacity: 0, filter: 'blur(20px)' }}
            transition={{ type: "spring", stiffness: 350, damping: 28, mass: 1 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, { offset, velocity }) => {
              if (offset.y > 100 || velocity.y > 500) {
                 setIsMobileExpanded(false);
              }
            }}
            className="fixed inset-0 z-[100] bg-gradient-to-t from-black/60 to-transparent flex flex-col px-4 pt-10 pb-4 touch-none"
          >
              <div className="flex items-center justify-between z-[102] relative">
                  <button onClick={() => setIsMobileExpanded(false)} className="p-2 -ml-2 text-white hover:bg-white/10 rounded-full transition-colors drop-shadow-lg">
                      <ChevronDown className="w-6 h-6 z-[102]" />
                  </button>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white drop-shadow-lg z-[102]">In riproduzione</span>
                  <div className="w-6" />
              </div>

              {/* Gesture overlay for Double Tap to Seek */}
              <div className="absolute inset-x-0 top-20 bottom-[30vh] z-[101] flex">
                  <div className="flex-1 flex items-center justify-center transition-opacity" 
                       onDoubleClick={() => {
                           const newTime = Math.max(0, currentTime - 10);
                           safePlayerCall('seekTo', [newTime]);
                           setCurrentTime(newTime);
                           triggerSeekAnimation('backward');
                       }} 
                  >
                      <AnimatePresence>
                          {seekAnimation === 'backward' && (
                              <motion.div 
                                  initial={{ opacity: 0, scale: 0.5, x: 20 }}
                                  animate={{ opacity: 1, scale: 1, x: 0 }}
                                  exit={{ opacity: 0, scale: 1.5, x: -20 }}
                                  className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-md"
                              >
                                  <SkipForward className="w-8 h-8 text-white rotate-180" />
                              </motion.div>
                          )}
                      </AnimatePresence>
                  </div>
                  <div className="flex-1 flex items-center justify-center transition-opacity" 
                       onDoubleClick={() => {
                           const newTime = Math.min(duration, currentTime + 10);
                           safePlayerCall('seekTo', [newTime]);
                           setCurrentTime(newTime);
                           triggerSeekAnimation('forward');
                       }} 
                  >
                      <AnimatePresence>
                          {seekAnimation === 'forward' && (
                              <motion.div 
                                  initial={{ opacity: 0, scale: 0.5, x: -20 }}
                                  animate={{ opacity: 1, scale: 1, x: 0 }}
                                  exit={{ opacity: 0, scale: 1.5, x: 20 }}
                                  className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-md"
                              >
                                  <SkipForward className="w-8 h-8 text-white" />
                              </motion.div>
                          )}
                      </AnimatePresence>
                  </div>
              </div>

              <div className="flex flex-col justify-end w-full mt-auto mb-0 z-[102] pt-10">
                  <div className="flex flex-col mb-1.5">
                      <h2 className="text-lg font-bold text-white truncate drop-shadow-lg">{currentTrack.title}</h2>
                      <p className="text-xs text-blue-300 truncate font-medium drop-shadow-md">{currentTrack.channelTitle}</p>
                  </div>

                  <div className="flex flex-col gap-1 mb-1.5 w-full group/slider">
                      <div className="relative flex flex-col justify-center h-2">
                          <input 
                              type="range"
                              min={0}
                              max={duration || 100}
                              value={currentTime}
                              onChange={handleSeekChange}
                              onMouseUp={handleSeekCommit}
                              onTouchEnd={handleSeekCommit}
                              className="absolute z-10 w-full h-full opacity-0 cursor-pointer touch-pan-x"
                          />
                          <div className="w-full h-[3px] bg-white/30 rounded-full overflow-hidden shadow-inner border border-white/10">
                              <div className="h-full bg-blue-500 rounded-full transition-all duration-150 ease-out shadow-[0_0_10px_rgba(59,130,246,0.8)]" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
                          </div>
                      </div>
                      <div className="flex justify-between text-[9px] font-bold tracking-wider text-white drop-shadow-md">
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                      </div>
                  </div>

                  <div className="flex items-center justify-between mb-2">
                      <button className={`p-1.5 rounded-full backdrop-blur-md transition-all ${shuffleMode ? 'bg-blue-500/30 text-white shadow-[0_4px_15px_rgba(59,130,246,0.5)]' : 'bg-black/20 text-white/80 hover:bg-black/40 shadow-lg'}`} onClick={() => setShuffleMode(!shuffleMode)}>
                          <Shuffle className="w-3.5 h-3.5 stroke-[2]" />
                      </button>
                      <button className="p-1.5 rounded-full backdrop-blur-md bg-black/20 text-white hover:bg-black/40 shadow-lg hover:scale-105 transition-all active:scale-95 border border-white/5" onClick={handleNext}>
                          <SkipForward className="w-4 h-4 fill-currentColor rotate-180 drop-shadow-md" />
                      </button>
                      <button 
                          className="w-10 h-10 flex items-center justify-center bg-blue-500/30 text-white backdrop-blur-xl border border-blue-400/50 shadow-[0_8px_32px_rgba(59,130,246,0.5)] rounded-full hover:scale-105 active:scale-95 transition-all" 
                          onClick={togglePlayPause}
                      >
                          {isPlaying ? <Pause className="w-4 h-4 fill-currentColor drop-shadow-lg" /> : <Play className="w-4 h-4 fill-currentColor ml-0.5 drop-shadow-lg" />}
                      </button>
                      <button className="p-1.5 rounded-full backdrop-blur-md bg-black/20 text-white hover:bg-black/40 shadow-lg hover:scale-105 transition-all active:scale-95 border border-white/5" onClick={handleNext}>
                          <SkipForward className="w-4 h-4 fill-currentColor drop-shadow-md" />
                      </button>
                      <button className={`p-1.5 rounded-full backdrop-blur-md transition-all ${loopMode !== 'off' ? 'bg-blue-500/30 text-white shadow-[0_4px_15px_rgba(59,130,246,0.5)]' : 'bg-black/20 text-white/80 hover:bg-black/40 shadow-lg'}`} onClick={toggleLoop}>
                          {loopMode === 'one' ? <Repeat1 className="w-3.5 h-3.5 stroke-[2]" /> : <Repeat className="w-3.5 h-3.5 stroke-[2]" />}
                      </button>
                  </div>
              </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
         initial={false}
         animate={{
            y: isMobileExpanded ? 0 : (isMobile ? (scrollingDown ? 76 : 0) : 0),
            scale: isMobile && scrollingDown ? 0.95 : 1,
            x: 0 // reset x
         }}
         drag={isMobile && !isMobileExpanded ? "x" : false}
         dragConstraints={{ left: 0, right: 0 }}
         dragElastic={0.7}
         onDragEnd={(e, { offset, velocity }) => {
            if (isMobile && !isMobileExpanded) {
               if (offset.x < -80 || velocity.x < -500) {
                   handleNext();
               }
            }
         }}
         transition={{ type: "spring", stiffness: 400, damping: 25, mass: 1 }}
         className={`fixed z-50 left-3 right-3 bottom-[96px] md:bottom-6 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[760px] bg-black/60 backdrop-blur-3xl border border-white/20 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.6)] flex flex-col transition-opacity duration-300 ${isMobileExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
         onClick={(e) => {
             if (window.innerWidth < 768 && (e.target as HTMLElement).closest('.player-footer-clickable')) {
                 setIsMobileExpanded(true);
             }
         }}
      >
        <footer className="player-footer-clickable h-[64px] md:h-[72px] px-2 flex py-1 flex-shrink-0 items-center justify-between w-full cursor-pointer md:cursor-default overflow-hidden hover:bg-white/5 transition-colors rounded-[24px]">
          <div className="flex items-center flex-1 md:w-[30%] md:flex-none md:min-w-[180px] overflow-hidden drop-shadow-md">
            <div className="w-11 h-11 md:w-14 md:h-14 bg-black/40 rounded-[12px] md:rounded-[16px] overflow-hidden flex-shrink-0 mr-3 border border-white/10 shadow-lg relative ml-1">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
              <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover relative z-0" />
            </div>
            <div className="overflow-hidden flex flex-col justify-center">
              <h4 className="text-[13px] md:text-[14px] font-bold truncate text-white leading-tight mb-1">{currentTrack.title}</h4>
              <p className="text-[11px] md:text-[12px] font-medium text-blue-300/70 truncate leading-tight">{currentTrack.channelTitle}</p>
            </div>
          </div>

          <div className="flex md:hidden items-center justify-end gap-3 ml-4" onClick={e => e.stopPropagation()}>
              <button className="p-2 text-white/70 hover:text-white transition-colors" onClick={handleNext}>
                  <SkipForward className="w-5 h-5 fill-currentColor" />
              </button>
              <button 
                  className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white transition-all active:scale-95" 
                  onClick={togglePlayPause}
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-currentColor" /> : <Play className="w-5 h-5 fill-currentColor ml-1" />}
              </button>
          </div>

          <div className="hidden md:flex flex-col items-center max-w-[722px] w-[40%]">
            <div className="flex items-center justify-center gap-6 mb-2">
               <button 
                  className={`transition-colors hover:scale-110 flex items-center justify-center ${shuffleMode ? 'text-sky-400' : 'text-blue-200/60 hover:text-white'}`}
                  onClick={() => setShuffleMode(!shuffleMode)}
                  title="Casuale"
               >
                  <Shuffle className="w-4 h-4 md:w-5 md:h-5 fill-currentColor drop-shadow-md" />
               </button>
               <button className="text-blue-200/60 hover:text-white transition-colors hover:scale-110" onClick={handleNext}>
                  <SkipForward className="w-5 h-5 fill-currentColor drop-shadow-md rotate-180" />
               </button>
               <button 
                  className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md border border-white/10 shadow-[0_0_15px_rgba(56,189,248,0.2)] text-blue-200 hover:text-white transition-all hover:scale-105" 
                  onClick={togglePlayPause}
                >
                  {isPlaying ? <Pause className="w-6 h-6 fill-currentColor text-white drop-shadow-md" /> : <Play className="w-6 h-6 fill-currentColor ml-1 text-white drop-shadow-md" />}
               </button>
               <button className="text-blue-200/60 hover:text-white transition-colors hover:scale-110 relative" onClick={handleNext}>
                  <SkipForward className="w-5 h-5 fill-currentColor drop-shadow-md" />
               </button>
               <button 
                  className={`transition-colors hover:scale-110 flex items-center justify-center ${loopMode !== 'off' ? 'text-sky-400' : 'text-blue-200/60 hover:text-white'}`}
                  onClick={toggleLoop}
                  title="Ripeti"
               >
                  {loopMode === 'one' ? <Repeat1 className="w-4 h-4 md:w-5 md:h-5 drop-shadow-md" /> : <Repeat className="w-4 h-4 md:w-5 md:h-5 drop-shadow-md" />}
               </button>
            </div>
            <div className="w-full flex items-center gap-2 group">
                <span className="text-[11px] font-medium text-blue-200/60 w-10 text-right">{formatTime(currentTime)}</span>
                <div className="relative flex-1 flex items-center group/slider h-4">
                    <div className="absolute w-full h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-white transition-all group-hover/slider:bg-sky-400" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
                    </div>
                    <input 
                        type="range"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        onChange={handleSeekChange}
                        onMouseUp={handleSeekCommit}
                        onTouchEnd={handleSeekCommit}
                        className="absolute w-full h-full opacity-0 cursor-pointer"
                    />
                </div>
                <span className="text-[11px] font-medium text-blue-200/60 w-10">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="hidden md:flex items-center justify-end w-[30%] min-w-[180px] pr-2 gap-4">
              <button 
                 className="text-blue-200/60 hover:text-white transition-colors hover:scale-110" 
                 onClick={() => setVideoExpanded(!videoExpanded)}
                 title={videoExpanded ? "Riduci Finestra Video" : "Ingrandisci Video"}
              >
                 {videoExpanded ? <Minimize2 className="w-5 h-5 drop-shadow-md" /> : <Maximize2 className="w-5 h-5 drop-shadow-md" />}
              </button>
          </div>
        </footer>
      </motion.div>
      </>
      )}
    </>
  );
}
