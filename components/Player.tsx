'use client';

import { usePlayerStore } from '@/lib/store';
import { Pause, Play, SkipForward, SkipBack, Rewind, FastForward, Heart, ListPlus, Repeat, Repeat1, Shuffle, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import ReactPlayer from 'react-youtube';
import { useRef, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

export function Player({ currentView }: { currentView?: string }) {
  const { user } = useAuth();
  const { currentTrack, isPlaying, setIsPlaying, playNext, playRequestId, loopMode, setLoopMode, shuffleMode, setShuffleMode, videoExpanded, setVideoExpanded } = usePlayerStore();
  const playerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const desiredPlayingRef = useRef(false);
  const streamRequestRef = useRef(0);
  const lastPlayRequestRef = useRef(0);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [streamVideoId, setStreamVideoId] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
  const [lastY, setLastY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [seekAnimation, setSeekAnimation] = useState<'forward' | 'backward' | null>(null);
  const [miniSwipeFeedback, setMiniSwipeFeedback] = useState<'next' | 'rewind' | null>(null);
  const lastViewRef = useRef<string | undefined>(currentView);

  const triggerSeekAnimation = (type: 'forward' | 'backward') => {
      setSeekAnimation(type);
      setTimeout(() => setSeekAnimation(null), 500);
  };

  const triggerMiniSwipeFeedback = (type: 'next' | 'rewind') => {
      setMiniSwipeFeedback(type);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(15);
      }
      setTimeout(() => setMiniSwipeFeedback(null), 450);
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
        setIsStreamReady(false);
        // We no longer expand automatically on track change to avoid blocking the UI.
        setIsMobileExpanded(false);
    }
    if (user && currentTrack) {
        const historyTrack = {
            videoId: String(currentTrack.videoId || '').slice(0, 100),
            title: String(currentTrack.title || '').slice(0, 200),
            channelTitle: String(currentTrack.channelTitle || '').slice(0, 200),
            thumbnailUrl: String(currentTrack.thumbnailUrl || '').slice(0, 1000),
        };
        if (!historyTrack.videoId) return;
        setDoc(doc(db, 'users', user.uid, 'history', historyTrack.videoId), {
            track: historyTrack,
            playedAt: serverTimestamp()
        }, { merge: true }).catch(e => console.error("Error saving history:", e));
    }
  }, [currentTrack, user]);

  useEffect(() => {
    if (!currentView) return;

    const changedView = lastViewRef.current !== currentView;
    lastViewRef.current = currentView;

    if (changedView && window.innerWidth < 768) {
      setIsMobileExpanded(false);
    }
  }, [currentView]);

  // Fetch audio stream URL when track changes
  useEffect(() => {
    const audio = audioRef.current;

    if (!currentTrack?.videoId) {
      desiredPlayingRef.current = false;
      setStreamVideoId('');
      setIsStreamReady(false);
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      return;
    }

    const videoId = currentTrack.videoId;
    const requestId = streamRequestRef.current + 1;
    streamRequestRef.current = requestId;

    setCurrentTime(0);
    setDuration(0);
    setIsStreamReady(false);
    setStreamVideoId('');

    if (audio) {
      audio.pause();
      audio.src = '';
    }

    const controller = new AbortController();

    fetch(`/api/youtube/stream?v=${videoId}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (streamRequestRef.current !== requestId) return;

        if (data.url) {
          if (audioRef.current) {
            audioRef.current.src = data.url;
            audioRef.current.load();
          }
          setStreamVideoId(videoId);
          setIsStreamReady(true);
        } else {
          setStreamVideoId('');
          setIsStreamReady(false);
        }
      })
      .catch(() => {
        if (streamRequestRef.current !== requestId) return;
        setStreamVideoId('');
        setIsStreamReady(false);
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.videoId]);

  // Handle play/pause sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying && isStreamReady) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          setIsPlaying(false);
        });
      }
    } else {
      audio.pause();
    }
  }, [isPlaying, isStreamReady]);

  // Sync YouTube player with audio element
  const syncVideoToAudio = useCallback(async (isUserAction = false) => {
    const audio = audioRef.current;
    const player = playerRef.current?.getInternalPlayer();
    
    if (!audio || !player) return;

    try {
      const audioTime = audio.currentTime;
      const playerTime = await player.getCurrentTime();
      
      // Keep video slightly ahead to buffer correctly, or sync if drift is > 0.5s
      if (Math.abs(audioTime - playerTime) > 0.5) {
        player.seekTo(audioTime, true);
      }

      if (isPlaying) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch (e) {
      // Player might not be ready yet
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!currentTrack) return;
    const interval = window.setInterval(() => {
      void syncVideoToAudio(false);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [currentTrack, syncVideoToAudio]);

  const handlePlayerReady = (event: any) => {
    const player = event.target;
    player.mute();
    if (isPlaying) {
      player.playVideo();
    }
  };

  const handlePlayerStateChange = (event: any) => {
    // Sync is handled by interval, but we can capture major state changes
    if (event.data === 0) { // Ended
      playNext();
    }
  };

  const handlePlayerError = (event: any) => {
    console.error('YouTube Player Error:', event.data);
    // Silent error, audio is the source of truth
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    syncVideoToAudio(true);
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const safePlayerCall = (method: string, args: any[] = []) => {
    try {
      const player = playerRef.current?.getInternalPlayer();
      if (player && typeof player[method] === 'function') {
        player[method](...args);
      }
    } catch (e) {}
  };

  const handleSeekForward = () => {
       const newTime = Math.min(duration, currentTime + 10);
       safePlayerCall('seekTo', [newTime]);
       setCurrentTime(newTime);
       triggerSeekAnimation('forward');
  };

  const handleSeekBackward = () => {
       const newTime = Math.max(0, currentTime - 10);
       safePlayerCall('seekTo', [newTime]);
       setCurrentTime(newTime);
       triggerSeekAnimation('backward');
  };

  const handleDragEnd = (event: any, info: any) => {
      if (info.offset.y > 100) {
          setIsMobileExpanded(false);
      }
  };

  if (!currentTrack) return null;

  return (
    <>
      <audio 
        ref={audioRef} 
        preload="auto"
        playsInline 
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        onTimeUpdate={() => {
          if (!isSeeking && audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onDurationChange={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
           playNext();
        }}
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }} 
      />
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
                key={currentTrack.videoId}
                videoId={currentTrack?.videoId || ''}
                opts={{ width: '100%', height: '100%', playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, showinfo: 0, disablekb: 1, playsinline: 1 } }}
                onReady={handlePlayerReady}
                onStateChange={handlePlayerStateChange}
                onError={handlePlayerError}
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
                       onDoubleClick={handleSeekBackward} 
                  >
                      <AnimatePresence>
                          {seekAnimation === 'backward' && (
                              <motion.div 
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.8 }}
                                  className="flex flex-col items-center justify-center p-4 bg-black/50 rounded-2xl backdrop-blur-md"
                              >
                                  <Rewind className="w-8 h-8 text-white fill-current" />
                                  <span className="text-white font-bold mt-1 text-xs">-10s</span>
                              </motion.div>
                          )}
                      </AnimatePresence>
                  </div>
                  <div className="flex-1 flex items-center justify-center transition-opacity" 
                       onDoubleClick={handleSeekForward} 
                  >
                      <AnimatePresence>
                          {seekAnimation === 'forward' && (
                              <motion.div 
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.8 }}
                                  className="flex flex-col items-center justify-center p-4 bg-black/50 rounded-2xl backdrop-blur-md"
                              >
                                  <FastForward className="w-8 h-8 text-white fill-current" />
                                  <span className="text-white font-bold mt-1 text-xs">+10s</span>
                              </motion.div>
                          )}
                      </AnimatePresence>
                  </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center space-y-8 z-[102] relative">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-full aspect-square max-w-[300px] relative rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10"
                  >
                      <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  </motion.div>

                  <div className="w-full text-center space-y-2 px-6">
                      <motion.h2 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="text-2xl font-bold text-white line-clamp-1 drop-shadow-md"
                      >
                        {currentTrack.title}
                      </motion.h2>
                      <motion.p 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.1 }}
                        className="text-blue-200/60 font-medium text-lg drop-shadow-md"
                      >
                        {currentTrack.channelTitle}
                      </motion.p>
                  </div>
              </div>

              <div className="w-full space-y-8 pb-10 px-6 z-[102] relative">
                  <div className="space-y-3">
                      <div className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <motion.div 
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-sky-400"
                            style={{ width: `${(currentTime / duration) * 100}%` }}
                          />
                          <input 
                            type="range"
                            min="0"
                            max={duration || 0}
                            value={currentTime}
                            onChange={handleSeek}
                            onMouseDown={() => setIsSeeking(true)}
                            onMouseUp={() => setIsSeeking(false)}
                            onTouchStart={() => setIsSeeking(true)}
                            onTouchEnd={() => setIsSeeking(false)}
                            className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
                          />
                      </div>
                      <div className="flex justify-between text-[11px] font-bold text-blue-200/40 uppercase tracking-widest">
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                      </div>
                  </div>

                  <div className="flex items-center justify-between">
                      <button 
                        onClick={() => setShuffleMode(!shuffleMode)}
                        className={`p-3 rounded-full transition-all ${shuffleMode ? 'text-sky-400 bg-sky-400/10' : 'text-white/40'}`}
                      >
                          <Shuffle className="w-5 h-5" />
                      </button>
                      <div className="flex items-center space-x-6">
                          <button onClick={() => safePlayerCall('seekTo', [currentTime - 10])} className="text-white/80 hover:text-white p-2">
                              <SkipBack className="w-8 h-8 fill-current" />
                          </button>
                          <button 
                            onClick={togglePlay}
                            className="w-20 h-20 bg-white text-black rounded-full flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all"
                          >
                              {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                          </button>
                          <button onClick={playNext} className="text-white/80 hover:text-white p-2">
                              <SkipForward className="w-8 h-8 fill-current" />
                          </button>
                      </div>
                      <button 
                        onClick={() => setLoopMode(loopMode === 'none' ? 'all' : loopMode === 'all' ? 'one' : 'none')}
                        className={`p-3 rounded-full transition-all ${loopMode !== 'none' ? 'text-sky-400 bg-sky-400/10' : 'text-white/40'}`}
                      >
                          {loopMode === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
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
         style={{ 
            pointerEvents: isMobileExpanded ? 'none' : 'auto',
            touchAction: 'none'
         }}
         drag={isMobile ? "y" : false}
         dragConstraints={{ top: 0, bottom: 0 }}
         dragElastic={0.2}
         onDragEnd={handleDragEnd}
         className={`fixed z-50 left-3 right-3 bottom-[96px] md:bottom-6 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[760px] bg-black/60 backdrop-blur-3xl border border-white/20 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.6)] flex flex-col transition-opacity duration-300 ${isMobileExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}
      >
          {/* Mini Player with Swipe feedback */}
          <div className="relative overflow-hidden rounded-[28px]">
              <AnimatePresence>
                  {miniSwipeFeedback === 'next' && (
                      <motion.div 
                          initial={{ x: '100%' }}
                          animate={{ x: 0 }}
                          exit={{ x: '-100%' }}
                          className="absolute inset-0 bg-blue-500/20 backdrop-blur-md z-10 flex items-center justify-end pr-8"
                      >
                          <SkipForward className="w-6 h-6 text-white" />
                      </motion.div>
                  )}
                  {miniSwipeFeedback === 'rewind' && (
                      <motion.div 
                          initial={{ x: '-100%' }}
                          animate={{ x: 0 }}
                          exit={{ x: '100%' }}
                          className="absolute inset-0 bg-white/10 backdrop-blur-md z-10 flex items-center justify-start pl-8"
                      >
                          <Rewind className="w-6 h-6 text-white" />
                      </motion.div>
                  )}
              </AnimatePresence>

              <div 
                className="flex items-center h-[72px] px-2 md:px-4 cursor-pointer md:cursor-default relative z-0"
                onClick={() => isMobile && setIsMobileExpanded(true)}
              >
                  {/* Progress Bar (at the very bottom of the mini player) */}
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/5">
                      <motion.div 
                        className="h-full bg-gradient-to-r from-blue-500 to-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      />
                  </div>

                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl overflow-hidden shadow-lg border border-white/10 flex-shrink-0 group relative">
                      <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Maximize2 className="w-5 h-5 text-white" onClick={(e) => { e.stopPropagation(); setIsMobileExpanded(true); }} />
                      </div>
                  </div>

                  <div className="ml-3 md:ml-4 flex-1 min-w-0 pr-2">
                      <h4 className="text-[13px] md:text-[15px] font-bold text-white truncate drop-shadow-sm">{currentTrack.title}</h4>
                      <p className="text-[11px] md:text-[13px] text-blue-200/60 font-medium truncate">{currentTrack.channelTitle}</p>
                  </div>

                  <div className="flex items-center space-x-1 md:space-x-2">
                      <button onClick={(e) => { e.stopPropagation(); safePlayerCall('seekTo', [currentTime - 10]); triggerMiniSwipeFeedback('rewind'); }} className="hidden md:flex p-2 text-white/60 hover:text-white transition-colors">
                          <Rewind className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                        className="w-10 h-10 md:w-12 md:h-12 bg-white text-black rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
                      >
                          {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6 fill-current" /> : <Play className="w-5 h-5 md:w-6 md:h-6 fill-current ml-0.5" />}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); playNext(); triggerMiniSwipeFeedback('next'); }} className="p-2 text-white/60 hover:text-white transition-colors">
                          <SkipForward className="w-5 h-5 md:w-6 md:h-6" />
                      </button>
                  </div>

                  <div className="hidden md:flex items-center space-x-2 ml-4 pl-4 border-l border-white/10">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setVideoExpanded(!videoExpanded); }}
                        className={`p-2 transition-colors ${videoExpanded ? 'text-sky-400 bg-sky-400/10' : 'text-white/40 hover:text-white'} rounded-full`}
                        title="Espandi Video"
                      >
                          <Maximize2 className="w-4 h-4" />
                      </button>
                  </div>
              </div>
          </div>
        </motion.div>
        </>
      )}
    </>
  );
}
