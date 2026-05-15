'use client';

import { usePlayerStore } from '@/lib/store';
import { Pause, Play, SkipForward, SkipBack, Rewind, FastForward, Heart, ListPlus, Repeat, Repeat1, Shuffle, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import ReactPlayer from 'react-youtube';
import { useRef, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

// ---- iOS background audio helpers ----

const isIOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

const SILENT_AUDIO_SRC = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

// Debug ring buffer (inspects from Safari Web Inspector via window.__albifyPlayerDebug)
const debugEnabled = typeof window !== 'undefined' &&
  (localStorage.getItem('albify:player-debug') === '1' ||
   new URLSearchParams(window.location.search).has('albify-player-debug'));

type DebugEntry = {
  ts: number;
  event: string;
  reason?: string;
  playbackMode?: string;
  provider?: string;
  visibilityState?: string;
  audioPaused?: boolean;
  audioReadyState?: number;
  audioNetworkState?: number;
  currentTime?: number;
  duration?: number;
  desiredPlaying?: boolean;
  useIframeFallback?: boolean;
  trackId?: string;
  candidateIndex?: number;
  candidateCount?: number;
  errorCode?: number;
  isIOSAudioPlatform?: boolean;
  innerWidth?: number;
};

const pushDebug = (entry: Omit<DebugEntry, 'ts'>) => {
  if (!debugEnabled) return;
  const ring: DebugEntry[] = ((window as any).__albifyPlayerDebug = (window as any).__albifyPlayerDebug || []);
  ring.push({ ts: Date.now(), ...entry });
  if (ring.length > 150) ring.splice(0, ring.length - 150);
};

// Debug export: copy full debug log to clipboard (call from Safari Inspector)
// Usage: window.__albifyExportDebug()
if (typeof window !== 'undefined' && debugEnabled) {
  (window as any).__albifyExportDebug = () => {
    const ring: DebugEntry[] = (window as any).__albifyPlayerDebug || [];
    const summary = {
      exportTime: new Date().toISOString(),
      isIOS,
      isIOSAudioPlatform: isIOS,
      userAgent: navigator.userAgent,
      innerWidth: window.innerWidth,
      entryCount: ring.length,
      entries: ring,
    };
    const json = JSON.stringify(summary, null, 2);
    console.log('[Albify Debug Export]', json);
    try { navigator.clipboard.writeText(json); console.log('[Albify Debug] Copied to clipboard'); } catch { /* no clipboard */ }
    return summary;
  };
}

// ---- End iOS background audio helpers ----

export function Player() {
  const { user } = useAuth();
  const { currentTrack, isPlaying, setIsPlaying, playNext, playPrevious, playRequestId, loopMode, setLoopMode, shuffleMode, setShuffleMode, videoExpanded, setVideoExpanded } = usePlayerStore();
  const playerRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const keepAliveAudioRef = useRef<HTMLAudioElement>(null);  // iOS keepalive anchor
  const iosMediaPrimedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const desiredPlayingRef = useRef(false);
  const currentTrackIdRef = useRef('');
  const isSwitchingTrackRef = useRef(false);
  const streamRequestRef = useRef(0);
  const lastPlayRequestRef = useRef(0);
  const retryPlayTimeoutRef = useRef<number | null>(null);

  // Lifecycle / pause-source tracking (iOS background fix)
  const isBackgroundingRef = useRef(false);
  const userPausedRef = useRef(false);
  const pauseReasonRef = useRef<string>('');

  const [isStreamReady, setIsStreamReady] = useState(false);
  const [streamVideoId, setStreamVideoId] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
  const [lastY, setLastY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const isMobileRef = useRef(false);
  // Keep ref in sync
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  const [seekAnimation, setSeekAnimation] = useState<'forward' | 'backward' | null>(null);
  const [miniSwipeFeedback, setMiniSwipeFeedback] = useState<'next' | 'rewind' | null>(null);
  const [streamRetries, setStreamRetries] = useState(0);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const retryTimeoutRef = useRef<number | null>(null);

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

  const expandMobilePlayer = useCallback(() => {
    if (!isMobile || !currentTrack) return;
    setIsMobileExpanded(true);
  }, [currentTrack, isMobile]);

  useEffect(() => {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleCollapsePlayer = () => {
      setIsMobileExpanded(false);
      setVideoExpanded(false);
    };

    window.addEventListener('albify:collapse-player', handleCollapsePlayer);
    return () => window.removeEventListener('albify:collapse-player', handleCollapsePlayer);
  }, [setVideoExpanded]);

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

  const clearRetryPlayTimeout = useCallback(() => {
    if (retryPlayTimeoutRef.current !== null) {
      window.clearTimeout(retryPlayTimeoutRef.current);
      retryPlayTimeoutRef.current = null;
    }
  }, []);

  const MAX_STREAM_RETRIES = 3;
  const RETRY_BASE_DELAY = 1500;

  const primeIOSMediaUnlock = useCallback((reason = 'gesture') => {
    if (!isIOS || iosMediaPrimedRef.current) return;

    const audio = audioRef.current;
    const keepAlive = keepAliveAudioRef.current;

    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }

    if (audio && !currentTrackIdRef.current && !audio.src) {
      try {
        audio.muted = true;
        audio.loop = true;
        audio.src = SILENT_AUDIO_SRC;
        audio.load();
        void audio.play()
          .then(() => {
            iosMediaPrimedRef.current = true;
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            audio.loop = false;
            if (!currentTrackIdRef.current) {
              audio.src = '';
            }
            pushDebug({ event: 'ios-media-primed', reason, playbackMode: 'native', isIOSAudioPlatform: true });
          })
          .catch((err) => {
            audio.muted = false;
            audio.loop = false;
            pushDebug({ event: 'ios-media-prime-failed', reason, playbackMode: 'native', isIOSAudioPlatform: true, errorCode: (err as any)?.code });
          });
      } catch (err) {
        pushDebug({ event: 'ios-media-prime-error', reason, playbackMode: 'native', isIOSAudioPlatform: true, errorCode: (err as any)?.code });
      }
    }

    if (keepAlive) {
      void keepAlive.play()
        .then(() => {
          iosMediaPrimedRef.current = true;
          pushDebug({ event: 'keepalive-primed', reason, playbackMode: 'native', isIOSAudioPlatform: true });
        })
        .catch(() => {});
    }
  }, []);

  // Store candidates for fast retry without re-fetching
  const streamCandidatesRef = useRef<string[]>([]);
  const streamCandidateIndexRef = useRef(0);

  const tryFetchStream = useCallback(async (videoId: string, requestId: number, attempt: number = 0): Promise<void> => {
    // On retry (attempt > 0), try stored candidates first before re-fetching from server
    if (attempt > 0) {
      const candidates = streamCandidatesRef.current;
      const nextIndex = streamCandidateIndexRef.current + 1;

      if (candidates.length > 0 && nextIndex < candidates.length) {
        // Try next stored candidate — no server round-trip needed
        const url = candidates[nextIndex];
        if (audioRef.current && url) {
          streamCandidateIndexRef.current = nextIndex;
          audioRef.current.muted = false;
          audioRef.current.loop = false;
          audioRef.current.src = url;
          audioRef.current.load();
          const storeState = usePlayerStore.getState();
          if (storeState.playRequestId > lastPlayRequestRef.current) {
            desiredPlayingRef.current = true;
          }
          pushDebug({ event: 'candidate-rotate', reason: 'using-stored-candidate', candidateIndex: nextIndex, candidateCount: candidates.length, playbackMode: 'native', trackId: videoId, isIOSAudioPlatform: isIOS });
          setStreamVideoId(videoId);
          setIsStreamReady(true);
          setUseIframeFallback(false);
          setStreamRetries(0);
          return;
        }
      }
      // All stored candidates exhausted — fall through to server re-fetch
      pushDebug({ event: 'candidate-exhausted', reason: 'no-more-stored-candidates', candidateIndex: streamCandidateIndexRef.current, candidateCount: candidates.length, trackId: videoId });
    }

    const doFetch = async (tryIdx: number) => {
      const controller = new AbortController();
      const res = await fetch(`/api/youtube/stream?v=${videoId}&try=${tryIdx}`, { signal: controller.signal });
      if (streamRequestRef.current !== requestId) return null;
      const data = await res.json();
      if (streamRequestRef.current !== requestId) return null;
      return data;
    };

    try {
      const data = await doFetch(0);

      if (!data) return; // request cancelled

      if (data.url) {
        // Store candidates for fast recovery
        if (Array.isArray(data.candidates)) {
          streamCandidatesRef.current = data.candidates.map((c: any) => c.url);
          streamCandidateIndexRef.current = data.selectedIndex ?? 0;
        }

        if (audioRef.current) {
          audioRef.current.muted = false;
          audioRef.current.loop = false;
          audioRef.current.src = data.url;
          audioRef.current.load();
        }
        const storeState = usePlayerStore.getState();
        if (storeState.playRequestId > lastPlayRequestRef.current) {
          desiredPlayingRef.current = true;
        }
        pushDebug({ event: 'stream-loaded', reason: 'native-stream-ready', playbackMode: 'native', provider: data.provider, trackId: videoId, candidateIndex: data.selectedIndex ?? 0, candidateCount: data.candidates?.length ?? 1, isIOSAudioPlatform: isIOS });
        setStreamVideoId(videoId);
        setIsStreamReady(true);
        setUseIframeFallback(false);
        setStreamRetries(0);
        return;
      }

      // No URL — retry if attempts remain
      if (attempt < MAX_STREAM_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.warn(`Stream fetch attempt ${attempt + 1}/${MAX_STREAM_RETRIES} failed for ${videoId}, retrying in ${delay}ms`);
        pushDebug({ event: 'stream-retry', reason: 'no-url', playbackMode: 'native', trackId: videoId, candidateIndex: streamCandidateIndexRef.current, candidateCount: streamCandidatesRef.current.length, isIOSAudioPlatform: isIOS });
        retryTimeoutRef.current = window.setTimeout(() => {
          retryTimeoutRef.current = null;
          if (streamRequestRef.current === requestId) {
            tryFetchStream(videoId, requestId, attempt + 1);
          }
        }, delay);
        setStreamRetries(attempt + 1);
        return;
      }

      // All retries exhausted — on iOS, NEVER fall back to iframe
      if (isIOS) {
        if (attempt < 6) {
          const delay = RETRY_BASE_DELAY * Math.pow(1.5, attempt);
          pushDebug({ event: 'stream-retry-extended', reason: 'no-url', playbackMode: 'native', trackId: videoId, desiredPlaying: desiredPlayingRef.current, visibilityState: document.visibilityState, isIOSAudioPlatform: true, candidateIndex: streamCandidateIndexRef.current, candidateCount: streamCandidatesRef.current.length });
          retryTimeoutRef.current = window.setTimeout(() => {
            retryTimeoutRef.current = null;
            if (streamRequestRef.current === requestId) {
              tryFetchStream(videoId, requestId, attempt + 1);
            }
          }, delay);
          setStreamRetries(attempt + 1);
          return;
        }
        pushDebug({ event: 'stream-exhausted', reason: 'all-native-retries-failed', playbackMode: 'native', trackId: videoId, desiredPlaying: desiredPlayingRef.current, isIOSAudioPlatform: true });
        console.warn(`All ${attempt + 1} native stream attempts failed for ${videoId} on iOS. Not falling back to iframe.`);
        setIsStreamReady(true);
        setStreamVideoId('');
        setUseIframeFallback(false);
        setStreamRetries(0);
        return;
      }
      console.warn(`All stream attempts failed for ${videoId}, falling back to iframe playback`);
      pushDebug({ event: 'stream-fallback', reason: 'iframe-fallback', playbackMode: 'iframe-fallback', trackId: videoId, isIOSAudioPlatform: false });
      setUseIframeFallback(true);
      setIsStreamReady(true);
      setStreamVideoId(videoId);
      setStreamRetries(0);
    } catch (err) {
      if (streamRequestRef.current !== requestId) return;

      if (attempt < MAX_STREAM_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        pushDebug({ event: 'stream-retry', reason: 'fetch-error', playbackMode: 'native', trackId: videoId, desiredPlaying: desiredPlayingRef.current, candidateIndex: streamCandidateIndexRef.current });
        retryTimeoutRef.current = window.setTimeout(() => {
          retryTimeoutRef.current = null;
          if (streamRequestRef.current === requestId) {
            tryFetchStream(videoId, requestId, attempt + 1);
          }
        }, delay);
        setStreamRetries(attempt + 1);
        return;
      }

      if (isIOS && attempt < 6) {
        const delay = RETRY_BASE_DELAY * Math.pow(1.5, attempt);
        pushDebug({ event: 'stream-retry-extended', reason: 'fetch-error', playbackMode: 'native', trackId: videoId, desiredPlaying: desiredPlayingRef.current, isIOSAudioPlatform: true });
        retryTimeoutRef.current = window.setTimeout(() => {
          retryTimeoutRef.current = null;
          if (streamRequestRef.current === requestId) {
            tryFetchStream(videoId, requestId, attempt + 1);
          }
        }, delay);
        setStreamRetries(attempt + 1);
        return;
      }

      if (isIOS) {
        pushDebug({ event: 'stream-exhausted', reason: 'all-native-retries-failed-fetch-error', playbackMode: 'native', trackId: videoId, desiredPlaying: desiredPlayingRef.current, isIOSAudioPlatform: true });
        console.warn(`All ${attempt + 1} native stream attempts failed for ${videoId} on iOS (fetch error). Not falling back to iframe.`);
        setIsStreamReady(true);
        setStreamVideoId('');
        setUseIframeFallback(false);
        setStreamRetries(0);
        return;
      }

      console.warn(`All stream attempts failed for ${videoId}, falling back to iframe playback`);
      pushDebug({ event: 'stream-fallback', reason: 'iframe-fallback-fetch-error', playbackMode: 'iframe-fallback', trackId: videoId, isIOSAudioPlatform: false });
      setUseIframeFallback(true);
      setIsStreamReady(true);
      setStreamVideoId(videoId);
      setStreamRetries(0);
    }
  }, []);

  // Fetch audio stream URL when track changes
  useEffect(() => {
    const audio = audioRef.current;

    if (!currentTrack?.videoId) {
      currentTrackIdRef.current = '';
      desiredPlayingRef.current = false;
      isSwitchingTrackRef.current = false;
      playerRef.current = null;
      clearRetryPlayTimeout();
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      setStreamVideoId('');
      setIsStreamReady(false);
      setUseIframeFallback(false);
      setStreamRetries(0);
      streamCandidatesRef.current = [];
      streamCandidateIndexRef.current = 0;
      if (audio) {
        audio.pause();
        audio.muted = false;
        audio.loop = false;
        audio.src = '';
      }
      return;
    }

    const videoId = currentTrack.videoId;
    currentTrackIdRef.current = videoId;
    const requestId = streamRequestRef.current + 1;
    streamRequestRef.current = requestId;

    // Preserve play intent
    const wantsToPlay = desiredPlayingRef.current || usePlayerStore.getState().playRequestId > lastPlayRequestRef.current;
    desiredPlayingRef.current = wantsToPlay;

    setCurrentTime(0);
    setDuration(0);
    setIsStreamReady(false);
    setStreamVideoId('');
    setUseIframeFallback(false);
    setStreamRetries(0);
    isSwitchingTrackRef.current = true;
    playerRef.current = null;
    clearRetryPlayTimeout();

    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (audio) {
      audio.pause();
      audio.muted = false;
      audio.loop = false;
      audio.src = '';  // Simple reset — don't removeAttribute+load (can break mobile)
    }

    tryFetchStream(videoId, requestId, 0);

    return () => {
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [clearRetryPlayTimeout, currentTrack?.videoId, setIsPlaying, tryFetchStream]);

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

    if (!currentTrack || document.visibilityState === 'hidden') {
      return;
    }

    // In iframe fallback mode, the iframe IS the audio source — don't mute it
    if (!useIframeFallback) {
      await callVideo('mute');
      await callVideo('setVolume', [0]);
    }

    if (useIframeFallback) {
      // In fallback mode, sync from video to nothing (the video is the source)
      return;
    }

    if (!audio) return;

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
  }, [callVideo, currentTrack, useIframeFallback]);

  const safePlayerCall = useCallback(async (method: string, args: any[] = []) => {
    try {
      const audio = audioRef.current;

      // If using iframe fallback, delegate everything to the YouTube player
      if (useIframeFallback) {
        switch (method) {
          case 'playVideo':
            desiredPlayingRef.current = true;
            // Unmute the iframe for audible playback
            await callVideo('unMute');
            await callVideo('setVolume', [100]);
            const played = await callVideo('playVideo');
            if (played !== undefined) {
              isSwitchingTrackRef.current = false;
              clearRetryPlayTimeout();
              setIsPlaying(true);
              return true;
            }
            return false;
          case 'pauseVideo':
            desiredPlayingRef.current = false;
            isSwitchingTrackRef.current = false;
            clearRetryPlayTimeout();
            setIsPlaying(false);
            return await callVideo('pauseVideo');
          case 'seekTo':
            return await callVideo('seekTo', args);
          case 'getCurrentTime':
            return await callVideo<number>('getCurrentTime') || 0;
          case 'getDuration':
            return await callVideo<number>('getDuration') || 0;
          default:
            return callVideo(method, args);
        }
      }

      // Native audio mode
      switch (method) {
        case 'playVideo':
          desiredPlayingRef.current = true;
          if (!audio || !audio.src) {
            // No audio source — fall back to iframe (desktop only, never iOS)
            const vid = currentTrackIdRef.current;
            if (vid && !useIframeFallback && !isIOS) {
              console.warn('No audio source available, falling back to iframe');
              pushDebug({ event: 'iframe-fallback-triggered', reason: 'no-audio-src', playbackMode: 'iframe-fallback', trackId: vid, isIOSAudioPlatform: false });
              setUseIframeFallback(true);
              setIsStreamReady(true);
              setStreamVideoId(vid);
            } else if (isIOS) {
              pushDebug({ event: 'ios-no-audio-src-no-iframe', reason: 'no-audio-src-ios', playbackMode: 'native', trackId: vid, isIOSAudioPlatform: true });
            }
            return false;
          }
          if (audioCtxRef.current?.state === 'suspended') {
            await audioCtxRef.current.resume().catch(() => {});
          }
          try {
            await audio.play();
            isSwitchingTrackRef.current = false;
            clearRetryPlayTimeout();
            setIsPlaying(true);
            void syncVideoToAudio(true);
            return true;
          } catch (playErr) {
            // audio.play() rejected (autoplay policy, CORS, etc.) — fall back to iframe (desktop only, never iOS)
            const vid = currentTrackIdRef.current;
            console.warn('audio.play() rejected, falling back to iframe:', playErr);
            if (vid && !useIframeFallback && !isIOS) {
              pushDebug({ event: 'iframe-fallback-triggered', reason: 'play-rejected', playbackMode: 'iframe-fallback', trackId: vid, isIOSAudioPlatform: false });
              setUseIframeFallback(true);
              setIsStreamReady(true);
              setStreamVideoId(vid);
            } else if (isIOS) {
              pushDebug({ event: 'ios-play-rejected-no-iframe', reason: 'play-rejected-ios', playbackMode: 'native', trackId: vid, isIOSAudioPlatform: true });
            }
            return false;
          }
        case 'pauseVideo':
          desiredPlayingRef.current = false;
          isSwitchingTrackRef.current = false;
          clearRetryPlayTimeout();
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
  }, [callVideo, clearRetryPlayTimeout, setIsPlaying, syncVideoToAudio, useIframeFallback]);

  const retryPlayForCurrentTrack = useCallback((delay = 250) => {
    clearRetryPlayTimeout();

    if (!desiredPlayingRef.current || !currentTrack?.videoId) {
      return;
    }

    const videoId = currentTrack.videoId;
    retryPlayTimeoutRef.current = window.setTimeout(() => {
      retryPlayTimeoutRef.current = null;
      if (
        desiredPlayingRef.current &&
        currentTrackIdRef.current === videoId &&
        isStreamReady &&
        streamVideoId === videoId &&
        audioRef.current?.paused
      ) {
        void safePlayerCall('playVideo');
      }
    }, delay);
  }, [
    clearRetryPlayTimeout,
    currentTrack,
    isStreamReady,
    safePlayerCall,
    streamVideoId,
  ]);

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
      isSwitchingTrackRef.current = false;
      setIsPlaying(true);
      void syncVideoToAudio(true);
    };
    const onPause = () => {
      // Ignore pause events when switching tracks (the old track being stopped)
      if (isSwitchingTrackRef.current) {
        pushDebug({ event: 'pause-ignored', reason: 'track-switch' });
        return;
      }
      // Also ignore if the audio element's src is empty/unset (means old track was cleared)
      if (!audio.src || audio.src === '' || audio.src === window.location.href) {
        pushDebug({ event: 'pause-ignored', reason: 'no-src' });
        return;
      }

      // iOS background/lifecycle pause vs user pause distinction
      if (isBackgroundingRef.current || document.visibilityState === 'hidden') {
        // OS/lifecycle induced — don't mark as user paused
        pushDebug({ event: 'pause-lifecycle', reason: 'backgrounding-or-hidden', playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', desiredPlaying: desiredPlayingRef.current, visibilityState: document.visibilityState, audioPaused: audio.paused });
        pauseReasonRef.current = 'lifecycle';
        void callVideo('pauseVideo');
        return;
      }

      // True user-initiated pause
      pushDebug({ event: 'pause-user', reason: 'user-pause', playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', desiredPlaying: desiredPlayingRef.current });
      pauseReasonRef.current = 'user';
      userPausedRef.current = true;
      desiredPlayingRef.current = false;
      setIsPlaying(false);
      void callVideo('pauseVideo');
    };
    const onPlaying = () => {
      isSwitchingTrackRef.current = false;
      isBackgroundingRef.current = false;
      userPausedRef.current = false;
      clearRetryPlayTimeout();
      pushDebug({ event: 'playing', playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', audioPaused: audio.paused });
      void syncVideoToAudio(true);
    };
    const onWaiting = () => {
      if (isSwitchingTrackRef.current && desiredPlayingRef.current) {
        return;
      }
      pushDebug({ event: 'waiting', playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', audioPaused: audio.paused, audioReadyState: audio.readyState });
      void callVideo('pauseVideo');
    };
    const onCanPlay = () => {
      pushDebug({ event: 'canplay', playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', audioPaused: audio.paused });
      if (desiredPlayingRef.current && audio.paused) {
        void safePlayerCall('playVideo');
        return;
      }
      void syncVideoToAudio(true);
    };
    const onError = () => {
      // Native audio failed to load
      const vid = currentTrackIdRef.current;
      pushDebug({ event: 'audio-error', reason: 'native-audio-error', playbackMode: 'native', trackId: vid, audioPaused: audio.paused, audioReadyState: audio.readyState, errorCode: audio.error?.code, isIOSAudioPlatform: isIOS });
      if (isSwitchingTrackRef.current && desiredPlayingRef.current && vid) {
        // On iOS — retry stream, NEVER fall back to iframe
        if (isIOS) {
          console.warn(`Audio element error for ${vid} on iOS, re-fetching stream`);
          pushDebug({ event: 'ios-audio-error-retry', reason: 're-fetch-stream', trackId: vid, isIOSAudioPlatform: true });
          // Retry the stream fetch with a new request ID
          const newRequestId = streamRequestRef.current + 1;
          streamRequestRef.current = newRequestId;
          tryFetchStream(vid, newRequestId, 3);
          return;
        }
        console.warn(`Audio element error for ${vid}, falling back to iframe`);
        pushDebug({ event: 'iframe-fallback-triggered', reason: 'audio-error-retry-exhausted', playbackMode: 'iframe-fallback', trackId: vid, isIOSAudioPlatform: false });
        setUseIframeFallback(true);
        setIsStreamReady(true);
        setStreamVideoId(vid);
      }
    };
    const onStalled = () => {
      // Audio stalled — try to recover
      pushDebug({ event: 'audio-stalled', reason: 'native-audio-stalled', playbackMode: 'native', audioPaused: audio.paused, audioReadyState: audio.readyState, isIOSAudioPlatform: isIOS });
      if (desiredPlayingRef.current) {
        const vid = currentTrackIdRef.current;
        if (vid) {
          window.setTimeout(() => {
            const a = audioRef.current;
            if (desiredPlayingRef.current && a?.paused && (a?.readyState ?? 0) < 3) {
              pushDebug({ event: 'audio-stalled-recovery', reason: 'still-stalled', trackId: vid, audioReadyState: a?.readyState ?? 0, isIOSAudioPlatform: isIOS });
              // On iOS — retry stream, NEVER fall back to iframe
              if (isIOS) {
                console.warn(`Audio still stalled for ${vid} on iOS, re-fetching stream`);
                pushDebug({ event: 'ios-stalled-retry', reason: 're-fetch-stream', trackId: vid, isIOSAudioPlatform: true });
                const newRequestId = streamRequestRef.current + 1;
                streamRequestRef.current = newRequestId;
                tryFetchStream(vid, newRequestId, 3);
                return;
              }
              console.warn(`Audio stalled for ${vid}, falling back to iframe`);
              pushDebug({ event: 'iframe-fallback-triggered', reason: 'stalled-recovery-exhausted', playbackMode: 'iframe-fallback', trackId: vid, isIOSAudioPlatform: false });
              setUseIframeFallback(true);
              setIsStreamReady(true);
              setStreamVideoId(vid);
            }
          }, 2000);
        }
      }
    };
    const onSuspend = () => {
      pushDebug({ event: 'audio-suspend', reason: 'native-audio-suspend', playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', audioPaused: audio.paused, audioReadyState: audio.readyState, audioNetworkState: audio.networkState, desiredPlaying: desiredPlayingRef.current });
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    audio.addEventListener('suspend', onSuspend);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
      audio.removeEventListener('suspend', onSuspend);
    };
  }, [
    callVideo,
    clearRetryPlayTimeout,
    currentTrack,
    handleNext,
    isSeeking,
    safePlayerCall,
    setIsPlaying,
    syncVideoToAudio,
    tryFetchStream,
    useIframeFallback,
  ]);

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
    isSwitchingTrackRef.current = false;

    // In iframe fallback mode, the iframe might not be ready yet.
    // handlePlayerReady will trigger playback when it fires.
    // We still try here in case the iframe IS already ready.
    void safePlayerCall('playVideo').then((started) => {
      if (!started) {
        clearRetryPlayTimeout();
        const vid = currentTrack.videoId;
        // Retry up to 3 times with increasing delays (waiting for iframe to be ready)
        const scheduleRetry = (attempt: number) => {
          if (attempt > 2) return; // Max 3 attempts
          const delay = 300 + attempt * 400;
          retryPlayTimeoutRef.current = window.setTimeout(() => {
            retryPlayTimeoutRef.current = null;
            if (
              desiredPlayingRef.current &&
              currentTrackIdRef.current === vid
            ) {
              // In iframe fallback, only check if we're still on the same track
              // In native mode, also check audio is paused
              if (useIframeFallback) {
                void safePlayerCall('playVideo').then((s) => {
                  if (!s) scheduleRetry(attempt + 1);
                });
              } else if (audioRef.current?.paused) {
                void safePlayerCall('playVideo').then((s) => {
                  if (!s) scheduleRetry(attempt + 1);
                });
              }
            }
          }, delay);
        };
        scheduleRetry(0);
      }
    });
  }, [
    clearRetryPlayTimeout,
    currentTrack,
    isStreamReady,
    playRequestId,
    safePlayerCall,
    streamVideoId,
    syncVideoToAudio,
    useIframeFallback,
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

  // iOS keepalive anchor lifecycle: start on first play, stop on pause/unmount
  useEffect(() => {
    if (!isIOS) return;
    const keepAlive = keepAliveAudioRef.current;
    if (!keepAlive) return;

    if (isPlaying && desiredPlayingRef.current && currentTrack) {
      // Keep alive while playing
      keepAlive.play().catch(() => {});
      pushDebug({ event: 'keepalive-start', reason: 'playback-active' });
    } else if (!desiredPlayingRef.current && !currentTrack) {
      // No track, stop keepalive
      keepAlive.pause();
      pushDebug({ event: 'keepalive-stop', reason: 'no-track' });
    }
  }, [isPlaying, currentTrack]);

  // Stop keepalive on unmount
  useEffect(() => {
    const k = keepAliveAudioRef.current;
    return () => {
      if (k && isIOS) {
        k.pause();
        pushDebug({ event: 'keepalive-stop', reason: 'unmount' });
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearRetryPlayTimeout();
    };
  }, [clearRetryPlayTimeout]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = AC ? new AC() : null;
      audioCtxRef.current = ctx;
      const unlock = () => {
        primeIOSMediaUnlock('document-gesture');
        if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
        if (!ctx) return;
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
      document.addEventListener('pointerdown', unlock, { passive: true, capture: true });
      document.addEventListener('touchstart', unlock, { passive: true, capture: true });
      document.addEventListener('click', unlock, { passive: true, capture: true });
      return () => {
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('touchstart', unlock, true);
        document.removeEventListener('click', unlock, true);
        ctx?.close().catch(() => {});
      };
    } catch(e) {}
  }, [primeIOSMediaUnlock]);

  const togglePlayPause = () => {
    if (isPlaying) {
      userPausedRef.current = true; // Mark as explicit user pause
      pauseReasonRef.current = 'user';
      void safePlayerCall('pauseVideo');
      return;
    }

    userPausedRef.current = false;
    desiredPlayingRef.current = true;
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
      const vis = document.visibilityState;
      pushDebug({ event: 'visibilitychange', reason: vis === 'visible' ? 'foreground' : 'background', visibilityState: vis, desiredPlaying: desiredPlayingRef.current, audioPaused: audioRef.current?.paused, useIframeFallback, playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', audioReadyState: audioRef.current?.readyState, audioNetworkState: audioRef.current?.networkState, isIOSAudioPlatform: isIOS, innerWidth: window.innerWidth });

      if (vis === 'visible') {
        // Coming back to foreground
        isBackgroundingRef.current = false;

        if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }

        // Don't auto-resume if user explicitly paused
        if (userPausedRef.current) {
          pushDebug({ event: 'visibilitychange-skip-resume', reason: 'user-paused' });
          void syncVideoToAudio(true);
          return;
        }

        if (desiredPlayingRef.current && audioRef.current?.paused && audioRef.current?.src) {
          // iOS WebKit bug #295518: Audio element can become broken after background.
          // If readyState is 0 (HAVE_NOTHING) on resume, recreate the audio element
          // by resetting its src to force a fresh load.
          if (isIOS && audioRef.current.readyState === 0 && streamCandidatesRef.current.length > 0) {
            pushDebug({ event: 'ios-audio-recreate', reason: 'webkit-bug-workaround-readyState-0', isIOSAudioPlatform: true, candidateIndex: streamCandidateIndexRef.current, candidateCount: streamCandidatesRef.current.length });
            // Force reload the current candidate URL
            const currentUrl = streamCandidatesRef.current[streamCandidateIndexRef.current] || audioRef.current.src;
            audioRef.current.src = '';
            audioRef.current.removeAttribute('src');
            audioRef.current.load(); // explicit load to reset element state
            audioRef.current.src = currentUrl;
            audioRef.current.load();
            // Play will be attempted through safePlayerCall below, but also try directly
            audioRef.current.play().catch(() => {}).then(() => {
              pushDebug({ event: 'ios-audio-recreate-play', reason: 'play-after-recreate', audioPaused: audioRef.current?.paused, audioReadyState: audioRef.current?.readyState });
            });
          } else {
            pushDebug({ event: 'visibilitychange-resume', reason: 'auto-resume-from-background' });
            void safePlayerCall('playVideo');
          }
          return;
        }
        void syncVideoToAudio(true);
      } else {
        // Going to background
        isBackgroundingRef.current = true;
        pushDebug({ event: 'visibilitychange-background', reason: 'going-to-background', desiredPlaying: desiredPlayingRef.current, playbackMode: useIframeFallback ? 'iframe-fallback' : 'native', isIOSAudioPlatform: isIOS });

        // Keep audio alive on iOS when going to background
        if (desiredPlayingRef.current && audioRef.current?.src) {
          audioRef.current.play().catch(() => {});
        }

        // Keep keepalive anchor alive on iOS
        if (isIOS && keepAliveAudioRef.current) {
          keepAliveAudioRef.current.play().catch(() => {});
        }
      }
    };

    const handlePageHide = () => {
      isBackgroundingRef.current = true;
      pushDebug({ event: 'pagehide', reason: 'page-unloading', desiredPlaying: desiredPlayingRef.current, audioPaused: audioRef.current?.paused });
  
      // Keep alive one last time before page freezes
      if (isIOS && keepAliveAudioRef.current) {
        keepAliveAudioRef.current.play().catch(() => {});
      }
    };

    const handlePageShow = () => {
      isBackgroundingRef.current = false;
      pushDebug({ event: 'pageshow', reason: 'page-restored', desiredPlaying: desiredPlayingRef.current });

      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }

      if (!userPausedRef.current && desiredPlayingRef.current && audioRef.current?.paused && audioRef.current?.src) {
        pushDebug({ event: 'pageshow-resume', reason: 'auto-resume-after-pageshow' });
        void safePlayerCall('playVideo');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [safePlayerCall, syncVideoToAudio, useIframeFallback]);

  useEffect(() => {
    if (!currentTrack) return;

    const interval = window.setInterval(() => {
      if (useIframeFallback) {
        // In iframe fallback mode, sync progress from the YouTube player
        void callVideo<number>('getCurrentTime').then((t) => {
          if (typeof t === 'number' && Number.isFinite(t)) {
            if (!isSeeking) setCurrentTime(t);
          }
        });
        void callVideo<number>('getDuration').then((d) => {
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
            setDuration(d);
          }
        });
        // Update playing state from iframe
        void callVideo<number>('getPlayerState').then((state) => {
          if (state === 1) { // YT.PlayerState.PLAYING
            if (!isPlaying) setIsPlaying(true);
          } else if (state === 2) { // YT.PlayerState.PAUSED
            if (isPlaying) setIsPlaying(false);
          }
        });
      } else {
        void syncVideoToAudio(false);
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentTrack, syncVideoToAudio, useIframeFallback, isSeeking, isPlaying, setIsPlaying, callVideo]);

  const handlePrev = useCallback(async () => {
    if (currentTime > 3) {
      await safePlayerCall('seekTo', [0]);
      setCurrentTime(0);
    } else {
      playPrevious();
    }
  }, [currentTime, playPrevious, safePlayerCall]);

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const audioElements = (
    <>
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
      />
      {/* iOS keepalive anchor: silent WAV keeps media session alive during background */}
      <audio
        ref={keepAliveAudioRef}
        src={SILENT_AUDIO_SRC}
        loop
        preload="auto"
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        style={{ position: 'absolute', left: '-9998px', width: '1px', height: '1px', opacity: 0 }}
      />
    </>
  );

  if (!currentTrack) return <>{audioElements}</>;

  const toggleLoop = () => {
     if (loopMode === 'off') setLoopMode('all');
     else if (loopMode === 'all') setLoopMode('one');
     else setLoopMode('off');
  };

  const handlePlayerReady = (e: any) => {
      playerRef.current = e.target;

      // On iOS, iframe is ALWAYS visual-only — mute regardless of viewport
      if (isIOS) {
        try { e.target?.mute?.(); e.target?.setVolume?.(0); } catch(_) {}
        pushDebug({ event: 'player-ready', reason: 'ios-visual-only-muted', playbackMode: 'native', trackId: currentTrack?.videoId, isIOSAudioPlatform: true });
      } else if (useIframeFallback) {
        // Iframe fallback mode — don't mute, let it play audio (desktop only)
        try { e.target?.unMute?.(); e.target?.setVolume?.(100); } catch(_) {}
        pushDebug({ event: 'player-ready', reason: 'iframe-fallback-unmuted', playbackMode: 'iframe-fallback', trackId: currentTrack?.videoId, isIOSAudioPlatform: isIOS });
        // If we want to play and the iframe is now ready, start playback
        if (desiredPlayingRef.current) {
          e.target?.playVideo?.();
          setIsPlaying(true);
          isSwitchingTrackRef.current = false;
          clearRetryPlayTimeout();
        }
      } else {
        // Mute iframe — audio comes from native audio element
        try { e.target?.mute?.(); e.target?.setVolume?.(0); } catch(_) {}
        pushDebug({ event: 'player-ready', reason: 'visual-only-muted', playbackMode: 'native', trackId: currentTrack?.videoId });
      }
      if (!useIframeFallback && (audioRef.current?.currentTime || currentTime) > 0) {
          e.target?.seekTo?.(audioRef.current?.currentTime || currentTime, true);
      }
      if (!useIframeFallback && desiredPlayingRef.current && audioRef.current?.paused && audioRef.current?.src) {
          void safePlayerCall('playVideo').then((started) => {
              if (!started) retryPlayForCurrentTrack();
          });
      } else if (!useIframeFallback && desiredPlayingRef.current && !audioRef.current?.paused) {
          e.target?.playVideo?.();
      } else if (!useIframeFallback) {
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
      {audioElements}
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

        <footer className="player-footer-clickable h-[64px] md:h-[72px] px-2 flex py-1 flex-shrink-0 items-center justify-between w-full cursor-default overflow-hidden hover:bg-white/5 transition-colors rounded-[24px]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div 
              key={currentTrack.videoId}
              initial={{ opacity: 0, x: 20, filter: "blur(8px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -20, filter: "blur(8px)" }}
              transition={{ duration: 0.6, type: "spring", stiffness: 80, damping: 20 }}
              className={`flex items-center flex-1 md:w-[30%] md:flex-none md:min-w-[180px] overflow-hidden drop-shadow-md ${isMobile ? 'cursor-pointer' : ''}`}
              onClick={expandMobilePlayer}
              onKeyDown={(e) => {
                if (!isMobile) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  expandMobilePlayer();
                }
              }}
              role={isMobile ? 'button' : undefined}
              tabIndex={isMobile ? 0 : undefined}
              aria-label={isMobile ? 'Apri player completo' : undefined}
            >
              <div className="w-11 h-11 md:w-14 md:h-14 bg-black/40 rounded-[12px] md:rounded-[16px] overflow-hidden flex-shrink-0 mr-3 border border-white/10 shadow-lg relative ml-1">
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10 pointer-events-none" />
                <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover relative z-0" />
              </div>
              <div className="overflow-hidden flex flex-col justify-center">
                <h4 className="text-[13px] md:text-[14px] font-bold truncate text-white leading-tight mb-1">{currentTrack.title}</h4>
                <p className="text-[11px] md:text-[12px] font-medium text-blue-300/70 truncate leading-tight">{currentTrack.channelTitle}</p>
              </div>
              <Maximize2 className="w-4 h-4 text-white/35 ml-2 flex-shrink-0 md:hidden" />
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
