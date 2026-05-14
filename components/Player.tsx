'use client';

import { usePlayerStore } from '@/lib/store';
import { Pause, Play, SkipForward, SkipBack, Rewind, FastForward, Heart, ListPlus, Repeat, Repeat1, Shuffle, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import ReactPlayer from 'react-youtube';
import { useRef, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

export function Player() {
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
        if (window.innerWidth < 768) {
           setIsMobileExpanded(true);
        }
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

  const callVideo = useCallback(async <T = any,>(method: string, args: any[] = []): Promise<T | undefined> => {
    const player = playerRef.current;
    const internalPlayer = player?.internalPlayer || player?.getInternalPlayer?.() || player;

    if (!internalPlayer || typeof internalPlayer[method] !== 'function') {
      return undefined;
    }

    try {
      return await internalPlayer[method](...args);
    } catch (error) {
      console.warn(`YouTube visual ${method} error:`, error);
      return undefined;
    }
  }, []);

  const syncVideoToAudio = useCallback(async (forceSeek = false) => {
    const audio = audioRef.current;

    if (!audio || !currentTrack || document.visibilityState === 'hidden') {
      return;
    }

    await callVideo('mute');
    await callVideo('setVolume', [0]);

    const audioTime = audio.currentTime || 0;
    const videoTime = await callVideo<number>('getCurrentTime');
    const drift =
      typeof videoTime === 'number' && Number.isFinite(videoTime)
        ? Math.abs(videoTime - audioTime)
        : Number.POSITIVE_INFINITY;

    if (forceSeek || drift > 1.25) {
      await callVideo('seekTo', [audioTime, true]);
    }

    if (audio.paused || audio.ended || audio.readyState < 3) {
      await callVideo('pauseVideo');
      return;
    }

    await callVideo('playVideo');
  }, [callVideo, currentTrack]);

  const safePlayerCall = useCallback(async (method: string, args: any[] = []) => {
    try {
      const audio = audioRef.current;

      switch (method) {
        case 'playVideo':
          desiredPlayingRef.current = true;
          if (!audio || !audio.src) return false;
          if (audioCtxRef.current?.state === 'suspended') {
            await audioCtxRef.current.resume().catch(() => {});
          }
          await audio.play();
          setIsPlaying(true);
          void syncVideoToAudio(true);
          return true;
        case 'pauseVideo':
          desiredPlayingRef.current = false;
          audio?.pause();
          setIsPlaying(false);
          await callVideo('pauseVideo');
          return true;
        case 'seekTo': 
          if (audio && args[0] !== undefined) {
            audio.currentTime = Number(args[0]) || 0;
            setCurrentTime(audio.currentTime);
            await syncVideoToAudio(true);
          }
          return true;
        case 'getCurrentTime':
          return audio?.currentTime || 0;
        case 'getDuration':
          return audio?.duration || 0;
        default:
          return callVideo(method, args);
      }
    } catch (e) {
      console.warn(`SafePlayerCall ${method} error:`, e);
      return false;
    }
  }, [callVideo, setIsPlaying, syncVideoToAudio]);

  const handleNext = useCallback(async () => {
    desiredPlayingRef.current = true;

    if (loopMode === 'one' && currentTrack) {
        await safePlayerCall('seekTo', [0]);
        await safePlayerCall('playVideo');
        return;
    }
    
    playNext();
  }, [currentTrack, loopMode, playNext, safePlayerCall]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (!isSeeking) setCurrentTime(audio.currentTime);
    };
    const onLoadedMeta = () => {
      setDuration(audio.duration || 0);
    };
    const onEnded = () => {
      void handleNext();
    };
    const onPlay = () => {
      desiredPlayingRef.current = true;
      setIsPlaying(true);
      void syncVideoToAudio(true);
    };
    const onPause = () => {
      setIsPlaying(false);
      void callVideo('pauseVideo');
    };
    const onPlaying = () => {
      void syncVideoToAudio(true);
    };
    const onWaiting = () => {
      void callVideo('pauseVideo');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
    };
  }, [callVideo, isSeeking, handleNext, setIsPlaying, syncVideoToAudio]);

  useEffect(() => {
    if (!currentTrack || !isStreamReady || streamVideoId !== currentTrack.videoId) {
      return;
    }

    const hasNewPlayRequest = playRequestId > lastPlayRequestRef.current;
    if (!desiredPlayingRef.current && !hasNewPlayRequest) {
      void syncVideoToAudio(true);
      return;
    }

    lastPlayRequestRef.current = Math.max(lastPlayRequestRef.current, playRequestId);
    desiredPlayingRef.current = true;
    void safePlayerCall('playVideo');
  }, [
    currentTrack,
    isStreamReady,
    playRequestId,
    safePlayerCall,
    streamVideoId,
    syncVideoToAudio,
  ]);

  useEffect(() => {
    if (currentTrack && 'mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: currentTrack.title,
            artist: currentTrack.channelTitle,
            artwork: [{ src: currentTrack.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }]
        });
        navigator.mediaSession.setActionHandler('play', async () => {
            await safePlayerCall('playVideo');
            setIsPlaying(true);
        });
        navigator.mediaSession.setActionHandler('pause', async () => {
            await safePlayerCall('pauseVideo');
            setIsPlaying(false);
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
        navigator.mediaSession.setActionHandler('previoustrack', async () => {
            await safePlayerCall('seekTo', [0]);
            setIsPlaying(true);
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                safePlayerCall('seekTo', [details.seekTime]);
                setCurrentTime(details.seekTime);
            }
        });
    }
    return () => {
      if (!('mediaSession' in navigator)) return;
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('seekto', null);
      } catch {}
    };
  }, [currentTrack, setIsPlaying, handleNext, safePlayerCall]);

  useEffect(() => {
    if ('audioSession' in navigator) {
      try { (navigator as any).audioSession.type = 'playback'; } catch(e) {}
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const unlock = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        try {
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const gain = ctx.createGain();
          gain.gain.value = 0;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.start(0);
        } catch(e) {}
      };
      document.addEventListener('touchstart', unlock, { once: true, passive: true });
      document.addEventListener('click', unlock, { once: true, passive: true });
      return () => {
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
        ctx.close().catch(() => {});
      };
    } catch(e) {}
  }, []);

  const togglePlayPause = () => {
    if (isPlaying) {
      void safePlayerCall('pauseVideo');
      return;
    }

    void safePlayerCall('playVideo');
  };

  useEffect(() => {
     if ('mediaSession' in navigator) {
         try {
             navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
         } catch (e) {}
     }
  }, [isPlaying]);

  useEffect(() => {
    const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
            if (audioCtxRef.current?.state === 'suspended') {
                audioCtxRef.current.resume().catch(() => {});
            }
            if (desiredPlayingRef.current && audioRef.current?.paused) {
                void safePlayerCall('playVideo');
                return;
            }
            void syncVideoToAudio(true);
        }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [safePlayerCall, syncVideoToAudio]);

  useEffect(() => {
    if (!currentTrack) return;

    const interval = window.setInterval(() => {
      void syncVideoToAudio(false);
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentTrack, syncVideoToAudio]);

  const handlePrev = async () => {
    if (currentTime > 3) {
      await safePlayerCall('seekTo', [0]);
      setCurrentTime(0);
    } else {
      await safePlayerCall('seekTo', [0]);
      setCurrentTime(0);
    }
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
      playerRef.current = e.target;
      // Mute iframe — audio comes from native audio element
      try { e.target?.mute?.(); e.target?.setVolume?.(0); } catch(_) {}
      if ((audioRef.current?.currentTime || currentTime) > 0) {
          e.target?.seekTo?.(audioRef.current?.currentTime || currentTime, true);
      }
      if (desiredPlayingRef.current && !audioRef.current?.paused) {
          e.target?.playVideo?.();
      } else {
          e.target?.pauseVideo?.();
      }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSeeking(true);
    setCurrentTime(parseFloat(e.target.value));
  };

  const handleSeekCommit = () => {
    void safePlayerCall('seekTo', [currentTime]);
    setIsSeeking(false);
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

  return (
    <>
      <audio 
        ref={audioRef} 
        preload="auto"
        playsInline 
        webkit-playsinline="true"
        x-webkit-airplay="allow"
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
                onError={() => { 
                   console.warn("YouTube visual player error.");
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

              <div className="flex flex-col justify-end w-full mt-auto mb-0 z-[102] pt-6 pb-2">
                  <div className="flex items-center justify-between mb-4">
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.div 
                          key={currentTrack.videoId}
                          initial={{ opacity: 0, y: 15, filter: "blur(8px)" }}
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, y: -15, filter: "blur(8px)" }}
                          transition={{ duration: 0.6, type: "spring", stiffness: 80, damping: 20 }}
                          className="flex flex-col flex-1 overflow-hidden pr-4"
                        >
                          <h2 className="text-xl font-bold text-white truncate drop-shadow-lg">{currentTrack.title}</h2>
                          <p className="text-sm text-blue-300/80 truncate font-medium drop-shadow-md">{currentTrack.channelTitle}</p>
                        </motion.div>
                      </AnimatePresence>
                      <div className="flex items-center gap-3">
                          <button className="text-white/70 hover:text-white transition-colors active:scale-90">
                               <Heart className="w-5 h-5" />
                          </button>
                          <button className="text-white/70 hover:text-white transition-colors active:scale-90">
                               <ListPlus className="w-5 h-5" />
                          </button>
                      </div>
                  </div>

                  <div className="flex flex-col gap-1.5 mb-6 w-full group/slider relative">
                      <div className="relative flex items-center justify-center h-6 w-full">
                          <input 
                              type="range"
                              min={0}
                              max={duration || 100}
                              step={0.1}
                              value={currentTime}
                              onChange={handleSeekChange}
                              onMouseUp={handleSeekCommit}
                              onTouchEnd={handleSeekCommit}
                              className="absolute z-20 w-full h-full opacity-0 cursor-pointer touch-pan-x"
                          />
                          <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden shadow-inner flex items-center relative z-10">
                              <div className="h-full bg-blue-500 rounded-full transition-all duration-150 ease-out shadow-[0_0_10px_rgba(59,130,246,0.8)]" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
                          </div>
                      </div>
                      <div className="flex justify-between text-xs font-medium text-white/50 tracking-wide mt-1">
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                      </div>
                  </div>

                  <div className="flex items-center justify-between mb-4 px-1">
                      <button className={`p-2 transition-all ${shuffleMode ? 'text-sky-400' : 'text-white/60 hover:text-white'}`} onClick={() => setShuffleMode(!shuffleMode)}>
                          <Shuffle className="w-5 h-5" />
                      </button>
                      
                      <div className="flex items-center gap-2">
                          <button className="text-white/90 hover:text-sky-400 p-2 transition-all active:scale-90" onClick={handlePrev}>
                              <SkipBack className="w-7 h-7 fill-currentColor drop-shadow-md" />
                          </button>
                          <button className="text-white/80 hover:text-white p-2 transition-transform active:scale-90" onClick={handleSeekBackward}>
                              <Rewind className="w-6 h-6 fill-currentColor drop-shadow-md" />
                          </button>
                          
                          <div className="relative mx-1">
                               <button 
                                  className="w-16 h-16 flex items-center justify-center bg-blue-500 hover:bg-blue-400 text-white shadow-[0_8px_32px_rgba(59,130,246,0.5)] rounded-full hover:scale-105 active:scale-95 transition-all" 
                                  onClick={togglePlayPause}
                               >
                                   {isPlaying ? <Pause className="w-7 h-7 fill-currentColor" /> : <Play className="w-7 h-7 fill-currentColor ml-1" />}
                               </button>
                          </div>
                          
                          <button className="text-white/80 hover:text-white p-2 transition-transform active:scale-90" onClick={handleSeekForward}>
                              <FastForward className="w-6 h-6 fill-currentColor drop-shadow-md" />
                          </button>
                          <button className="text-white/90 hover:text-sky-400 p-2 transition-all active:scale-90" onClick={handleNext}>
                              <SkipForward className="w-7 h-7 fill-currentColor drop-shadow-md" />
                          </button>
                      </div>

                      <button className={`p-2 transition-all ${loopMode !== 'off' ? 'text-sky-400' : 'text-white/60 hover:text-white'}`} onClick={toggleLoop}>
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
         drag={isMobile && !isMobileExpanded ? "x" : false}
         dragConstraints={{ left: 0, right: 0 }}
         dragElastic={0.7}
         onDragEnd={(e, { offset, velocity }) => {
            if (isMobile && !isMobileExpanded) {
               if (offset.x < -80 || velocity.x < -500) {
                   triggerMiniSwipeFeedback('next');
                   handleNext();
                   return;
               }
               if (offset.x > 80 || velocity.x > 500) {
                   triggerMiniSwipeFeedback('rewind');
                   handleSeekBackward();
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
        <AnimatePresence>
          {miniSwipeFeedback && (
            <motion.div
              key={miniSwipeFeedback}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -8 }}
              className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
            >
              <div className="px-4 py-3 rounded-2xl bg-black/65 border border-white/15 backdrop-blur-lg text-white text-sm font-semibold shadow-xl flex items-center gap-2">
                {miniSwipeFeedback === 'next' ? (
                  <>
                    <SkipForward className="w-4 h-4 fill-current" />
                    Prossimo brano
                  </>
                ) : (
                  <>
                    <Rewind className="w-4 h-4 fill-current" />
                    Indietro 10s
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="player-footer-clickable h-[64px] md:h-[72px] px-2 flex py-1 flex-shrink-0 items-center justify-between w-full cursor-pointer md:cursor-default overflow-hidden hover:bg-white/5 transition-colors rounded-[24px]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div 
              key={currentTrack.videoId}
              initial={{ opacity: 0, x: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -20, filter: "blur(8px)" }}
              transition={{ duration: 0.6, type: "spring", stiffness: 80, damping: 20 }}
              className="flex items-center flex-1 md:w-[30%] md:flex-none md:min-w-[180px] overflow-hidden drop-shadow-md"
            >
              <div className="w-11 h-11 md:w-14 md:h-14 bg-black/40 rounded-[12px] md:rounded-[16px] overflow-hidden flex-shrink-0 mr-3 border border-white/10 shadow-lg relative ml-1">
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
                <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover relative z-0" />
              </div>
              <div className="overflow-hidden flex flex-col justify-center">
                <h4 className="text-[13px] md:text-[14px] font-bold truncate text-white leading-tight mb-1">{currentTrack.title}</h4>
                <p className="text-[11px] md:text-[12px] font-medium text-blue-300/70 truncate leading-tight">{currentTrack.channelTitle}</p>
              </div>
            </motion.div>
          </AnimatePresence>

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
        <div className="md:hidden text-[10px] text-blue-200/40 px-4 pb-2 -mt-1 tracking-wide">
          Swipe: sinistra = prossimo, destra = -10s
        </div>
      </motion.div>
      </>
      )}
    </>
  );
}
