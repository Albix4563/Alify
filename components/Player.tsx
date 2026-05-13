'use client';

import { usePlayerStore } from '@/lib/store';
import {
  ChevronDown,
  FastForward,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import YouTube from 'react-youtube';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const SILENT_AUDIO_SRC =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

export function Player() {
  const { user } = useAuth();

  const {
    currentTrack,
    isPlaying,
    setIsPlaying,
    playNext,
    playRequestId,
    loopMode,
    setLoopMode,
    shuffleMode,
    setShuffleMode,
    videoExpanded,
    setVideoExpanded,
    audioQuality,
  } = usePlayerStore();

  const youtubePlayerRef = useRef<any | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const desiredPlayingRef = useRef(false);
  const trackChangingRef = useRef(false);
  const visibilityGuardRef = useRef(false);
  const playAttemptRef = useRef(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
  const [lastY, setLastY] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekAnimation, setSeekAnimation] = useState<
    'forward' | 'backward' | null
  >(null);
  const [miniSwipeFeedback, setMiniSwipeFeedback] = useState<
    'next' | 'rewind' | null
  >(null);

  const formatTime = (seconds: number) => {
    if (!seconds || Number.isNaN(seconds)) return '0:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  const setMediaState = useCallback((state: MediaSessionPlaybackState) => {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.playbackState = state;
    } catch {
      // MediaSession non pienamente supportata.
    }
  }, []);

  const setMediaPosition = useCallback((position: number, total: number) => {
    if (!('mediaSession' in navigator)) return;
    if (!Number.isFinite(position) || !Number.isFinite(total) || total <= 0) {
      return;
    }

    try {
      navigator.mediaSession.setPositionState({
        duration: total,
        playbackRate: 1,
        position: Math.min(position, total),
      });
    } catch {
      // Alcuni browser non supportano setPositionState.
    }
  }, []);

  const ensureKeepAliveAudio = useCallback(async () => {
    const audio = audioRef.current;

    if (audio) {
      try {
        audio.loop = true;
        audio.muted = false;
        audio.volume = 0.001;

        if (audio.readyState === 0) {
          audio.load();
        }

        await audio.play();
      } catch {
        // Può essere bloccato se non deriva da interazione utente.
      }
    }

    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;

      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }

      const context = audioContextRef.current;

      if (context.state === 'suspended') {
        await context.resume();
      }

      if (!oscillatorRef.current) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.frequency.value = 40;
        gain.gain.value = 0.00001;

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();

        oscillatorRef.current = oscillator;
      }
    } catch {
      // WebAudio non disponibile o sospeso.
    }
  }, []);

  const stopKeepAliveAudio = useCallback(() => {
    audioRef.current?.pause();

    try {
      oscillatorRef.current?.stop();
    } catch {
      // Già fermo.
    }

    oscillatorRef.current = null;
  }, []);

  const callYoutube = useCallback(async <T = any,>(
    method: string,
    args: any[] = [],
  ): Promise<T | undefined> => {
    const player = youtubePlayerRef.current;

    if (!player || typeof player[method] !== 'function') {
      return undefined;
    }

    try {
      return await player[method](...args);
    } catch (error) {
      console.warn(`YouTube ${method} error:`, error);
      return undefined;
    }
  }, []);

  const startYoutubePlayback = useCallback(
    async (reason = 'manual') => {
      if (!currentTrack) return false;

      desiredPlayingRef.current = true;
      const attemptId = ++playAttemptRef.current;

      await ensureKeepAliveAudio();

      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (attemptId !== playAttemptRef.current) return false;

        const player = youtubePlayerRef.current;

        if (!player || typeof player.playVideo !== 'function') {
          await wait(150);
          continue;
        }

        try {
          player.playVideo();

          await wait(attempt < 3 ? 180 : 300);

          const state =
            typeof player.getPlayerState === 'function'
              ? player.getPlayerState()
              : undefined;

          if (state === YT_STATE.PLAYING) {
            setIsPlaying(true);
            setMediaState('playing');
            return true;
          }

          if (state === YT_STATE.BUFFERING || state === YT_STATE.UNSTARTED) {
            setMediaState('playing');
          }
        } catch (error) {
          console.warn(`Playback failed (${reason}):`, error);
        }

        await wait(250 + attempt * 100);
      }

      setIsPlaying(false);
      setMediaState('paused');

      return false;
    },
    [currentTrack, ensureKeepAliveAudio, setIsPlaying, setMediaState],
  );

  const pauseYoutubePlayback = useCallback(async () => {
    desiredPlayingRef.current = false;
    playAttemptRef.current += 1;

    await callYoutube('pauseVideo');

    stopKeepAliveAudio();
    setIsPlaying(false);
    setMediaState('paused');
  }, [callYoutube, setIsPlaying, setMediaState, stopKeepAliveAudio]);

  const handleNext = useCallback(async () => {
    desiredPlayingRef.current = true;

    if (loopMode === 'one' && currentTrack) {
      await callYoutube('seekTo', [0, true]);
      setCurrentTime(0);
      await startYoutubePlayback('loop-one');
      return;
    }

    await ensureKeepAliveAudio();
    playNext();
  }, [
    callYoutube,
    currentTrack,
    ensureKeepAliveAudio,
    loopMode,
    playNext,
    startYoutubePlayback,
  ]);

  const handlePrev = useCallback(async () => {
    await callYoutube('seekTo', [0, true]);
    setCurrentTime(0);

    if (currentTrack) {
      await startYoutubePlayback('previous');
    }
  }, [callYoutube, currentTrack, startYoutubePlayback]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      void pauseYoutubePlayback();
      return;
    }

    void startYoutubePlayback('play-button');
  }, [isPlaying, pauseYoutubePlayback, startYoutubePlayback]);

  const triggerSeekAnimation = useCallback((type: 'forward' | 'backward') => {
    setSeekAnimation(type);
    window.setTimeout(() => setSeekAnimation(null), 500);
  }, []);

  const triggerMiniSwipeFeedback = useCallback((type: 'next' | 'rewind') => {
    setMiniSwipeFeedback(type);

    if ('vibrate' in navigator) {
      navigator.vibrate(15);
    }

    window.setTimeout(() => setMiniSwipeFeedback(null), 450);
  }, []);

  const handleSeekBackward = useCallback(async () => {
    const nextTime = Math.max(0, currentTime - 10);

    await callYoutube('seekTo', [nextTime, true]);
    setCurrentTime(nextTime);
    triggerSeekAnimation('backward');

    if (desiredPlayingRef.current) {
      await startYoutubePlayback('seek-backward');
    }
  }, [callYoutube, currentTime, startYoutubePlayback, triggerSeekAnimation]);

  const handleSeekForward = useCallback(async () => {
    const nextTime = Math.min(duration || currentTime + 10, currentTime + 10);

    await callYoutube('seekTo', [nextTime, true]);
    setCurrentTime(nextTime);
    triggerSeekAnimation('forward');

    if (desiredPlayingRef.current) {
      await startYoutubePlayback('seek-forward');
    }
  }, [
    callYoutube,
    currentTime,
    duration,
    startYoutubePlayback,
    triggerSeekAnimation,
  ]);

  const handleSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsSeeking(true);
    setCurrentTime(Number(event.target.value));
  };

  const handleSeekCommit = async () => {
    await callYoutube('seekTo', [currentTime, true]);
    setIsSeeking(false);

    if (desiredPlayingRef.current) {
      await startYoutubePlayback('seek-commit');
    }
  };

  const toggleLoop = () => {
    if (loopMode === 'off') {
      setLoopMode('all');
      return;
    }

    if (loopMode === 'all') {
      setLoopMode('one');
      return;
    }

    setLoopMode('off');
  };

  const handleYoutubeReady = useCallback(
    (event: any) => {
      youtubePlayerRef.current = event.target;
      setIsReady(true);
      trackChangingRef.current = false;

      if (currentTime > 0) {
        event.target.seekTo(currentTime, true);
      }

      if (desiredPlayingRef.current) {
        void startYoutubePlayback('youtube-ready');
      }
    },
    [currentTime, startYoutubePlayback],
  );

  const handleYoutubeStateChange = useCallback(
    (event: any) => {
      const state = event.data;

      if (state === YT_STATE.PLAYING) {
        trackChangingRef.current = false;
        desiredPlayingRef.current = true;

        setIsPlaying(true);
        setMediaState('playing');
        return;
      }

      if (state === YT_STATE.BUFFERING) {
        if (desiredPlayingRef.current) {
          setMediaState('playing');
        }

        return;
      }

      if (state === YT_STATE.PAUSED) {
        if (trackChangingRef.current) return;
        if (visibilityGuardRef.current) return;
        if (document.visibilityState === 'hidden') return;

        if (desiredPlayingRef.current) {
          window.setTimeout(() => {
            if (desiredPlayingRef.current && youtubePlayerRef.current) {
              void startYoutubePlayback('unexpected-pause-resume');
            }
          }, 250);

          return;
        }

        setIsPlaying(false);
        setMediaState('paused');
        return;
      }

      if (state === YT_STATE.ENDED) {
        desiredPlayingRef.current = false;
        setIsPlaying(false);
        setMediaState('paused');
        void handleNext();
      }
    },
    [handleNext, setIsPlaying, setMediaState, startYoutubePlayback],
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const mainArea = document.getElementById('main-scroll-area');
    if (!mainArea) return;

    const handleScroll = () => {
      const latestY = mainArea.scrollTop;

      if (latestY - lastY > 20 && latestY > 50) {
        setScrollingDown(true);
      } else if (lastY - latestY > 20) {
        setScrollingDown(false);
      }

      setLastY(latestY);
    };

    mainArea.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      mainArea.removeEventListener('scroll', handleScroll);
    };
  }, [lastY]);

  useEffect(() => {
    if (!currentTrack) {
      youtubePlayerRef.current = null;
      desiredPlayingRef.current = false;
      trackChangingRef.current = false;

      setCurrentTime(0);
      setDuration(0);
      setIsReady(false);
      setIsPlaying(false);
      setMediaState('paused');

      stopKeepAliveAudio();
      return;
    }

    youtubePlayerRef.current = null;
    desiredPlayingRef.current = true;
    trackChangingRef.current = true;

    setCurrentTime(0);
    setDuration(0);
    setIsReady(false);
    setIsPlaying(false);

    if (window.innerWidth < 768) {
      setIsMobileExpanded(true);
    }

    void ensureKeepAliveAudio();

    const fallbackTimer = window.setTimeout(() => {
      if (desiredPlayingRef.current) {
        void startYoutubePlayback('track-change-fallback');
      }
    }, 1200);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [
    currentTrack?.videoId,
    playRequestId,
    ensureKeepAliveAudio,
    setIsPlaying,
    setMediaState,
    startYoutubePlayback,
    stopKeepAliveAudio,
  ]);

  useEffect(() => {
    if (!user || !currentTrack) return;

    const historyTrack = {
      videoId: String(currentTrack.videoId || '').slice(0, 100),
      title: String(currentTrack.title || '').slice(0, 200),
      channelTitle: String(currentTrack.channelTitle || '').slice(0, 200),
      thumbnailUrl: String(currentTrack.thumbnailUrl || '').slice(0, 1000),
    };

    if (!historyTrack.videoId) return;

    setDoc(
      doc(db, 'users', user.uid, 'history', historyTrack.videoId),
      {
        track: historyTrack,
        playedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch((error) => {
      console.error('Error saving history:', error);
    });
  }, [currentTrack, user]);

  useEffect(() => {
    const applyQuality = async () => {
      if (!isReady) return;

      let target = 'default';
      const connection = (navigator as any).connection;

      if (audioQuality === 'basso') {
        target = 'medium';
      } else if (audioQuality === 'medio') {
        target = 'hd720';
      } else if (audioQuality === 'alto') {
        target = 'hd1080';
      } else if (audioQuality === 'auto') {
        target = connection?.effectiveType === '4g' ? 'hd720' : 'medium';
      }

      await callYoutube('setPlaybackQuality', [target]);
    };

    void applyQuality();

    const connection = (navigator as any).connection;

    if (audioQuality === 'auto' && connection) {
      connection.addEventListener('change', applyQuality);
      return () => connection.removeEventListener('change', applyQuality);
    }

    return undefined;
  }, [audioQuality, callYoutube, currentTrack?.videoId, isReady]);

  useEffect(() => {
    if (!currentTrack || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.channelTitle,
      artwork: [
        {
          src: currentTrack.thumbnailUrl,
          sizes: '512x512',
          type: 'image/jpeg',
        },
      ],
    });

    navigator.mediaSession.setActionHandler('play', () => {
      void startYoutubePlayback('media-session-play');
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      void pauseYoutubePlayback();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      void handleNext();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      void handlePrev();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime === undefined) return;

      void (async () => {
        await callYoutube('seekTo', [details.seekTime, true]);
        setCurrentTime(details.seekTime!);

        if (desiredPlayingRef.current) {
          await startYoutubePlayback('media-session-seek');
        }
      })();
    });

    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('seekto', null);
      } catch {
        // Cleanup non supportato.
      }
    };
  }, [
    callYoutube,
    currentTrack,
    handleNext,
    handlePrev,
    pauseYoutubePlayback,
    startYoutubePlayback,
  ]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (desiredPlayingRef.current) {
          visibilityGuardRef.current = true;
          void ensureKeepAliveAudio();
          setMediaState('playing');
        }

        return;
      }

      if (document.visibilityState === 'visible') {
        visibilityGuardRef.current = false;

        if (desiredPlayingRef.current) {
          void startYoutubePlayback('visibility-visible');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [ensureKeepAliveAudio, setMediaState, startYoutubePlayback]);

  useEffect(() => {
    if (!isPlaying || !isReady || !currentTrack || isSeeking) return;

    const interval = window.setInterval(async () => {
      const time = await callYoutube<number>('getCurrentTime');
      const total = await callYoutube<number>('getDuration');

      if (typeof time === 'number' && Number.isFinite(time)) {
        setCurrentTime(time);

        if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
          setMediaPosition(time, total);
        }
      }

      if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
        setDuration(total);
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    callYoutube,
    currentTrack,
    isPlaying,
    isReady,
    isSeeking,
    setMediaPosition,
  ]);

  useEffect(() => {
    return () => {
      stopKeepAliveAudio();

      try {
        audioContextRef.current?.close();
      } catch {
        // AudioContext già chiuso.
      }
    };
  }, [stopKeepAliveAudio]);

  if (!currentTrack) return null;

  return (
    <>
      <audio
        ref={audioRef}
        loop
        preload="auto"
        playsInline
        aria-hidden="true"
        src={SILENT_AUDIO_SRC}
        style={{
          position: 'fixed',
          left: -9999,
          top: -9999,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      <div
        className={`
          pointer-events-none
          ${
            isMobileExpanded
              ? 'fixed inset-0 z-[98] bg-black overflow-hidden flex items-center justify-center'
              : 'z-[101]'
          }
          ${
            !isMobileExpanded && videoExpanded
              ? 'relative w-full bg-black flex justify-center h-[350px] border-b border-white/10 z-[101]'
              : ''
          }
          ${
            !isMobileExpanded && !videoExpanded
              ? 'fixed w-0 h-0 opacity-0 overflow-hidden z-[101]'
              : ''
          }
        `}
      >
        {!isMobileExpanded && videoExpanded && (
          <button
            onClick={() => setVideoExpanded(false)}
            className="absolute top-4 right-4 z-[102] pointer-events-auto p-2 bg-black/50 hover:bg-black/80 rounded-full text-white backdrop-blur-md transition-opacity"
            type="button"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        )}

        <div
          className={
            isMobileExpanded
              ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[177.77vh] h-[100vh] min-w-[100vw] min-h-[56.25vw] max-w-none opacity-100 pointer-events-none [&>div]:w-full [&>div]:h-full [&_iframe]:w-full [&_iframe]:h-full'
              : 'w-full h-full [&>div]:w-full [&>div]:h-full [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:object-cover overflow-hidden pointer-events-none'
          }
        >
          <YouTube
            key={`${currentTrack.videoId}-${playRequestId}`}
            videoId={currentTrack.videoId}
            opts={{
              width: '100%',
              height: '100%',
              playerVars: {
                autoplay: 1,
                controls: 0,
                modestbranding: 1,
                rel: 0,
                showinfo: 0,
                disablekb: 1,
                playsinline: 1,
                enablejsapi: 1,
                origin:
                  typeof window !== 'undefined' ? window.location.origin : '',
              },
            }}
            onReady={handleYoutubeReady}
            onStateChange={handleYoutubeStateChange}
            onPlay={() => {
              desiredPlayingRef.current = true;
              trackChangingRef.current = false;
              setIsPlaying(true);
              setMediaState('playing');
            }}
            onPause={() => {
              if (trackChangingRef.current) return;
              if (visibilityGuardRef.current) return;
              if (document.visibilityState === 'hidden') return;

              if (desiredPlayingRef.current) {
                void startYoutubePlayback('on-pause-resume');
                return;
              }

              setIsPlaying(false);
              setMediaState('paused');
            }}
            onEnd={() => {
              void handleNext();
            }}
            onError={() => {
              toast.error('Brano non disponibile o errore di riproduzione.');
              void handleNext();
            }}
          />
        </div>
      </div>

      <AnimatePresence>
        {isMobileExpanded && (
          <motion.div
            initial={{ y: '100%', opacity: 0, filter: 'blur(20px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: '100%', opacity: 0, filter: 'blur(20px)' }}
            transition={{
              type: 'spring',
              stiffness: 350,
              damping: 28,
              mass: 1,
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, { offset, velocity }) => {
              if (offset.y > 100 || velocity.y > 500) {
                setIsMobileExpanded(false);
              }
            }}
            className="fixed inset-0 z-[100] bg-gradient-to-t from-black/70 to-transparent flex flex-col px-4 pt-10 pb-4 touch-none"
          >
            <div className="flex items-center justify-between z-[102] relative">
              <button
                onClick={() => setIsMobileExpanded(false)}
                className="p-2 -ml-2 text-white hover:bg-white/10 rounded-full transition-colors drop-shadow-lg"
                type="button"
              >
                <ChevronDown className="w-6 h-6" />
              </button>

              <span className="text-[10px] font-bold uppercase tracking-widest text-white drop-shadow-lg">
                In riproduzione
              </span>

              <button
                onClick={() => setVideoExpanded(!videoExpanded)}
                className="p-2 -mr-2 text-white hover:bg-white/10 rounded-full transition-colors drop-shadow-lg"
                type="button"
              >
                {videoExpanded ? (
                  <Minimize2 className="w-5 h-5" />
                ) : (
                  <Maximize2 className="w-5 h-5" />
                )}
              </button>
            </div>

            <div className="absolute inset-x-0 top-20 bottom-[30vh] z-[101] flex">
              <div
                className="flex-1 flex items-center justify-center"
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
                      <span className="text-white font-bold mt-1 text-xs">
                        -10s
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div
                className="flex-1 flex items-center justify-center"
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
                      <span className="text-white font-bold mt-1 text-xs">
                        +10s
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex flex-col justify-end w-full mt-auto mb-0 z-[102] pt-6 pb-2">
              <div className="flex items-center justify-between mb-4">
                <motion.div
                  key={currentTrack.videoId}
                  initial={{ opacity: 0, y: 15, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{
                    duration: 0.6,
                    type: 'spring',
                    stiffness: 80,
                    damping: 20,
                  }}
                  className="flex flex-col flex-1 overflow-hidden pr-4"
                >
                  <h2 className="text-xl font-bold text-white truncate drop-shadow-lg">
                    {currentTrack.title}
                  </h2>
                  <p className="text-sm text-blue-300/80 truncate font-medium drop-shadow-md">
                    {currentTrack.channelTitle}
                  </p>
                </motion.div>
              </div>

              <div className="flex flex-col gap-1.5 mb-6 w-full relative">
                <div className="relative flex items-center justify-center h-6 w-full">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeekChange}
                    onMouseUp={() => void handleSeekCommit()}
                    onTouchEnd={() => void handleSeekCommit()}
                    className="absolute z-20 w-full h-full opacity-0 cursor-pointer touch-pan-x"
                  />

                  <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden shadow-inner flex items-center relative z-10">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-150 ease-out shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                      style={{
                        width: `${
                          duration > 0 ? (currentTime / duration) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex justify-between text-xs font-medium text-white/50 tracking-wide mt-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4 px-1">
                <button
                  className={`p-2 transition-all ${
                    shuffleMode
                      ? 'text-sky-400'
                      : 'text-white/60 hover:text-white'
                  }`}
                  onClick={() => setShuffleMode(!shuffleMode)}
                  type="button"
                >
                  <Shuffle className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2">
                  <button
                    className="text-white/90 hover:text-sky-400 p-2 transition-all active:scale-90"
                    onClick={() => void handlePrev()}
                    type="button"
                  >
                    <SkipBack className="w-7 h-7 fill-current" />
                  </button>

                  <button
                    className="text-white/80 hover:text-white p-2 transition-transform active:scale-90"
                    onClick={() => void handleSeekBackward()}
                    type="button"
                  >
                    <Rewind className="w-6 h-6 fill-current" />
                  </button>

                  <button
                    className="w-16 h-16 flex items-center justify-center bg-blue-500 hover:bg-blue-400 text-white shadow-[0_8px_32px_rgba(59,130,246,0.5)] rounded-full hover:scale-105 active:scale-95 transition-all"
                    onClick={togglePlayPause}
                    type="button"
                  >
                    {isPlaying ? (
                      <Pause className="w-7 h-7 fill-current" />
                    ) : (
                      <Play className="w-7 h-7 fill-current ml-1" />
                    )}
                  </button>

                  <button
                    className="text-white/80 hover:text-white p-2 transition-transform active:scale-90"
                    onClick={() => void handleSeekForward()}
                    type="button"
                  >
                    <FastForward className="w-6 h-6 fill-current" />
                  </button>

                  <button
                    className="text-white/90 hover:text-sky-400 p-2 transition-all active:scale-90"
                    onClick={() => void handleNext()}
                    type="button"
                  >
                    <SkipForward className="w-7 h-7 fill-current" />
                  </button>
                </div>

                <button
                  className={`p-2 transition-all ${
                    loopMode !== 'off'
                      ? 'text-sky-400'
                      : 'text-white/60 hover:text-white'
                  }`}
                  onClick={toggleLoop}
                  type="button"
                >
                  {loopMode === 'one' ? (
                    <Repeat1 className="w-5 h-5" />
                  ) : (
                    <Repeat className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={{
          y: isMobileExpanded ? 0 : isMobile && scrollingDown ? 76 : 0,
          scale: isMobile && scrollingDown ? 0.95 : 1,
          x: 0,
        }}
        drag={isMobile && !isMobileExpanded ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={(_, { offset, velocity }) => {
          if (!isMobile || isMobileExpanded) return;

          if (offset.x < -80 || velocity.x < -500) {
            triggerMiniSwipeFeedback('next');
            void handleNext();
            return;
          }

          if (offset.x > 80 || velocity.x > 500) {
            triggerMiniSwipeFeedback('rewind');
            void handleSeekBackward();
          }
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 25,
          mass: 1,
        }}
        className={`fixed z-50 left-3 right-3 bottom-[96px] md:bottom-6 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[760px] bg-black/60 backdrop-blur-3xl border border-white/20 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.6)] flex flex-col transition-opacity duration-300 ${
          isMobileExpanded
            ? 'opacity-0 pointer-events-none'
            : 'opacity-100 pointer-events-auto'
        }`}
        onClick={(event) => {
          if (
            window.innerWidth < 768 &&
            (event.target as HTMLElement).closest('.player-footer-clickable')
          ) {
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
          <motion.div
            key={currentTrack.videoId}
            initial={{ opacity: 0, x: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            transition={{
              duration: 0.6,
              type: 'spring',
              stiffness: 80,
              damping: 20,
            }}
            className="flex items-center flex-1 md:w-[30%] md:flex-none md:min-w-[180px] overflow-hidden drop-shadow-md"
          >
            <div className="w-11 h-11 md:w-14 md:h-14 bg-black/40 rounded-[12px] md:rounded-[16px] overflow-hidden flex-shrink-0 mr-3 border border-white/10 shadow-lg relative ml-1">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="w-full h-full object-cover relative z-0"
              />
            </div>

            <div className="overflow-hidden flex flex-col justify-center">
              <h4 className="text-[13px] md:text-[14px] font-bold truncate text-white leading-tight mb-1">
                {currentTrack.title}
              </h4>
              <p className="text-[11px] md:text-[12px] font-medium text-blue-300/70 truncate leading-tight">
                {currentTrack.channelTitle}
              </p>
            </div>
          </motion.div>

          <div
            className="flex md:hidden items-center justify-end gap-3 ml-4"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="p-2 text-white/70 hover:text-white transition-colors"
              onClick={() => void handleNext()}
              type="button"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <button
              className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white transition-all active:scale-95"
              onClick={togglePlayPause}
              type="button"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-1" />
              )}
            </button>
          </div>

          <div className="hidden md:flex flex-col items-center max-w-[722px] w-[40%]">
            <div className="flex items-center justify-center gap-6 mb-2">
              <button
                className={`transition-colors hover:scale-110 flex items-center justify-center ${
                  shuffleMode
                    ? 'text-sky-400'
                    : 'text-blue-200/60 hover:text-white'
                }`}
                onClick={() => setShuffleMode(!shuffleMode)}
                title="Casuale"
                type="button"
              >
                <Shuffle className="w-5 h-5 fill-current" />
              </button>

              <button
                className="text-blue-200/60 hover:text-white transition-colors hover:scale-110"
                onClick={() => void handlePrev()}
                type="button"
              >
                <SkipBack className="w-5 h-5 fill-current" />
              </button>

              <button
                className="w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md border border-white/10 shadow-[0_0_15px_rgba(56,189,248,0.2)] text-blue-200 hover:text-white transition-all hover:scale-105"
                onClick={togglePlayPause}
                type="button"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 fill-current text-white drop-shadow-md" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-1 text-white drop-shadow-md" />
                )}
              </button>

              <button
                className="text-blue-200/60 hover:text-white transition-colors hover:scale-110"
                onClick={() => void handleNext()}
                type="button"
              >
                <SkipForward className="w-5 h-5 fill-current" />
              </button>

              <button
                className={`transition-colors hover:scale-110 flex items-center justify-center ${
                  loopMode !== 'off'
                    ? 'text-sky-400'
                    : 'text-blue-200/60 hover:text-white'
                }`}
                onClick={toggleLoop}
                title="Ripeti"
                type="button"
              >
                {loopMode === 'one' ? (
                  <Repeat1 className="w-5 h-5" />
                ) : (
                  <Repeat className="w-5 h-5" />
                )}
              </button>
            </div>

            <div className="w-full flex items-center gap-2 group">
              <span className="text-[11px] font-medium text-blue-200/60 w-10 text-right">
                {formatTime(currentTime)}
              </span>

              <div className="relative flex items-center justify-center h-4 flex-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeekChange}
                  onMouseUp={() => void handleSeekCommit()}
                  onTouchEnd={() => void handleSeekCommit()}
                  className="absolute z-20 w-full h-full opacity-0 cursor-pointer"
                />

                <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full"
                    style={{
                      width: `${
                        duration > 0 ? (currentTime / duration) * 100 : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              <span className="text-[11px] font-medium text-blue-200/60 w-10">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center justify-end gap-2 md:w-[30%]">
            <button
              className="p-2 text-blue-200/60 hover:text-white transition-colors"
              onClick={() => setVideoExpanded(!videoExpanded)}
              title={videoExpanded ? 'Riduci video' : 'Espandi video'}
              type="button"
            >
              {videoExpanded ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>
          </div>
        </footer>
      </motion.div>
    </>
  );
}