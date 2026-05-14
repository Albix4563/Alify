"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { usePlayerStore, Track, AudioQuality } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  addDoc,
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/firestore-error";
import {
  Search,
  Play,
  Heart,
  Plus,
  Share2,
  MoreVertical,
  Loader2,
  ListMusic,
  Library,
  LayoutGrid,
  List,
  Trash2,
  History,
  Download,
  X,
  ArrowUpDown,
  Sparkles,
  Users
} from "lucide-react";
import { motion, useAnimation, PanInfo, AnimatePresence } from "motion/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ProfileView } from "./ProfileView";
import { ImportView } from "./ImportView";
import { TrendingGenres } from "./TrendingGenres";
import { ChangelogView } from "./ChangelogView";

export function MainContent({
  currentView,
  currentPlaylist,
  setCurrentView,
  createPlaylistDialog,
  setCreatePlaylistDialog,
  setCurrentPlaylist,
}: any) {
  const { user } = useAuth();
  const { setCurrentTrack, setQueue, setAudioQuality } = usePlayerStore();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Buongiorno";
    if (hour >= 12 && hour < 18) return "Buon pomeriggio";
    if (hour >= 18 && hour < 22) return "Buonasera";
    return "Buonanotte";
  };

  const greeting = getGreeting();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [playlistFilter, setPlaylistFilter] = useState("");
  const [playlistSortMode, setPlaylistSortMode] = useState<"recent" | "title">(
    "recent",
  );

  useEffect(() => {
    const savedSearches = localStorage.getItem("albify_recent_searches");
    if (savedSearches) {
      try {
        setRecentSearches(JSON.parse(savedSearches));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  useEffect(() => {
    const focusSearch = () => {
      setCurrentView("search");
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    };

    const handleGlobalSearchShortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingInField =
        !!target?.closest("input, textarea, [contenteditable='true']");

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (
        event.key === "/" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isTypingInField
      ) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (
        event.key === "Escape" &&
        currentView === "search" &&
        searchInputRef.current === document.activeElement &&
        searchQuery
      ) {
        setSearchQuery("");
        setSearchResults([]);
      }
    };

    window.addEventListener("keydown", handleGlobalSearchShortcuts);
    return () => {
      window.removeEventListener("keydown", handleGlobalSearchShortcuts);
    };
  }, [currentView, searchQuery, setCurrentView]);

  const [favorites, setFavorites] = useState<any[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<any[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);

  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [playlistLayout, setPlaylistLayout] = useState<"list" | "grid">("list");
  const [swipeActionTrack, setSwipeActionTrack] = useState<any | null>(null);
  const [shareDialogPlaylist, setShareDialogPlaylist] = useState<any | null>(
    null,
  );
  const [isCollabToggle, setIsCollabToggle] = useState(false);
  const [smartPrompt, setSmartPrompt] = useState("");
  const [generatingSmart, setGeneratingSmart] = useState(false);
  const [playlistToDelete, setPlaylistToDelete] = useState<any | null>(null);

  const visiblePlaylistTracks = useMemo(() => {
    const filter = playlistFilter.trim().toLowerCase();

    const filtered = playlistTracks.filter((track) => {
      if (!filter) return true;
      const title = (track.title || track.snippet?.title || "").toLowerCase();
      const channel = (
        track.channelTitle ||
        track.snippet?.channelTitle ||
        ""
      ).toLowerCase();
      return title.includes(filter) || channel.includes(filter);
    });

    if (playlistSortMode === "title") {
      return [...filtered].sort((a, b) => {
        const titleA = a.title || a.snippet?.title || "";
        const titleB = b.title || b.snippet?.title || "";
        return titleA.localeCompare(titleB, "it", { sensitivity: "base" });
      });
    }

    return filtered;
  }, [playlistFilter, playlistSortMode, playlistTracks]);

  useEffect(() => {
    if (!user) return;
    const qFav = query(collection(db, "users", user.uid, "favorites"));
    const unsubFav = onSnapshot(
      qFav,
      (snap) => {
        const favs: any[] = [];
        snap.forEach((d) => favs.push({ ...d.data() }));
        setFavorites(favs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "favorites"),
    );

    const qPl1 = query(
      collection(db, "playlists"),
      where("ownerId", "==", user.uid)
    );
    const qPl2 = query(
      collection(db, "playlists"),
      where("collaborators", "array-contains", user.uid)
    );

    let lists1: any[] = [];
    let lists2: any[] = [];
    const updatePlaylistsList = () => {
      const merged = [...lists1, ...lists2];
      const unique = merged.filter((item, i, ar) => ar.findIndex(x => x.id === item.id) === i);
      setUserPlaylists(unique);
    };

    const unsubPl1 = onSnapshot(
      qPl1,
      (snap) => {
        lists1 = [];
        snap.forEach((d) => lists1.push({ id: d.id, ...d.data() }));
        updatePlaylistsList();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "playlists"),
    );

    const unsubPl2 = onSnapshot(
      qPl2,
      (snap) => {
        lists2 = [];
        snap.forEach((d) => lists2.push({ id: d.id, ...d.data() }));
        updatePlaylistsList();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "playlists"),
    );

    const qHist = query(collection(db, "users", user.uid, "history"));
    const unsubHist = onSnapshot(
      qHist,
      (snap) => {
        const hist: any[] = [];
        snap.forEach((d) => hist.push(d.data()));
        hist.sort(
          (a, b) =>
            (b.playedAt?.toMillis() || 0) - (a.playedAt?.toMillis() || 0),
        );
        setHistory(hist.map((h) => h.track));
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.LIST,
          `users/${user.uid}/history`,
        ),
    );

    const docRef = doc(db, "users", user.uid);
    const unsubProfile = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.audioQuality) {
          setAudioQuality(data.audioQuality as AudioQuality);
        }
      }
    });

    return () => {
      unsubFav();
      unsubPl1();
      unsubPl2();
      unsubHist();
      unsubProfile();
    };
  }, [user, setAudioQuality]);

  useEffect(() => {
    if (!user || currentView !== "playlist" || !currentPlaylist) return;
    const q = query(collection(db, "playlists", currentPlaylist.id, "tracks"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const trks: any[] = [];
        snap.forEach((d) => trks.push({ ...d.data() }));
        setPlaylistTracks(trks);
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.LIST,
          `playlists/${currentPlaylist.id}/tracks`,
        ),
    );
    return () => unsub();
  }, [user, currentView, currentPlaylist]);

  useEffect(() => {
    setPlaylistFilter("");
    setPlaylistSortMode("recent");
  }, [currentPlaylist?.id]);

  const clearSearchState = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleSearch = async (queryToSearch: string = searchQuery) => {
    if (!queryToSearch.trim()) return;
    setSearching(true);
    setCurrentView("search");
    if (queryToSearch !== searchQuery) {
      setSearchQuery(queryToSearch);
    }

    const newRecent = [
      queryToSearch,
      ...recentSearches.filter((q) => q !== queryToSearch),
    ].slice(0, 5);
    setRecentSearches(newRecent);
    localStorage.setItem("albify_recent_searches", JSON.stringify(newRecent));

    try {
      const res = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(queryToSearch)}`,
      );
      if (!res.ok) {
         let errorMsg = "Errore durante la ricerca.";
         try {
             const text = await res.text();
             try {
                 const data = JSON.parse(text);
                 errorMsg = data.error || errorMsg;
             } catch(e) {
                 console.error(`Received non-JSON response (status ${res.status}):`, text.slice(0, 200));
             }
         } catch(e) {
             console.error("Failed to read response as text.");
         }
         toast.error(errorMsg);
         setSearching(false);
         return;
      }
      
      let data;
      try {
          const text = await res.text();
          data = JSON.parse(text);
      } catch (err) {
          toast.error("Errore: la risposta del server non è valida.");
          setSearching(false);
          return;
      }
      setSearchResults(data.items || []);
    } catch (error) {
      console.error(error);
      toast.error("Errore di connessione.");
    } finally {
      setSearching(false);
    }
  };

  const toggleFavorite = async (track: Track) => {
    if (!user) return;
    const safeTrack = {
      videoId: String(track.videoId || "").slice(0, 100),
      title: String(track.title || "").slice(0, 200),
      channelTitle: String(track.channelTitle || "").slice(0, 200),
      thumbnailUrl: String(track.thumbnailUrl || "").slice(0, 1000),
    };
    try {
      const favRef = doc(db, "users", user.uid, "favorites", safeTrack.videoId);
      if (favorites.some((f) => f.videoId === safeTrack.videoId))
        await deleteDoc(favRef);
      else await setDoc(favRef, { ...safeTrack, addedAt: serverTimestamp() });
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.WRITE,
        `users/${user.uid}/favorites/${safeTrack.videoId}`,
      );
    }
  };

  const addPlaylist = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !newPlaylistTitle.trim()) return;
    try {
      const isPublic = isCollabToggle ? true : false;
      const ref = await addDoc(collection(db, "playlists"), {
        ownerId: user.uid,
        title: newPlaylistTitle,
        description: "",
        isPublic,
        isCollaborative: isCollabToggle,
        collaborators: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCreatePlaylistDialog(false);
      setNewPlaylistTitle("");
      setIsCollabToggle(false);
      return ref.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, "playlists");
    }
  };

  const generateSmartPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smartPrompt.trim() || generatingSmart || !user) return;
    setGeneratingSmart(true);

    try {
      const res = await fetch("/api/youtube/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: smartPrompt })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore nella generazione");

      const playlistId = await addPlaylist();
      if (!playlistId) throw new Error("Errore durante la creazione della playlist base");

      for (const track of data.tracks) {
         await addToPlaylist(track, playlistId);
      }

      toast.success("Playlist generata con successo!");
      setCreatePlaylistDialog(false);
      setNewPlaylistTitle("");
      setSmartPrompt("");
    } catch(e: any) {
      console.error(e);
      toast.error(e.message || "Errore sconosciuto");
    } finally {
      setGeneratingSmart(false);
    }
  };

  const addToPlaylist = async (track: Track, playlistId: string) => {
    const safeTrack = {
      videoId: String(track.videoId || "").slice(0, 100),
      title: String(track.title || "").slice(0, 200),
      channelTitle: String(track.channelTitle || "").slice(0, 200),
      thumbnailUrl: String(track.thumbnailUrl || "").slice(0, 1000),
    };
    try {
      await setDoc(doc(db, "playlists", playlistId, "tracks", safeTrack.videoId), {
        ...safeTrack,
        addedAt: serverTimestamp(),
      });
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.WRITE,
        `playlists/${playlistId}/tracks/${safeTrack.videoId}`,
      );
    }
  };

  const removeFromPlaylist = async (trackId: string, playlistId: string) => {
    try {
      await deleteDoc(doc(db, "playlists", playlistId, "tracks", trackId));
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.DELETE,
        `playlists/${playlistId}/tracks/${trackId}`,
      );
    }
  };

  const handleDeletePlaylist = async () => {
    if (!user || !playlistToDelete) return;
    try {
      await deleteDoc(doc(db, "playlists", playlistToDelete.id));
      toast.success("Playlist eliminata");
      if (currentPlaylist?.id === playlistToDelete.id) {
        setCurrentPlaylist(null);
        setCurrentView("library");
      }
      setPlaylistToDelete(null);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `playlists/${playlistToDelete.id}`,
      );
      toast.error("Errore durante l'eliminazione");
    }
  };

  const sharePlaylist = async () => {
    if (!shareDialogPlaylist) return;
    try {
      await setDoc(doc(db, "playlists", shareDialogPlaylist.id), {
        ...shareDialogPlaylist,
        isPublic: true,
        updatedAt: serverTimestamp(),
      });
      const url = `${window.location.origin}/share/${shareDialogPlaylist.id}`;
      navigator.clipboard.writeText(url);
      toast.success("Link copiato negli appunti");
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.UPDATE,
        `playlists/${shareDialogPlaylist.id}`,
      );
    }
  };

  const shufflePlaylist = (tracksToShuffle: any[] = playlistTracks) => {
    if (!tracksToShuffle.length) return;
    const shuffled = [...tracksToShuffle].sort(() => Math.random() - 0.5);
    setCurrentTrack(shuffled[0]);
    setQueue(shuffled.slice(1));
  };

  const removeHistoryTrack = async (videoId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "history", videoId));
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.DELETE,
        `users/${user.uid}/history`,
      );
    }
  };

  const clearHistory = async () => {
    if (!user) return;
    try {
      const promises = history.map((h) =>
        deleteDoc(doc(db, "users", user.uid, "history", h.videoId)),
      );
      await Promise.all(promises);
    } catch (e) {
      handleFirestoreError(
        e,
        OperationType.DELETE,
        `users/${user.uid}/history`,
      );
    }
  };

  const SwipeableTrackRow = ({
    trk,
    idx,
    tracks,
    isHistory,
    contextPlaylistId,
    isFav,
  }: any) => {
    const controls = useAnimation();
    const [isSwiping, setIsSwiping] = useState(false);
    const [lastTap, setLastTap] = useState(0);
    const swipeThreshold = 80;

    const handleDragEnd = async (event: any, info: PanInfo) => {
      setIsSwiping(false);
      const x = info.offset.x;

      if (contextPlaylistId || isHistory) {
        if (x < -swipeThreshold) {
          controls.start({ x: -window.innerWidth, opacity: 0 });
          setTimeout(() => {
            if (isHistory) {
              removeHistoryTrack(trk.videoId);
            } else if (contextPlaylistId) {
              removeFromPlaylist(trk.videoId, contextPlaylistId);
            }
          }, 200);
          return;
        }
      }
      if (x > swipeThreshold) {
        controls.start({ x: 0 });
        setSwipeActionTrack(trk);
        return;
      }
      controls.start({ x: 0 });
    };

    const handleInteraction = (e: any) => {
      if (isSwiping) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        toggleFavorite(trk);
        toast.success(
          isFav ? "Rimosso dai Preferiti" : "Aggiunto ai Preferiti",
        );
      } else {
        setCurrentTrack(trk);
        setQueue(
          tracks.slice(idx + 1).map((x: any) => ({
            videoId: x.videoId || x.id?.videoId,
            title: x.title || x.snippet?.title,
            channelTitle: x.channelTitle || x.snippet?.channelTitle,
            thumbnailUrl: x.thumbnailUrl || x.snippet?.thumbnails?.high?.url,
          })),
        );
      }
      setLastTap(now);
    };

    const canDelete = isHistory || contextPlaylistId;

    return (
      <div
        className="relative group rounded-md overflow-hidden bg-white/5 my-1"
        onTouchStart={() => setIsSwiping(true)}
        onTouchEnd={() => setTimeout(() => setIsSwiping(false), 100)}
      >
        <div className="absolute inset-0 flex justify-between items-center px-4">
          <div className="text-green-400/90 font-bold text-sm tracking-widest uppercase flex items-center">
            <Plus className="w-5 h-5 mr-1" /> Aggiungi
          </div>
          {canDelete && (
            <div className="text-red-400/90 font-bold text-sm tracking-widest uppercase flex items-center">
              Elimina <Trash2 className="w-5 h-5 ml-1" />
            </div>
          )}
        </div>
        <motion.div
          drag="x"
          dragConstraints={{ left: canDelete ? -100 : 0, right: 100 }}
          dragElastic={0.5}
          onDragStart={() => setIsSwiping(true)}
          onDragEnd={handleDragEnd}
          animate={controls}
          whileTap={{ cursor: "grabbing" }}
          className={`flex items-center p-2 bg-[#09090b] hover:bg-[#18181b] transition-colors cursor-pointer border-l-2 border-transparent hover:border-blue-400 relative z-10 w-full rounded-md md:!transform-none md:!cursor-default`}
          onClick={handleInteraction}
        >
          <div
            className={`w-10 h-10 shrink-0 relative overflow-hidden rounded bg-black/40 shadow-md border border-white/10 pointer-events-none md:pointer-events-auto`}
            onClick={handleInteraction}
          >
            <img
              src={trk.thumbnailUrl}
              alt={trk.title}
              className="w-full h-full object-cover relative z-0"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Play
                className="w-5 h-5 text-white drop-shadow-md"
                fill="white"
              />
            </div>
          </div>
          <div
            className="ml-3 flex-1 min-w-0 pointer-events-none md:pointer-events-auto"
            onClick={(e) => {
              if (isSwiping) return;
              setCurrentTrack(trk);
              setQueue(
                tracks.slice(idx + 1).map((x: any) => ({
                  videoId: x.videoId || x.id?.videoId,
                  title: x.title || x.snippet?.title,
                  channelTitle: x.channelTitle || x.snippet?.channelTitle,
                  thumbnailUrl:
                    x.thumbnailUrl || x.snippet?.thumbnails?.high?.url,
                })),
              );
            }}
          >
            <div
              className={`truncate font-semibold text-[13px] text-white/90 group-hover:text-white mb-0.5`}
              title={trk.title}
            >
              {trk.title}
            </div>
            <div
              className={`truncate text-[11px] text-blue-200/50 group-hover:text-blue-200/70`}
              title={trk.channelTitle}
            >
              {trk.channelTitle}
            </div>
          </div>
          <div className="flex items-center space-x-1 pr-2 shrink-0 md:opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="text-blue-200/60 hover:text-white p-1.5 transition-colors focus:outline-none"
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(trk);
              }}
            >
              <Heart
                className="w-4 h-4"
                fill={isFav ? "white" : "none"}
                color={isFav ? "white" : "currentColor"}
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="text-blue-200/60 hover:text-white p-1.5 transition-colors focus:outline-none"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 bg-black/80 backdrop-blur-xl border-white/20 text-white shadow-xl"
              >
                <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-300/50">
                  Aggiungi alla playlist
                </div>
                {userPlaylists.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      addToPlaylist(trk, p.id);
                    }}
                    className="focus:bg-white/10 focus:text-white cursor-pointer transition-colors"
                  >
                    {p.title}
                  </DropdownMenuItem>
                ))}
                {contextPlaylistId && (
                  <>
                    <div className="h-px bg-white/10 my-1" />
                    <DropdownMenuItem
                      className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromPlaylist(trk.videoId, contextPlaylistId);
                      }}
                    >
                      Rimuovi dalla playlist
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.div>
      </div>
    );
  };

  const TrackList = ({
    tracks,
    contextPlaylistId,
    isHistory = false,
    compact = false,
    layoutMode = "list",
  }: {
    tracks: any[];
    contextPlaylistId?: string;
    isHistory?: boolean;
    compact?: boolean;
    layoutMode?: "list" | "grid";
  }) => {
    if (layoutMode === "grid") {
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-4">
          {tracks.map((t, idx) => {
            const trk = {
              videoId: t.videoId || t.id?.videoId,
              title: t.title || t.snippet?.title || "",
              channelTitle: t.channelTitle || t.snippet?.channelTitle || "",
              thumbnailUrl:
                t.thumbnailUrl || t.snippet?.thumbnails?.high?.url || "",
            };
            if (!trk.videoId) return null;
            const isFav = favorites.some((f) => f.videoId === trk.videoId);

            return (
              <div
                key={trk.videoId}
                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg backdrop-blur-sm group relative flex flex-col"
                onClick={(e) => {
                  // Check for double click manually since onDoubleClick doesn't trigger well on touch
                  const now = Date.now();
                  const lastTap = (e.currentTarget as any)._lastTap || 0;
                  if (now - lastTap < 300) {
                    toggleFavorite(trk);
                    toast.success(
                      isFav ? "Rimosso dai Preferiti" : "Aggiunto ai Preferiti",
                    );
                  } else {
                    setCurrentTrack(trk);
                    setQueue(
                      tracks.slice(idx + 1).map((x: any) => ({
                        videoId: x.videoId || x.id?.videoId,
                        title: x.title || x.snippet?.title,
                        channelTitle: x.channelTitle || x.snippet?.channelTitle,
                        thumbnailUrl:
                          x.thumbnailUrl || x.snippet?.thumbnails?.high?.url,
                      })),
                    );
                  }
                  (e.currentTarget as any)._lastTap = now;
                }}
              >
                <div className="w-full aspect-square bg-black/40 rounded-lg mb-3 overflow-hidden shadow-inner relative flex-shrink-0">
                  <img
                    src={trk.thumbnailUrl}
                    alt={trk.title}
                    className="w-full h-full object-cover relative z-0"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <Play
                      className="w-8 h-8 text-white drop-shadow-md"
                      fill="white"
                    />
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="bg-black/60 p-1.5 rounded-full text-blue-200/60 hover:text-white transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(trk);
                      }}
                    >
                      <Heart
                        className="w-4 h-4"
                        fill={isFav ? "white" : "none"}
                        color={isFav ? "white" : "currentColor"}
                      />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="bg-black/60 p-1.5 rounded-full text-blue-200/60 hover:text-white transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-48 bg-black/80 backdrop-blur-xl border-white/20 text-white shadow-xl"
                      >
                        <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-300/50">
                          Aggiungi alla playlist
                        </div>
                        {userPlaylists.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              addToPlaylist(trk, p.id);
                            }}
                            className="focus:bg-white/10 focus:text-white cursor-pointer transition-colors"
                          >
                            {p.title}
                          </DropdownMenuItem>
                        ))}
                        {contextPlaylistId && (
                          <>
                            <div className="h-px bg-white/10 my-1" />
                            <DropdownMenuItem
                              className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromPlaylist(
                                  trk.videoId,
                                  contextPlaylistId,
                                );
                              }}
                            >
                              Rimuovi dalla playlist
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden" title={trk.title}>
                  <h3 className="font-bold text-white text-sm truncate mb-0.5">
                    {trk.title}
                  </h3>
                  <p
                    className="text-xs text-blue-200/60 truncate"
                    title={trk.channelTitle}
                  >
                    {trk.channelTitle}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className={`space-y-1 mt-4`}>
        {tracks.map((t, idx) => {
          const trk = {
            videoId: t.videoId || t.id?.videoId,
            title: t.title || t.snippet?.title || "",
            channelTitle: t.channelTitle || t.snippet?.channelTitle || "",
            thumbnailUrl:
              t.thumbnailUrl || t.snippet?.thumbnails?.high?.url || "",
          };
          if (!trk.videoId) return null;
          const isFav = favorites.some((f) => f.videoId === trk.videoId);

          return (
            <SwipeableTrackRow
              key={trk.videoId}
              trk={trk}
              idx={idx}
              tracks={tracks}
              isHistory={isHistory}
              contextPlaylistId={contextPlaylistId}
              isFav={isFav}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 pb-32">
      <div className="mb-2 py-2" />

      <Dialog
        open={createPlaylistDialog}
        onOpenChange={setCreatePlaylistDialog}
      >
        <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl p-0 overflow-hidden">
          <div className="p-6">
            <DialogHeader>
              <DialogTitle className="text-blue-50 text-xl font-bold mb-4">Nuova Playlist</DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="manual" className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-6 bg-white/5 border border-white/10 p-1 rounded-xl">
                <TabsTrigger value="manual" className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white">Manuale</TabsTrigger>
                <TabsTrigger value="smart" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-500 data-[state=active]:text-white">Smart (AI)</TabsTrigger>
              </TabsList>
              
              <TabsContent value="manual" className="mt-0 outline-none">
                <form onSubmit={addPlaylist} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-blue-200/50">Nome Playlist</label>
                    <input
                      value={newPlaylistTitle}
                      onChange={(e) => setNewPlaylistTitle(e.target.value)}
                      placeholder="La mia fantastica playlist..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-blue-400 text-white placeholder-blue-200/20 transition-all font-medium"
                    />
                  </div>
                  
                  <div className="flex items-center gap-3 py-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isCollabToggle}
                      onClick={() => setIsCollabToggle(!isCollabToggle)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${isCollabToggle ? 'bg-sky-500' : 'bg-white/10'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isCollabToggle ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-300" />
                        Playlist Collaborativa
                      </div>
                      <p className="text-xs text-blue-200/50">Chiunque abbia il link può aggiungere brani.</p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!newPlaylistTitle.trim()}
                    className="w-full mt-4 bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold rounded-xl py-3 hover:shadow-[0_0_15px_rgba(56,189,248,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Crea Playlist
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="smart" className="mt-0 outline-none">
                <form onSubmit={generateSmartPlaylist} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-purple-300/50 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Chiedi all&apos;AI
                    </label>
                    <textarea
                      value={smartPrompt}
                      onChange={(e) => setSmartPrompt(e.target.value)}
                      placeholder="Una playlist perfetta per un viaggio on the road in estate..."
                      className="w-full h-24 resize-none bg-white/5 border border-purple-500/30 rounded-xl py-3 px-4 focus:outline-none focus:border-purple-400 text-white placeholder-purple-200/20 transition-all font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-blue-200/50">Nome Playlist</label>
                    <input
                      value={newPlaylistTitle}
                      onChange={(e) => setNewPlaylistTitle(e.target.value)}
                      placeholder="Estate 2024..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-blue-400 text-white placeholder-blue-200/20 transition-all font-medium"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!smartPrompt.trim() || !newPlaylistTitle.trim() || generatingSmart}
                    className="w-full mt-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold rounded-xl py-3 hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {generatingSmart ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" /> Creazione in corso...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" /> Genera Playlist Magica
                      </>
                    )}
                  </button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!swipeActionTrack}
        onOpenChange={(open) => {
          if (!open) setSwipeActionTrack(null);
        }}
      >
        <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-blue-50">
              Aggiungi a playlist
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-4 max-h-[60vh] overflow-y-auto">
            {userPlaylists.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (swipeActionTrack) addToPlaylist(swipeActionTrack, p.id);
                  setSwipeActionTrack(null);
                }}
                className="w-full text-left bg-white/5 hover:bg-white/10 px-4 py-3 rounded-md transition-colors border border-transparent hover:border-white/10 flex items-center justify-between"
              >
                <span className="font-medium text-white/90">{p.title}</span>
                <Plus className="w-4 h-4 text-blue-200/60" />
              </button>
            ))}
            {userPlaylists.length === 0 && (
              <p className="text-sm text-blue-200/60 p-4 text-center">
                Nessuna playlist trovata.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!shareDialogPlaylist}
        onOpenChange={(open) => {
          if (!open) setShareDialogPlaylist(null);
        }}
      >
        <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-blue-50">
              Condividi Playlist
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <p className="text-sm text-blue-100/70">
              Copia il link per condividere la playlist con i tuoi amici.
              Attivando la condivisione diventerà pubblica.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareDialogPlaylist?.id}`}
                className="flex-1 bg-white/5 border border-white/10 rounded py-2 px-3 text-sm text-white/50 cursor-text select-all"
                onClick={(e) => e.currentTarget.select()}
              />
              <button
                onClick={sharePlaylist}
                className="bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold rounded px-4 py-2 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] transition-all"
              >
                Copia
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!playlistToDelete}
        onOpenChange={(open) => {
          if (!open) setPlaylistToDelete(null);
        }}
      >
        <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-blue-50">Elimina Playlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4 text-center pb-2">
            <p className="text-sm text-blue-100/70 mb-4">
              Sei sicuro di voler eliminare la playlist &quot;{playlistToDelete?.title}&quot;? Questa azione non è reversibile.
            </p>
            <div className="flex justify-center gap-3">
              <button
                className="bg-white/10 hover:bg-white/20 border border-white/10 text-white font-bold rounded-full px-6 py-2 transition-all text-sm"
                onClick={() => setPlaylistToDelete(null)}
              >
                Annulla
              </button>
              <button
                className="bg-red-500/80 hover:bg-red-500 text-white font-bold rounded-full px-6 py-2 shadow-lg transition-all text-sm"
                onClick={handleDeletePlaylist}
              >
                Elimina
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          initial={{ opacity: 0, y: 15, filter: "blur(12px)", scale: 0.98 }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
          exit={{ opacity: 0, y: -15, filter: "blur(12px)", scale: 0.98 }}
          transition={{ duration: 0.7, type: "spring", stiffness: 80, damping: 20, mass: 1 }}
          className="w-full relative z-0"
        >
          {currentView === "profile" && <ProfileView setCurrentView={setCurrentView} />}
          {currentView === "changelog" && <ChangelogView />}
          <ImportView currentView={currentView} userPlaylists={userPlaylists} setCurrentView={setCurrentView} />

          {currentView === "home" && (
            <>
              <section className="mb-4 relative z-0 flex flex-col pt-0">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-32 h-32 relative drop-shadow-2xl flex-shrink-0">
                    <img
                      src="/assets/logo.png"
                      alt="Logo"
                      className="w-full h-full object-contain brightness-110"
                    />
                  </div>
                  <h2 className="text-[28px] font-bold tracking-tight text-white drop-shadow-md">
                    {greeting}
                    {user?.displayName
                      ? `, ${user.displayName.split(" ")[0]}`
                      : ""}
                  </h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-y-4 gap-x-6">
                  <div
                    className="flex items-center bg-white/5 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden hover:bg-white/10 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all cursor-pointer group h-14 xl:h-16"
                    onClick={() => setCurrentView("library")}
                  >
                    <div className="w-14 xl:w-16 h-full bg-gradient-to-br from-blue-500 to-sky-400 flex items-center justify-center flex-shrink-0 shadow-lg group-hover:shadow-[0_0_20px_rgba(52,211,153,0.5)] transition-shadow relative">
                      <div className="absolute inset-0 border-r border-white/20"></div>
                      <Library
                        className="w-6 h-6 xl:w-7 xl:h-7 text-white drop-shadow-md relative z-10"
                        fill="currentColor"
                      />
                    </div>
                    <span className="ml-4 font-bold text-[13px] xl:text-[14px] text-white drop-shadow-sm">
                      La Tua Libreria
                    </span>
                  </div>
                </div>
              </section>

              <TrendingGenres
                onPlay={(trk, q) => {
                  setCurrentTrack(trk);
                  setQueue(q);
                }}
                toggleFavorite={toggleFavorite}
                favorites={favorites}
                userPlaylists={userPlaylists}
                addToPlaylist={addToPlaylist}
              />

              {history.length > 0 && (
                <section className="relative z-0 mt-8 pb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md">
                      Ascoltati di recente
                    </h2>
                    <button
                      onClick={clearHistory}
                      className="text-xs uppercase tracking-widest font-bold text-blue-200/50 hover:text-white transition-colors"
                    >
                      Cancella Tutto
                    </button>
                  </div>
                  <TrackList tracks={history} isHistory={true} compact={true} />
                </section>
              )}

              <div className="pb-12" />
            </>
          )}

          {currentView === "search" && (
            <section className="relative z-0 min-h-[70vh] flex flex-col pt-2 px-4 md:px-8 max-w-7xl mx-auto w-full">
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 280, damping: 30 }}
                className={`w-full flex flex-col mx-auto transition-all ${searchResults.length === 0 && !searching && !searchQuery ? "mt-[20vh] max-w-3xl items-center duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]" : "mt-0 max-w-4xl duration-500 gap-0"}`}
              >
                <AnimatePresence mode="popLayout">
                  {searchResults.length === 0 && !searching && !searchQuery && (
                    <motion.h1
                      key="search-h1"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20, filter: "blur(10px)" }}
                      className="text-4xl md:text-5xl font-extrabold mb-8 text-white tracking-tight drop-shadow-md text-center"
                    >
                      Cosa vuoi ascoltare?
                    </motion.h1>
                  )}
                </AnimatePresence>

                <motion.div
                  layout
                  className="relative w-full z-20 flex flex-col shadow-2xl rounded-[30px]"
                >
                  <div
                    className={`relative w-full transition-all bg-[#121215]/80 backdrop-blur-3xl border border-white/10 ${(recentSearches.length > 0 && !searchQuery && !searching && searchResults.length === 0) || searchResults.length > 0 || searching ? "rounded-t-[30px] rounded-b-none border-b-0" : "rounded-[30px]"} ${searchQuery ? "shadow-[0_0_40px_rgba(56,189,248,0.1)] border-sky-500/30" : ""}`}
                  >
                    <span className="absolute inset-y-0 left-6 flex items-center text-blue-200/50">
                      <Search
                        className={`${searchResults.length === 0 && !searching && !searchQuery ? "w-6 h-6" : "w-5 h-5"} drop-shadow-sm transition-all`}
                      />
                    </span>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Cerca artisti, brani o URL..."
                      className={`w-full bg-transparent rounded-[30px] focus:outline-none focus:ring-0 text-white transition-all placeholder-white/30 font-medium
                                                ${searchResults.length === 0 && !searching && !searchQuery ? "py-5 h-16 pl-16 pr-16 text-xl" : "py-3 h-14 pl-14 pr-12 text-lg"}`}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                        if (e.key === "Escape") {
                          clearSearchState();
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      onClick={() => {
                        if (
                          recentSearches.length > 0 &&
                          searchResults.length === 0 &&
                          !searching &&
                          !searchQuery
                        ) {
                          /* Already showing dropdown */
                        }
                      }}
                    />
                    {searchQuery && (
                      <button
                        onClick={clearSearchState}
                        className="absolute inset-y-0 right-5 flex items-center text-white/50 hover:text-white transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  <div className="px-6 pb-2 pt-1 text-[11px] tracking-wide text-blue-200/45">
                    Scorciatoie: <span className="text-blue-100/80">/</span> o{" "}
                    <span className="text-blue-100/80">Ctrl/Cmd + K</span>
                  </div>

                  {/* Dropdown Container (Tendina) */}
                  <AnimatePresence>
                    {((recentSearches.length > 0 &&
                      !searchQuery &&
                      !searching &&
                      searchResults.length === 0) ||
                      searchResults.length > 0 ||
                      searching) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="w-full bg-[#121215]/95 backdrop-blur-3xl border border-white/10 border-t-0 rounded-b-[30px] overflow-hidden origin-top"
                      >
                        <div className="p-2">
                          {/* Recent Searches Content */}
                          {searchResults.length === 0 &&
                            !searching &&
                            !searchQuery &&
                            recentSearches.length > 0 && (
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="w-full p-4 flex flex-col"
                              >
                                <div className="flex items-center justify-between mb-4 px-2">
                                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-200/50">
                                    Ricerche Recenti
                                  </h3>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {recentSearches.map((q, i) => (
                                    <motion.button
                                      initial={{ opacity: 0, x: -10 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: i * 0.05 }}
                                      key={q}
                                      onClick={() => handleSearch(q)}
                                      className="w-full px-4 py-3 hover:bg-white/5 rounded-xl text-white text-left font-medium transition-all flex items-center justify-between group"
                                    >
                                      <div className="flex items-center gap-3">
                                        <History className="w-4 h-4 text-white/30 group-hover:text-sky-400/80 transition-colors" />
                                        {q}
                                      </div>
                                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const newRecent = recentSearches.filter((s) => s !== q);
                                            setRecentSearches(newRecent);
                                            localStorage.setItem("albify_recent_searches", JSON.stringify(newRecent));
                                          }}
                                          className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors !pointer-events-auto cursor-pointer relative z-10"
                                        >
                                          <X className="w-4 h-4 text-white/50 hover:text-white" />
                                        </button>
                                        <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
                                          <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-white/70"
                                          >
                                            <path d="M5 12h14"></path>
                                            <path d="m12 5 7 7-7 7"></path>
                                          </svg>
                                        </div>
                                      </div>
                                    </motion.button>
                                  ))}
                                </div>
                              </motion.div>
                            )}

                          {/* Search Results Content */}
                          {(searchResults.length > 0 || searching) && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="w-full p-2 pb-6 md:p-6"
                            >
                              {searching ? (
                                <div className="flex flex-col items-center justify-center py-16 opacity-50">
                                  <Loader2 className="w-10 h-10 animate-spin text-blue-400 mb-4" />
                                  <p className="text-sm font-medium text-blue-200/80">
                                    Ricerca in corso su YouTube...
                                  </p>
                                </div>
                              ) : (
                                <motion.div
                                  variants={{
                                    show: {
                                      transition: { staggerChildren: 0.05 },
                                    },
                                  }}
                                  initial="hidden"
                                  animate="show"
                                >
                                  <TrackList tracks={searchResults} />
                                </motion.div>
                              )}
                            </motion.div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            </section>
          )}

          {currentView === "library" && (
            <section className="relative z-0">
              <div className="flex items-end gap-6 mb-6 mt-0">
                <div className="w-32 h-32 md:w-48 md:h-48 bg-gradient-to-br from-blue-500 to-sky-400 shadow-[0_0_40px_rgba(52,211,153,0.3)] border border-white/20 flex items-center justify-center rounded-2xl relative overflow-hidden backdrop-blur-md">
                  <div className="absolute inset-0 bg-white/10 backdrop-blur-sm Mix-blend-overlay"></div>
                  <Library className="w-12 h-12 md:w-20 md:h-20 text-white drop-shadow-xl relative z-10" />
                </div>
                <div className="pb-2">
                  <div className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-blue-200/60 mb-2 drop-shadow-sm">
                    Account
                  </div>
                  <h1 className="text-4xl md:text-7xl font-bold tracking-tighter mb-2 md:mb-4 text-white drop-shadow-lg">
                    La Tua Libreria
                  </h1>
                  <div className="text-xs md:text-sm text-blue-200/60 font-medium drop-shadow-sm">
                    <span className="text-white">{user?.displayName}</span> •{" "}
                    {userPlaylists.length} playlist • {favorites.length} brani
                    preferiti
                  </div>
                </div>
              </div>

              <div className="mb-10">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md">
                    Le tue Playlist
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentView("import")}
                      className="flex items-center gap-2 text-xs uppercase tracking-widest font-bold text-blue-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full border border-white/10"
                    >
                      <Download className="w-4 h-4" /> Importa
                    </button>
                    <button
                      onClick={() => setCreatePlaylistDialog(true)}
                      className="flex items-center gap-2 text-xs uppercase tracking-widest font-bold text-blue-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full border border-white/10"
                    >
                      <Plus className="w-4 h-4" /> Crea
                    </button>
                  </div>
                </div>
                {userPlaylists.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {userPlaylists.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setCurrentPlaylist(p);
                          setCurrentView("playlist");
                        }}
                        className="relative bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg backdrop-blur-sm group"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlaylistToDelete(p);
                          }}
                          className="absolute top-2 right-2 p-2 rounded-full bg-black/40 text-red-400/50 hover:text-red-400 hover:bg-black/60 md:opacity-0 md:group-hover:opacity-100 transition-all z-10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="w-full aspect-square bg-white/5 rounded-lg mb-4 flex relative items-center justify-center border border-white/10 shadow-inner group-hover:bg-white/10 transition-colors">
                          <ListMusic className="w-12 h-12 text-blue-200/40 group-hover:text-blue-300/80 transition-colors" />
                          {p.isCollaborative && (
                            <div className="absolute bottom-2 left-2 bg-purple-500/80 text-white text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full font-bold shadow-md">
                              Collab
                            </div>
                          )}
                          {!p.isCollaborative && p.isPublic && (
                            <div className="absolute bottom-2 left-2 bg-blue-500/80 text-white text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full font-bold shadow-md">
                              Pubblica
                            </div>
                          )}
                        </div>
                        <h3 className="font-bold text-white text-sm truncate mb-1">
                          {p.title}
                        </h3>
                        <p className="text-xs text-blue-200/60">
                          {p.ownerId !== user?.uid ? "Condivisa con te" : "Playlist"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-blue-200/50 italic py-4">
                    Non hai ancora creato nessuna playlist.
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md">
                    Brani Piaciuti
                  </h2>
                  {favorites.length > 0 && (
                    <button
                      className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-r from-blue-600 to-sky-500 hover:opacity-90 text-white rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(52,211,153,0.3)] transition-all hover:scale-105"
                      onClick={() => {
                        if (favorites.length) {
                          setCurrentTrack(favorites[0]);
                          setQueue(favorites.slice(1));
                        }
                      }}
                    >
                      <Play
                        className="w-4 h-4 md:w-5 md:h-5 ml-1 drop-shadow-sm"
                        fill="currentColor"
                      />
                    </button>
                  )}
                </div>
                {favorites.length > 0 ? (
                  <TrackList tracks={favorites} compact={true} />
                ) : (
                  <div className="text-sm text-blue-200/50 italic py-4">
                    Nessun brano aggiunto ai preferiti.
                  </div>
                )}
              </div>
            </section>
          )}

          {currentView === "playlist" && currentPlaylist && (
            <section className="relative z-0">
              <div className="flex items-end gap-6 mb-6 mt-0">
                <div className="w-48 h-48 bg-white/5 backdrop-blur-xl shadow-2xl flex items-center justify-center rounded-2xl border border-white/20 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                  <ListMusic className="w-20 h-20 text-blue-200/50 relative z-10 drop-shadow-md" />
                </div>
                <div className="pb-2">
                  <div className="text-xs font-bold uppercase tracking-widest text-blue-200/60 mb-2 drop-shadow-sm">
                    Playlist
                  </div>
                  <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 text-white drop-shadow-lg">
                    {currentPlaylist.title}
                  </h1>
                  <div className="text-sm text-blue-200/60 font-medium drop-shadow-sm">
                    <span className="text-white">{user?.displayName}</span> •{" "}
                    {visiblePlaylistTracks.length}
                    {playlistFilter.trim() ? ` di ${playlistTracks.length}` : ""}{" "}
                    brani
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 md:gap-4 mb-6 flex-wrap">
                <button
                  className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-sky-500 to-blue-500 hover:opacity-90 text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all hover:scale-105"
                  onClick={() => {
                    if (visiblePlaylistTracks.length) {
                      setCurrentTrack(visiblePlaylistTracks[0]);
                      setQueue(visiblePlaylistTracks.slice(1));
                    }
                  }}
                >
                  <Play
                    className="w-6 h-6 md:w-7 md:h-7 ml-1 drop-shadow-sm"
                    fill="currentColor"
                  />
                </button>
                <button
                  className="flex items-center justify-center gap-2 px-4 h-12 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all text-white font-medium"
                  onClick={() => shufflePlaylist(visiblePlaylistTracks)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="16 3 21 3 21 8"></polyline>
                    <line x1="4" y1="20" x2="21" y2="3"></line>
                    <polyline points="21 16 21 21 16 21"></polyline>
                    <line x1="15" y1="15" x2="21" y2="21"></line>
                    <line x1="4" y1="4" x2="9" y2="9"></line>
                  </svg>
                  <span className="hidden md:inline">Shuffle</span>
                </button>
                <button
                  className="w-12 h-12 flex items-center justify-center text-blue-200/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md rounded-full transition-all"
                  onClick={() => setShareDialogPlaylist(currentPlaylist)}
                  title="Condividi link pubblico"
                >
                  <Share2 className="w-5 h-5 drop-shadow-sm" />
                </button>
                <button
                  className="w-12 h-12 flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-400/10 bg-white/5 border border-white/10 backdrop-blur-md rounded-full transition-all"
                  onClick={() => setPlaylistToDelete(currentPlaylist)}
                  title="Elimina Playlist"
                >
                  <Trash2 className="w-5 h-5 drop-shadow-sm" />
                </button>
                <div className="ml-auto flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-lg backdrop-blur-md">
                  <button
                    onClick={() => setPlaylistLayout("list")}
                    className={`p-2 rounded-md transition-colors ${playlistLayout === "list" ? "bg-white/20 text-white" : "text-blue-200/60 hover:text-white hover:bg-white/10"}`}
                    title="Vista a lista"
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPlaylistLayout("grid")}
                    className={`p-2 rounded-md transition-colors ${playlistLayout === "grid" ? "bg-white/20 text-white" : "text-blue-200/60 hover:text-white hover:bg-white/10"}`}
                    title="Vista a griglia"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="mb-4 flex flex-col md:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-blue-200/50 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={playlistFilter}
                    onChange={(e) => setPlaylistFilter(e.target.value)}
                    placeholder="Filtra brani nella playlist..."
                    className="w-full h-11 pl-10 pr-10 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-blue-200/35 focus:outline-none focus:border-sky-400/60 transition-colors"
                  />
                  {playlistFilter && (
                    <button
                      onClick={() => setPlaylistFilter("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-200/50 hover:text-white transition-colors"
                      title="Pulisci filtro"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() =>
                    setPlaylistSortMode((mode) =>
                      mode === "recent" ? "title" : "recent",
                    )
                  }
                  className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors"
                >
                  <ArrowUpDown className="w-4 h-4 text-blue-200/70" />
                  {playlistSortMode === "recent"
                    ? "Ordina: Recenti"
                    : "Ordina: Titolo A-Z"}
                </button>
              </div>

              {visiblePlaylistTracks.length > 0 ? (
                <TrackList
                  tracks={visiblePlaylistTracks}
                  contextPlaylistId={currentPlaylist.id}
                  layoutMode={playlistLayout}
                />
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-blue-200/60">
                  {playlistTracks.length === 0
                    ? "Questa playlist è ancora vuota."
                    : "Nessun brano trovato con il filtro corrente."}
                </div>
              )}
            </section>
          )}
      </motion.div>
      </AnimatePresence>
    </div>
  );
}
