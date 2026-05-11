import { create } from 'zustand';

export interface Track {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  loopMode: 'off' | 'all' | 'one';
  shuffleMode: boolean;
  videoExpanded: boolean;
  autoDJMode: boolean;
  setCurrentTrack: (track: Track) => void;
  addToQueue: (track: Track) => void;
  setQueue: (tracks: Track[]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setLoopMode: (mode: 'off' | 'all' | 'one') => void;
  setShuffleMode: (shuffle: boolean) => void;
  setVideoExpanded: (expanded: boolean) => void;
  setAutoDJMode: (autoDJ: boolean) => void;
  playNext: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  isPlaying: false,
  loopMode: 'off',
  shuffleMode: false,
  videoExpanded: false,
  autoDJMode: false,
  setCurrentTrack: (track) => set({ currentTrack: track, isPlaying: true }),
  addToQueue: (track) => set((state) => ({ queue: [...state.queue, track] })),
  setQueue: (tracks) => set({ queue: tracks }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setLoopMode: (mode) => set({ loopMode: mode }),
  setShuffleMode: (shuffle) => set({ shuffleMode: shuffle }),
  setVideoExpanded: (expanded) => set({ videoExpanded: expanded }),
  setAutoDJMode: (autoDJ) => set({ autoDJMode: autoDJ }),
  playNext: () => set((state) => {
    let newQueue = [...state.queue];
    
    if (newQueue.length > 0) {
      let nextTrack;
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

      return { currentTrack: nextTrack, queue: newQueue, isPlaying: true };
    }
    
    return { currentTrack: state.loopMode === 'all' ? state.currentTrack : null, isPlaying: false };
  })
}));
