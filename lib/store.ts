import { create } from 'zustand';

export interface Track {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export type AudioQuality = 'basso' | 'medio' | 'alto' | 'auto';

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  historyStack: Track[];
  isPlaying: boolean;
  playRequestId: number;
  loopMode: 'off' | 'all' | 'one';
  shuffleMode: boolean;
  videoExpanded: boolean;
  audioQuality: AudioQuality;

  setCurrentTrack: (track: Track, options?: { autoPlay?: boolean }) => void;
  addToQueue: (track: Track) => void;
  setQueue: (tracks: Track[]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  requestPlay: () => void;
  setLoopMode: (mode: 'off' | 'all' | 'one') => void;
  setShuffleMode: (shuffle: boolean) => void;
  setVideoExpanded: (expanded: boolean) => void;
  setAudioQuality: (quality: AudioQuality) => void;
  playNext: () => void;
  playPrevious: () => void;
}

const normalizeTrack = (track: Track): Track => ({
  videoId: String(track.videoId || '').slice(0, 100),
  title: String(track.title || '').slice(0, 200),
  channelTitle: String(track.channelTitle || '').slice(0, 200),
  thumbnailUrl: String(track.thumbnailUrl || '').slice(0, 1000),
});

export const usePlayerStore = create<PlayerState>((set) => ({
  currentTrack: null,
  queue: [],
  historyStack: [],
  isPlaying: false,
  playRequestId: 0,
  loopMode: 'off',
  shuffleMode: false,
  videoExpanded: false,
  audioQuality: 'auto',

  setCurrentTrack: (track, options = { autoPlay: true }) =>
    set((state) => ({
      currentTrack: normalizeTrack(track),
      historyStack: state.currentTrack
        ? [...state.historyStack.slice(-49), state.currentTrack]
        : state.historyStack,
      isPlaying: false,
      playRequestId:
        options.autoPlay === false ? state.playRequestId : state.playRequestId + 1,
    })),

  addToQueue: (track) =>
    set((state) => ({
      queue: [...state.queue, normalizeTrack(track)],
    })),

  setQueue: (tracks) =>
    set({
      queue: tracks.map(normalizeTrack),
    }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  requestPlay: () =>
    set((state) => ({
      playRequestId: state.playRequestId + 1,
    })),

  setLoopMode: (mode) => set({ loopMode: mode }),

  setShuffleMode: (shuffle) => set({ shuffleMode: shuffle }),

  setVideoExpanded: (expanded) => set({ videoExpanded: expanded }),

  setAudioQuality: (quality) => set({ audioQuality: quality }),

  playNext: () =>
    set((state) => {
      let newQueue = [...state.queue];

      if (newQueue.length > 0) {
        let nextTrack: Track;

        if (state.shuffleMode) {
          const randomIndex = Math.floor(Math.random() * newQueue.length);
          nextTrack = newQueue[randomIndex];
          newQueue.splice(randomIndex, 1);
        } else {
          nextTrack = newQueue[0];
          newQueue = newQueue.slice(1);
        }

        if (state.loopMode === 'all' && state.currentTrack) {
          newQueue.push(state.currentTrack);
        }

        const newHistory = state.currentTrack
          ? [...state.historyStack.slice(-49), state.currentTrack]
          : state.historyStack;

        return {
          currentTrack: normalizeTrack(nextTrack),
          queue: newQueue,
          historyStack: newHistory,
          isPlaying: false,
          playRequestId: state.playRequestId + 1,
        };
      }

      if (state.loopMode === 'all' && state.currentTrack) {
        return {
          currentTrack: state.currentTrack,
          isPlaying: false,
          playRequestId: state.playRequestId + 1,
        };
      }

      return {
        currentTrack: null,
        isPlaying: false,
      };
    }),

  playPrevious: () =>
    set((state) => {
      const newHistory = [...state.historyStack];
      if (newHistory.length === 0) {
        // No history — just seek to 0 on current track
        if (state.currentTrack) {
          return {
            isPlaying: false,
            playRequestId: state.playRequestId + 1,
          };
        }
        return {};
      }

      const prevTrack = newHistory.pop()!;

      // Put current track at the front of the queue
      const newQueue = state.currentTrack
        ? [state.currentTrack, ...state.queue]
        : state.queue;

      return {
        currentTrack: normalizeTrack(prevTrack),
        queue: newQueue,
        historyStack: newHistory,
        isPlaying: false,
        playRequestId: state.playRequestId + 1,
      };
    }),
}));