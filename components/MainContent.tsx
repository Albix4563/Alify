'use client';

import { useState, useEffect } from 'react';
import { usePlayerStore, Track } from '@/lib/store';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { collection, query, where, doc, setDoc, deleteDoc, serverTimestamp, onSnapshot, addDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';
import { Search, Play, Heart, Plus, Share2, MoreVertical, Loader2, ListMusic, Sparkles, Library, LayoutGrid, List, Trash2, Home } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { motion, useAnimation, PanInfo, AnimatePresence } from 'motion/react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ProfileView } from './ProfileView';
import { Menu } from 'lucide-react';

export function MainContent({ currentView, currentPlaylist, setCurrentView, createPlaylistDialog, setCreatePlaylistDialog, setCurrentPlaylist, isSidebarVisible, setIsSidebarVisible }: any) {
    const { user } = useAuth();
    const { setCurrentTrack, setQueue } = usePlayerStore();

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) return 'Buongiorno';
        if (hour >= 12 && hour < 18) return 'Buon pomeriggio';
        if (hour >= 18 && hour < 22) return 'Buonasera';
        return 'Buonanotte';
    };

    const greeting = getGreeting();

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);

    useEffect(() => {
        const savedSearches = localStorage.getItem('albify_recent_searches');
        if (savedSearches) {
            try {
                setRecentSearches(JSON.parse(savedSearches));
            } catch (e) {
                console.error(e);
            }
        }
    }, []);

    const [favorites, setFavorites] = useState<any[]>([]);
    const [playlistTracks, setPlaylistTracks] = useState<any[]>([]);
    const [userPlaylists, setUserPlaylists] = useState<any[]>([]);

    const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
    const [mixing, setMixing] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [djTracks, setDjTracks] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [suggestedTracks, setSuggestedTracks] = useState<any[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [playlistLayout, setPlaylistLayout] = useState<'list' | 'grid'>('list');
    const [swipeActionTrack, setSwipeActionTrack] = useState<any | null>(null);
    const [shareDialogPlaylist, setShareDialogPlaylist] = useState<any | null>(null);
    const [playlistDjMixing, setPlaylistDjMixing] = useState(false);

    useEffect(() => {
        if (!user) return;
        const qFav = query(collection(db, 'users', user.uid, 'favorites'));
        const unsubFav = onSnapshot(qFav, snap => {
            const favs: any[] = [];
            snap.forEach(d => favs.push({ ...d.data() }));
            setFavorites(favs);
        }, err => handleFirestoreError(err, OperationType.LIST, 'favorites'));

        const qPl = query(collection(db, 'playlists'), where('ownerId', '==', user.uid));
        const unsubPl = onSnapshot(qPl, snap => {
            const lists: any[] = [];
            snap.forEach(d => lists.push({ id: d.id, ...d.data() }));
            setUserPlaylists(lists);
        }, err => handleFirestoreError(err, OperationType.LIST, 'playlists'));

        const qHist = query(collection(db, 'users', user.uid, 'history'));
        const unsubHist = onSnapshot(qHist, snap => {
            const hist: any[] = [];
            snap.forEach(d => hist.push(d.data()));
            hist.sort((a, b) => (b.playedAt?.toMillis() || 0) - (a.playedAt?.toMillis() || 0));
            setHistory(hist.map(h => h.track));
        }, err => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/history`));

        return () => { unsubFav(); unsubPl(); unsubHist(); };
    }, [user]);

    useEffect(() => {
        if (!user || currentView !== 'playlist' || !currentPlaylist) return;
        const q = query(collection(db, 'playlists', currentPlaylist.id, 'tracks'));
        const unsub = onSnapshot(q, snap => {
            const trks: any[] = [];
            snap.forEach(d => trks.push({ ...d.data() }));
            setPlaylistTracks(trks);
        }, err => handleFirestoreError(err, OperationType.LIST, `playlists/${currentPlaylist.id}/tracks`));
        return () => unsub();
    }, [user, currentView, currentPlaylist]);

    useEffect(() => {
        const fetchSuggestions = async () => {
             if (history.length === 0 || suggestedTracks.length > 0 || loadingSuggestions) return;
             setLoadingSuggestions(true);
             try {
                 const recentTracks = history.slice(0, 3).map(t => `"${t.title}" by ${t.channelTitle}`).join(', ');
                 const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
                 const response = await ai.models.generateContent({
                     model: "gemini-2.5-flash",
                     contents: `Based on the user's recently played tracks: ${recentTracks}. Suggest 5 different YouTube search queries (artist and song name) that fit exactly in a similar musical style or genre but are not the same tracks. Take into consideration Italian music if the user listens to Italian artists. Return a JSON array of strings.`,
                     config: { responseMimeType: 'application/json', responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
                 });
                 const queries: string[] = JSON.parse(response.text || "[]");
                 const searchPromises = queries.map(async (query) => {
                     try {
                         const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
                         if (!res.ok) return null;
                         const data = await res.json();
                         return data.items && data.items.length > 0 ? data.items[0] : null;
                     } catch (err) {
                         return null;
                     }
                 });
                 let results = await Promise.all(searchPromises);
                 results = results.filter(r => r !== null);
                 if (results && results.length > 0) {
                     const tracks = results.map((r: any) => ({
                         videoId: r.id.videoId, title: r.snippet.title, channelTitle: r.snippet.channelTitle,
                         thumbnailUrl: r.snippet.thumbnails?.high?.url || r.snippet.thumbnails?.default?.url
                     }));
                     setSuggestedTracks(tracks);
                 }
             } catch (error) {
                 console.error('Error fetching suggestions:', error);
             } finally {
                 setLoadingSuggestions(false);
             }
        };
        fetchSuggestions();
    }, [history]);

    const handleSearch = async (queryToSearch: string = searchQuery) => {
        if (!queryToSearch.trim()) return;
        setSearching(true);
        setCurrentView('search');
        if (queryToSearch !== searchQuery) {
            setSearchQuery(queryToSearch);
        }
        
        const newRecent = [queryToSearch, ...recentSearches.filter(q => q !== queryToSearch)].slice(0, 5);
        setRecentSearches(newRecent);
        localStorage.setItem('albify_recent_searches', JSON.stringify(newRecent));

        try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(queryToSearch)}`);
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Errore durante la ricerca.");
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
        try {
            const favRef = doc(db, 'users', user.uid, 'favorites', track.videoId);
            if (favorites.some(f => f.videoId === track.videoId)) await deleteDoc(favRef);
            else await setDoc(favRef, { ...track, addedAt: serverTimestamp() });
        } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/favorites/${track.videoId}`);
        }
    };

    const addPlaylist = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!user || !newPlaylistTitle.trim()) return;
        try {
            await addDoc(collection(db, 'playlists'), {
                ownerId: user.uid, title: newPlaylistTitle, description: '', isPublic: false,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp()
            });
            setCreatePlaylistDialog(false);
            setNewPlaylistTitle('');
        } catch(e) {
           handleFirestoreError(e, OperationType.CREATE, 'playlists');
        }
    }

    const addToPlaylist = async (track: Track, playlistId: string) => {
        try {
            await setDoc(doc(db, 'playlists', playlistId, 'tracks', track.videoId), { ...track, addedAt: serverTimestamp() });
        } catch (e) { handleFirestoreError(e, OperationType.WRITE, `playlists/${playlistId}/tracks/${track.videoId}`); }
    };
    
    const removeFromPlaylist = async (trackId: string, playlistId: string) => {
        try { await deleteDoc(doc(db, 'playlists', playlistId, 'tracks', trackId)); } catch(e) { handleFirestoreError(e, OperationType.DELETE, `playlists/${playlistId}/tracks/${trackId}`); }
    }

    const generateDJPlaylist = async () => {
        if (!aiPrompt.trim()) return;
        setMixing(true);
        try {
             const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
             
             const response = await ai.models.generateContent({
               model: "gemini-2.5-flash",
               contents: `Generate a list of 10 YouTube search queries (just artist and song name) that fit this prompt: "${aiPrompt}". Consider the Italian musical context if relevant. Return only the track names in JSON array format.`,
               config: {
                 responseMimeType: 'application/json',
                 responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
               }
             });
             
             const suggestionsText = response.text;
             if (!suggestionsText) throw new Error("No response from Gemini");

             const queries: string[] = JSON.parse(suggestionsText);
             
             const searchPromises = queries.map(async (query) => {
                 try {
                     const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
                     if (!res.ok) return null;
                     const data = await res.json();
                     return data.items && data.items.length > 0 ? data.items[0] : null;
                 } catch (err) {
                     return null;
                 }
             });

             let results = await Promise.all(searchPromises);
             results = results.filter(r => r !== null);

             if (results && results.length > 0) {
                 const tracks = results.map((r: any) => ({
                    videoId: r.id.videoId, title: r.snippet.title, channelTitle: r.snippet.channelTitle,
                    thumbnailUrl: r.snippet.thumbnails?.high?.url || r.snippet.thumbnails?.default?.url
                 }));
                 setDjTracks(tracks);
             }
        } catch (error) { console.error('Mixer error:', error); } finally { setMixing(false); }
    }

    const sharePlaylist = async () => {
         if(!shareDialogPlaylist) return;
         try {
             await setDoc(doc(db, 'playlists', shareDialogPlaylist.id), { ...shareDialogPlaylist, isPublic: true, updatedAt: serverTimestamp() });
             const url = `${window.location.origin}/share/${shareDialogPlaylist.id}`;
             navigator.clipboard.writeText(url);
             toast.success("Link copiato negli appunti");
         } catch (e) { handleFirestoreError(e, OperationType.UPDATE, `playlists/${shareDialogPlaylist.id}`); }
    }

    const shufflePlaylist = () => {
        if (!playlistTracks.length) return;
        const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
        setCurrentTrack(shuffled[0]);
        setQueue(shuffled.slice(1));
    };

    const activatePlaylistDJ = async () => {
        if (!playlistTracks.length || playlistDjMixing) return;
        setPlaylistDjMixing(true);
        toast("Gemini DJ sta analizzando la playlist...", { icon: <Sparkles className="w-4 h-4 text-blue-400" /> });
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
            
            // Limit to max 10 tracks for analysis to save prompt tokens
            const trackTitles = playlistTracks.slice(0, 10).map(t => `${t.title} ${t.channelTitle}`).join(', ');
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Based on these songs: "${trackTitles}", recommend 5 similar songs that fit the mood/theme perfectly. Return a JSON array of strings containing just the 'artist - song name'.`,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            });
            
            const suggestionsText = response.text;
            if (!suggestionsText) throw new Error("No response from AI");

            const queries: string[] = JSON.parse(suggestionsText);
            
            const searchPromises = queries.map(async (query) => {
                try {
                    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    return data.items && data.items.length > 0 ? data.items[0] : null;
                } catch (err) {
                    return null;
                }
            });

            const results = (await Promise.all(searchPromises)).filter(r => r !== null);
            
            if (results && results.length > 0) {
                const newExternalTracks = results.map((r: any) => ({
                    videoId: r.id.videoId, title: r.snippet.title, channelTitle: r.snippet.channelTitle,
                    thumbnailUrl: r.snippet.thumbnails?.high?.url || r.snippet.thumbnails?.default?.url
                }));
                
                // Interleave external tracks into the remaining playlist evenly
                const mixedQueue = [...playlistTracks];
                let insertIdx = Math.floor(mixedQueue.length / (newExternalTracks.length + 1)) || 1;
                newExternalTracks.forEach((extTrack, i) => {
                    mixedQueue.splice(insertIdx * (i + 1), 0, extTrack);
                });
                
                setCurrentTrack(mixedQueue[0]);
                setQueue(mixedQueue.slice(1));
                toast.success("Gemini DJ ha mixato nuovi brani nella tua playlist!");
            } else {
                 toast.error("Non è stato possibile mixare brani oggi.");
            }
        } catch (error) {
            console.error('Playlist DJ error:', error);
            toast.error("Errore durante l'azione DJ.");
        } finally {
            setPlaylistDjMixing(false);
        }
    };

    const removeHistoryTrack = async (videoId: string) => {
        if (!user) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'history', videoId));
        } catch (e) {
            handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/history`);
        }
    }

    const clearHistory = async () => {
        if (!user) return;
        try {
            const promises = history.map(h => deleteDoc(doc(db, 'users', user.uid, 'history', h.videoId)));
            await Promise.all(promises);
        } catch (e) {
            handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/history`);
        }
    }

    const SwipeableTrackRow = ({ trk, idx, tracks, isHistory, contextPlaylistId, isFav }: any) => {
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
            if(isSwiping) return;
            const now = Date.now();
            if (now - lastTap < 300) {
                toggleFavorite(trk);
                toast.success(isFav ? "Rimosso dai Preferiti" : "Aggiunto ai Preferiti");
            } else {
                setCurrentTrack(trk);
                setQueue(tracks.slice(idx + 1).map((x: any) => ({
                    videoId: x.videoId || x.id?.videoId, title: x.title || x.snippet?.title,
                    channelTitle: x.channelTitle || x.snippet?.channelTitle, thumbnailUrl: x.thumbnailUrl || x.snippet?.thumbnails?.high?.url
                })));
            }
            setLastTap(now);
        };

        const canDelete = isHistory || contextPlaylistId;

        return (
            <div className="relative group rounded-md overflow-hidden bg-white/5 my-1" onTouchStart={() => setIsSwiping(true)} onTouchEnd={() => setTimeout(() => setIsSwiping(false), 100)}>
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
                    whileTap={{ cursor: 'grabbing' }}
                    className={`flex items-center p-2 bg-[#1a1c23]/90 hover:bg-[#22252e] transition-colors cursor-pointer border-l-2 border-transparent hover:border-blue-400 relative z-10 w-full rounded-md md:!transform-none md:!cursor-default`}
                    onClick={handleInteraction}
                >
                    <div className={`w-10 h-10 shrink-0 relative overflow-hidden rounded bg-black/40 shadow-md border border-white/10 pointer-events-none md:pointer-events-auto`}
                         onClick={handleInteraction}
                    >
                        <img src={trk.thumbnailUrl} alt={trk.title} className="w-full h-full object-cover relative z-0" loading="lazy" />
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Play className="w-5 h-5 text-white drop-shadow-md" fill="white" />
                        </div>
                    </div>
                    <div className="ml-3 flex-1 min-w-0 pointer-events-none md:pointer-events-auto" onClick={(e) => {
                         if(isSwiping) return;
                         setCurrentTrack(trk);
                         setQueue(tracks.slice(idx + 1).map((x: any) => ({
                              videoId: x.videoId || x.id?.videoId, title: x.title || x.snippet?.title,
                              channelTitle: x.channelTitle || x.snippet?.channelTitle, thumbnailUrl: x.thumbnailUrl || x.snippet?.thumbnails?.high?.url
                         })));
                     }}>
                        <div className={`truncate font-semibold text-[13px] text-white/90 group-hover:text-white mb-0.5`} title={trk.title}>{trk.title}</div>
                        <div className={`truncate text-[11px] text-blue-200/50 group-hover:text-blue-200/70`} title={trk.channelTitle}>{trk.channelTitle}</div>
                    </div>
                    <div className="flex items-center space-x-1 pr-2 shrink-0 md:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="text-blue-200/60 hover:text-white p-1.5 transition-colors focus:outline-none" onClick={(e) => { e.stopPropagation(); toggleFavorite(trk); }}>
                            <Heart className="w-4 h-4" fill={isFav ? "white" : "none"} color={isFav ? "white" : "currentColor"} />
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger className="text-blue-200/60 hover:text-white p-1.5 transition-colors focus:outline-none" onClick={e => e.stopPropagation()}>
                                <MoreVertical className="w-4 h-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-black/80 backdrop-blur-xl border-white/20 text-white shadow-xl">
                                <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-300/50">Aggiungi alla playlist</div>
                                {userPlaylists.map(p => (
                                    <DropdownMenuItem key={p.id} onClick={(e) => { e.stopPropagation(); addToPlaylist(trk, p.id); }} className="focus:bg-white/10 focus:text-white cursor-pointer transition-colors">
                                        {p.title}
                                    </DropdownMenuItem>
                                ))}
                                {contextPlaylistId && (
                                    <>
                                        <div className="h-px bg-white/10 my-1" />
                                        <DropdownMenuItem className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); removeFromPlaylist(trk.videoId, contextPlaylistId); }}>
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

    const TrackList = ({ tracks, contextPlaylistId, isHistory = false, compact = false, layoutMode = 'list' }: { tracks: any[], contextPlaylistId?: string, isHistory?: boolean, compact?: boolean, layoutMode?: 'list' | 'grid' }) => {
        if (layoutMode === 'grid') {
            return (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-4">
                    {tracks.map((t, idx) => {
                        const trk = {
                            videoId: t.videoId || t.id?.videoId, title: t.title || t.snippet?.title || '',
                            channelTitle: t.channelTitle || t.snippet?.channelTitle || '',
                            thumbnailUrl: t.thumbnailUrl || t.snippet?.thumbnails?.high?.url || ''
                        };
                        if (!trk.videoId) return null;
                        const isFav = favorites.some(f => f.videoId === trk.videoId);

                        return (
                            <div key={trk.videoId} className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg backdrop-blur-sm group relative flex flex-col"
                                onClick={(e) => {
                                     // Check for double click manually since onDoubleClick doesn't trigger well on touch
                                     const now = Date.now();
                                     const lastTap = (e.currentTarget as any)._lastTap || 0;
                                     if (now - lastTap < 300) {
                                         toggleFavorite(trk);
                                         toast.success(isFav ? "Rimosso dai Preferiti" : "Aggiunto ai Preferiti");
                                     } else {
                                         setCurrentTrack(trk);
                                         setQueue(tracks.slice(idx + 1).map((x: any) => ({
                                              videoId: x.videoId || x.id?.videoId, title: x.title || x.snippet?.title,
                                              channelTitle: x.channelTitle || x.snippet?.channelTitle, thumbnailUrl: x.thumbnailUrl || x.snippet?.thumbnails?.high?.url
                                         })));
                                     }
                                     (e.currentTarget as any)._lastTap = now;
                                 }}>
                                <div className="w-full aspect-square bg-black/40 rounded-lg mb-3 overflow-hidden shadow-inner relative flex-shrink-0">
                                    <img src={trk.thumbnailUrl} alt={trk.title} className="w-full h-full object-cover relative z-0" loading="lazy" />
                                    <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <Play className="w-8 h-8 text-white drop-shadow-md" fill="white" />
                                    </div>
                                    <div className="absolute top-2 right-2 flex gap-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="bg-black/60 p-1.5 rounded-full text-blue-200/60 hover:text-white transition-colors" onClick={(e) => { e.stopPropagation(); toggleFavorite(trk); }}>
                                            <Heart className="w-4 h-4" fill={isFav ? "white" : "none"} color={isFav ? "white" : "currentColor"} />
                                        </button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger className="bg-black/60 p-1.5 rounded-full text-blue-200/60 hover:text-white transition-colors" onClick={e => e.stopPropagation()}>
                                                <MoreVertical className="w-4 h-4" />
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-48 bg-black/80 backdrop-blur-xl border-white/20 text-white shadow-xl">
                                                <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-300/50">Aggiungi alla playlist</div>
                                                {userPlaylists.map(p => (
                                                    <DropdownMenuItem key={p.id} onClick={(e) => { e.stopPropagation(); addToPlaylist(trk, p.id); }} className="focus:bg-white/10 focus:text-white cursor-pointer transition-colors">
                                                        {p.title}
                                                    </DropdownMenuItem>
                                                ))}
                                                {contextPlaylistId && (
                                                    <>
                                                        <div className="h-px bg-white/10 my-1" />
                                                        <DropdownMenuItem className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); removeFromPlaylist(trk.videoId, contextPlaylistId); }}>
                                                            Rimuovi dalla playlist
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-hidden" title={trk.title}>
                                    <h3 className="font-bold text-white text-sm truncate mb-0.5">{trk.title}</h3>
                                    <p className="text-xs text-blue-200/60 truncate" title={trk.channelTitle}>{trk.channelTitle}</p>
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
                        videoId: t.videoId || t.id?.videoId, title: t.title || t.snippet?.title || '',
                        channelTitle: t.channelTitle || t.snippet?.channelTitle || '',
                        thumbnailUrl: t.thumbnailUrl || t.snippet?.thumbnails?.high?.url || ''
                    };
                    if (!trk.videoId) return null;
                    const isFav = favorites.some(f => f.videoId === trk.videoId);

                    return (
                        <SwipeableTrackRow key={trk.videoId} trk={trk} idx={idx} tracks={tracks} isHistory={isHistory} contextPlaylistId={contextPlaylistId} isFav={isFav} />
                    );
                })}
            </div>
        );
    };

    const navItems = [
        { id: 'home', label: 'Home', icon: Home },
        { id: 'search', label: 'Cerca', icon: Search },
        { id: 'library', label: 'Libreria', icon: Library },
        { id: 'ai-dj', label: 'Ai DJ', icon: Sparkles },
    ];

    return (
        <div className="p-8 pb-32">
            <header className="flex justify-between items-center mb-8 sticky top-0 bg-transparent z-10 py-4 -mx-8 px-8 gap-4">
                <div className="absolute inset-0 bg-black/20 backdrop-blur-xl border-b border-white/10"></div>
                
                <div className="relative flex items-center gap-4 z-10 w-[100px]">
                    {!isSidebarVisible && (
                        <button onClick={() => setIsSidebarVisible(true)} className="hidden md:flex p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-white h-10 w-10 shrink-0 items-center justify-center">
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                </div>

                <AnimatePresence>
                    {!isSidebarVisible && (
                        <motion.nav 
                            initial={{ opacity: 0, y: -20, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.9 }}
                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                            className="relative z-10 hidden md:flex items-center gap-2 bg-black/40 backdrop-blur-3xl border border-white/10 p-1.5 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.4)] absolute left-1/2 -translate-x-1/2"
                        >
                            {navItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setCurrentView(item.id)}
                                    className={`relative px-4 py-2 text-sm font-bold rounded-full transition-colors flex items-center gap-2 ${currentView === item.id ? 'text-white' : 'text-blue-200/60 hover:text-white'}`}
                                >
                                    {currentView === item.id && (
                                        <motion.div
                                            layoutId="topNavIndicator"
                                            className="absolute inset-0 bg-white/10 rounded-full"
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        />
                                    )}
                                    <item.icon className="w-4 h-4 relative z-10" />
                                    <span className="relative z-10">{item.label}</span>
                                </button>
                            ))}
                        </motion.nav>
                    )}
                </AnimatePresence>
                
                <div hidden={!isSidebarVisible} className="hidden md:block w-[100px]"></div>
            </header>

            <Dialog open={createPlaylistDialog} onOpenChange={setCreatePlaylistDialog}>
                <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl">
                    <DialogHeader><DialogTitle className="text-blue-50">Nuova Playlist</DialogTitle></DialogHeader>
                    <form onSubmit={addPlaylist} className="space-y-4">
                        <input value={newPlaylistTitle} onChange={e => setNewPlaylistTitle(e.target.value)} placeholder="La mia fantastica playlist" className="w-full bg-white/5 border border-white/10 rounded py-2 px-3 focus:outline-none focus:border-blue-400 text-white placeholder-cyan-100/30 transition-colors" />
                        <button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold rounded-full py-2 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] transition-all">Crea</button>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!swipeActionTrack} onOpenChange={(open) => { if (!open) setSwipeActionTrack(null) }}>
                <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl max-w-sm rounded-xl">
                    <DialogHeader><DialogTitle className="text-blue-50">Aggiungi a playlist</DialogTitle></DialogHeader>
                    <div className="space-y-2 mt-4 max-h-[60vh] overflow-y-auto">
                        {userPlaylists.map(p => (
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
                        {userPlaylists.length === 0 && <p className="text-sm text-blue-200/60 p-4 text-center">Nessuna playlist trovata.</p>}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={!!shareDialogPlaylist} onOpenChange={(open) => { if (!open) setShareDialogPlaylist(null) }}>
                <DialogContent className="bg-black/80 backdrop-blur-2xl border-white/20 text-white shadow-2xl max-w-sm rounded-xl">
                    <DialogHeader><DialogTitle className="text-blue-50">Condividi Playlist</DialogTitle></DialogHeader>
                    <div className="space-y-4 mt-4">
                        <p className="text-sm text-blue-100/70">
                            Copia il link per condividere la playlist con i tuoi amici. Attivando la condivisione diventerà pubblica.
                        </p>
                        <div className="flex gap-2">
                           <input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareDialogPlaylist?.id}`} className="flex-1 bg-white/5 border border-white/10 rounded py-2 px-3 text-sm text-white/50 cursor-text select-all" onClick={e => e.currentTarget.select()} />
                           <button onClick={sharePlaylist} className="bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold rounded px-4 py-2 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] transition-all">Copia</button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AnimatePresence mode="wait">
                <motion.div
                    key={currentView}
                    initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                    transition={{ duration: 0.4, type: "spring", bounce: 0.2 }}
                    className="w-full relative z-0"
                >
                    {currentView === 'profile' && (
                        <ProfileView />
                    )}

                    {currentView === 'home' && (
                        <>
                            <section className="mb-10 relative z-0">
                                <h2 className="text-[28px] font-bold mb-6 tracking-tight text-white drop-shadow-md">
                                    {greeting}{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}
                                </h2>
                                <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-y-4 gap-x-6">
                                    <div className="flex items-center bg-white/5 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden hover:bg-white/10 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all cursor-pointer group h-14 xl:h-16" onClick={() => setCurrentView('library')}>
                                        <div className="w-14 xl:w-16 h-full bg-gradient-to-br from-blue-500 to-sky-400 flex items-center justify-center flex-shrink-0 shadow-lg group-hover:shadow-[0_0_20px_rgba(52,211,153,0.5)] transition-shadow relative">
                                           <div className="absolute inset-0 border-r border-white/20"></div>
                                           <Library className="w-6 h-6 xl:w-7 xl:h-7 text-white drop-shadow-md relative z-10" fill="currentColor" />
                                        </div>
                                        <span className="ml-4 font-bold text-[13px] xl:text-[14px] text-white drop-shadow-sm">La Tua Libreria</span>
                                    </div>
                                </div>
                            </section>

                            {history.length > 0 && (
                                <section className="relative z-0 mt-12 pb-8">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md">Ascoltati di recente</h2>
                                        <button onClick={clearHistory} className="text-xs uppercase tracking-widest font-bold text-blue-200/50 hover:text-white transition-colors">Cancella Tutto</button>
                                    </div>
                                    <TrackList tracks={history} isHistory={true} compact={true} />
                                </section>
                            )}

                            {(suggestedTracks.length > 0 || loadingSuggestions) && (
                                <section className="relative z-0 mt-8 pb-8">
                                    <div className="flex items-center mb-2">
                                        <h2 className="text-lg font-bold tracking-tight text-white drop-shadow-md flex items-center gap-2">
                                           <Sparkles className="w-4 h-4 text-blue-400" />
                                           Suggeriti per te
                                        </h2>
                                    </div>
                                    {loadingSuggestions ? (
                                        <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
                                    ) : (
                                        <TrackList tracks={suggestedTracks} compact={true} />
                                    )}
                                </section>
                            )}
                        </>
                    )}

                    {currentView === 'search' && (
                        <section className="relative z-0 min-h-[70vh] flex flex-col pt-8">
                            <motion.div 
                                layout
                                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                className={`w-full flex flex-col mx-auto transition-all duration-500 ${searchResults.length === 0 && !searching && !searchQuery ? 'mt-[15vh] max-w-3xl items-center' : 'mt-4 max-w-4xl'}`}
                            >
                                {searchResults.length === 0 && !searching && !searchQuery && (
                                    <motion.h1 
                                        initial={{ opacity: 0, y: -20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="text-4xl md:text-5xl font-bold mb-8 text-white tracking-tight drop-shadow-md text-center"
                                    >
                                        Cosa vuoi ascoltare?
                                    </motion.h1>
                                )}
                                
                                <motion.div layout className={`relative w-full rounded-[30px] transition-all bg-[#121215]/80 backdrop-blur-2xl border ${searchQuery ? 'border-sky-500/50 shadow-[0_0_40px_rgba(56,189,248,0.2)]' : 'border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.12)]'}`}>
                                    <span className="absolute inset-y-0 left-6 flex items-center text-blue-200/50">
                                        <Search className={`${searchResults.length === 0 && !searching && !searchQuery ? 'w-6 h-6' : 'w-5 h-5'} drop-shadow-sm transition-all`} />
                                    </span>
                                    <input 
                                        type="text" placeholder="Cerca artisti, brani o URL..." 
                                        className={`w-full bg-transparent rounded-[30px] focus:outline-none focus:ring-0 text-white transition-all placeholder-white/30 font-medium
                                            ${searchResults.length === 0 && !searching && !searchQuery ? 'py-5 h-16 pl-16 pr-16 text-xl' : 'py-3 h-14 pl-14 pr-12 text-lg'}`}
                                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                    />
                                    {searchQuery && (
                                        <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="absolute inset-y-0 right-5 flex items-center text-white/50 hover:text-white transition-colors">
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    )}
                                </motion.div>

                                <AnimatePresence>
                                    {searchResults.length === 0 && !searching && !searchQuery && recentSearches.length > 0 && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                                            className="w-full mt-10 flex flex-col items-center"
                                        >
                                            <h3 className="text-xs font-bold uppercase tracking-widest text-blue-200/50 mb-4">Ricerche Recenti</h3>
                                            <div className="flex flex-wrap justify-center gap-3">
                                                {recentSearches.map((q, i) => (
                                                    <motion.button 
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: i * 0.05 }}
                                                        key={q} onClick={() => handleSearch(q)} 
                                                        className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white text-sm font-medium transition-all shadow-sm flex items-center gap-2 group"
                                                    >
                                                        <Search className="w-4 h-4 text-blue-400/70" />
                                                        {q}
                                                    </motion.button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>

                            <AnimatePresence>
                                {(searchResults.length > 0 || searching) && (
                                    <motion.div 
                                        initial={{ opacity: 0, y: 50, filter: 'blur(10px)' }}
                                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                        exit={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                                        transition={{ type: "spring", stiffness: 250, damping: 25, delay: 0.1 }}
                                        className="w-full max-w-4xl mx-auto mt-8 bg-[#121215]/60 backdrop-blur-3xl border border-white/10 rounded-3xl p-6"
                                    >
                                        <h2 className="text-xl font-bold mb-6 text-white tracking-tight flex items-center gap-2">
                                            {searching ? <Loader2 className="w-5 h-5 animate-spin text-blue-400" /> : <ListMusic className="w-5 h-5 text-sky-400" />}
                                            Risultati per &quot;{searchQuery}&quot;
                                        </h2>
                                        {searching ? (
                                            <div className="flex flex-col items-center justify-center p-12 opacity-50">
                                                <Loader2 className="w-10 h-10 animate-spin text-blue-400 mb-4" />
                                                <p className="text-sm font-medium text-blue-200/80">Ricerca in corso su YouTube...</p>
                                            </div>
                                        ) : (
                                            <motion.div 
                                                variants={{
                                                    show: { transition: { staggerChildren: 0.05 } }
                                                }}
                                                initial="hidden"
                                                animate="show"
                                            >
                                                <TrackList tracks={searchResults} />
                                            </motion.div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </section>
                    )}

                    {currentView === 'library' && (
                        <section className="relative z-0">
                            <div className="flex items-end gap-6 mb-8 mt-4">
                               <div className="w-32 h-32 md:w-48 md:h-48 bg-gradient-to-br from-blue-500 to-sky-400 shadow-[0_0_40px_rgba(52,211,153,0.3)] border border-white/20 flex items-center justify-center rounded-2xl relative overflow-hidden backdrop-blur-md">
                                   <div className="absolute inset-0 bg-white/10 backdrop-blur-sm Mix-blend-overlay"></div>
                                   <Library className="w-12 h-12 md:w-20 md:h-20 text-white drop-shadow-xl relative z-10" />
                               </div>
                               <div className="pb-2">
                                   <div className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-blue-200/60 mb-2 drop-shadow-sm">Account</div>
                                   <h1 className="text-4xl md:text-7xl font-bold tracking-tighter mb-2 md:mb-4 text-white drop-shadow-lg">La Tua Libreria</h1>
                                   <div className="text-xs md:text-sm text-blue-200/60 font-medium drop-shadow-sm">
                                       <span className="text-white">{user?.displayName}</span> • {userPlaylists.length} playlist • {favorites.length} brani preferiti
                                   </div>
                               </div>
                            </div>
                            
                            <div className="mb-10">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md">Le tue Playlist</h2>
                                    <button onClick={() => setCreatePlaylistDialog(true)} className="flex items-center gap-2 text-xs uppercase tracking-widest font-bold text-blue-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full border border-white/10">
                                        <Plus className="w-4 h-4" /> Crea 
                                    </button>
                                </div>
                                {userPlaylists.length > 0 ? (
                                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {userPlaylists.map(p => (
                                            <div key={p.id} onClick={() => { setCurrentPlaylist(p); setCurrentView('playlist'); }} className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg backdrop-blur-sm group">
                                                <div className="w-full aspect-square bg-white/5 rounded-lg mb-4 flex items-center justify-center border border-white/10 shadow-inner group-hover:bg-white/10 transition-colors">
                                                   <ListMusic className="w-12 h-12 text-blue-200/40 group-hover:text-blue-300/80 transition-colors" />
                                                </div>
                                                <h3 className="font-bold text-white text-sm truncate mb-1">{p.title}</h3>
                                                <p className="text-xs text-blue-200/60">Playlist</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-blue-200/50 italic py-4">Non hai ancora creato nessuna playlist.</div>
                                )}
                            </div>

                            <div>
                                <div className="flex items-center gap-3 mb-4">
                                    <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md">Brani Piaciuti</h2>
                                    {favorites.length > 0 && (
                                        <button className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-r from-blue-600 to-sky-500 hover:opacity-90 text-white rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(52,211,153,0.3)] transition-all hover:scale-105"
                                           onClick={() => { if(favorites.length) { setCurrentTrack(favorites[0]); setQueue(favorites.slice(1)); } }}
                                        >
                                           <Play className="w-4 h-4 md:w-5 md:h-5 ml-1 drop-shadow-sm" fill="currentColor" />
                                        </button>
                                    )}
                                </div>
                                {favorites.length > 0 ? (
                                    <TrackList tracks={favorites} compact={true} />
                                ) : (
                                    <div className="text-sm text-blue-200/50 italic py-4">Nessun brano aggiunto ai preferiti.</div>
                                )}
                            </div>
                        </section>
                    )}

                    {currentView === 'playlist' && currentPlaylist && (
                        <section className="relative z-0">
                            <div className="flex items-end gap-6 mb-8 mt-4">
                               <div className="w-48 h-48 bg-white/5 backdrop-blur-xl shadow-2xl flex items-center justify-center rounded-2xl border border-white/20 relative overflow-hidden">
                                   <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                                   <ListMusic className="w-20 h-20 text-blue-200/50 relative z-10 drop-shadow-md" />
                               </div>
                               <div className="pb-2">
                                   <div className="text-xs font-bold uppercase tracking-widest text-blue-200/60 mb-2 drop-shadow-sm">Playlist</div>
                                   <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 text-white drop-shadow-lg">{currentPlaylist.title}</h1>
                                   <div className="text-sm text-blue-200/60 font-medium drop-shadow-sm">
                                       <span className="text-white">{user?.displayName}</span> • {playlistTracks.length} brani
                                   </div>
                               </div>
                            </div>
                            <div className="flex items-center gap-2 md:gap-4 mb-6 flex-wrap">
                                <button className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-r from-sky-500 to-blue-500 hover:opacity-90 text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all hover:scale-105"
                                   onClick={() => { if(playlistTracks.length) { setCurrentTrack(playlistTracks[0]); setQueue(playlistTracks.slice(1)); } }}
                                >
                                   <Play className="w-6 h-6 md:w-7 md:h-7 ml-1 drop-shadow-sm" fill="currentColor" />
                                </button>
                                <button className="flex items-center justify-center gap-2 px-4 h-12 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all text-white font-medium"
                                   onClick={shufflePlaylist}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
                                    <span className="hidden md:inline">Shuffle</span>
                                </button>
                                <button className="flex items-center justify-center gap-2 px-4 h-12 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all text-blue-300 font-medium disabled:opacity-50"
                                   onClick={activatePlaylistDJ} disabled={playlistDjMixing}
                                >
                                    {playlistDjMixing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                    <span className="hidden md:inline">Gemini DJ Mix</span>
                                </button>
                                <button className="w-12 h-12 flex items-center justify-center text-blue-200/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md rounded-full transition-all" onClick={() => setShareDialogPlaylist(currentPlaylist)} title="Condividi link pubblico">
                                   <Share2 className="w-5 h-5 drop-shadow-sm" />
                                </button>
                                <div className="ml-auto flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-lg backdrop-blur-md">
                                    <button 
                                        onClick={() => setPlaylistLayout('list')}
                                        className={`p-2 rounded-md transition-colors ${playlistLayout === 'list' ? 'bg-white/20 text-white' : 'text-blue-200/60 hover:text-white hover:bg-white/10'}`}
                                        title="Vista a lista"
                                    >
                                        <List className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => setPlaylistLayout('grid')}
                                        className={`p-2 rounded-md transition-colors ${playlistLayout === 'grid' ? 'bg-white/20 text-white' : 'text-blue-200/60 hover:text-white hover:bg-white/10'}`}
                                        title="Vista a griglia"
                                    >
                                        <LayoutGrid className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <TrackList tracks={playlistTracks} contextPlaylistId={currentPlaylist.id} layoutMode={playlistLayout} />
                        </section>
                    )}

                    {currentView === 'ai-dj' && (
                        <section className="relative z-0 min-h-[70vh] flex flex-col justify-start mt-4 px-4 md:px-0">
                            <div className="bg-[#121215]/80 backdrop-blur-3xl border border-white/10 rounded-3xl p-8 md:p-12 mb-8 shadow-2xl relative overflow-hidden flex flex-col items-center">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-sky-500"></div>
                                <div className="absolute -top-32 -right-32 w-64 h-64 bg-indigo-500/20 blur-[100px] rounded-full pointer-events-none"></div>
                                <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-sky-500/20 blur-[100px] rounded-full pointer-events-none"></div>
                                
                                <div className="flex items-center gap-4 mb-4 relative z-10">
                                   <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-sky-400 rounded-xl flex items-center justify-center border border-white/20 shadow-lg">
                                       <Sparkles className="w-6 h-6 text-white" />
                                   </div>
                                   <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white drop-shadow-sm">Gemini DJ</h1>
                                </div>
                                
                                <p className="text-base text-blue-100/70 font-medium max-w-lg text-center mb-10 relative z-10">
                                   Spiega che atmosfera, genere o periodo vuoi ascoltare. L&apos;Intelligenza Artificiale compilerà la playlist perfetta partendo dal tuo prompt.
                                </p>
                                
                                <div className="w-full max-w-2xl relative z-10">
                                   <div className="relative w-full bg-black/60 border border-white/20 rounded-[20px] shadow-inner flex items-center focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all">
                                      <div className="pl-4 pr-2">
                                          <Sparkles className="w-5 h-5 text-sky-400" />
                                      </div>
                                      <input 
                                         type="text" 
                                         placeholder="es. Synthpop anni '80 per viaggiare di notte..." 
                                         className="flex-1 bg-transparent border-none py-4 text-white focus:outline-none placeholder-white/30 text-base" 
                                         value={aiPrompt} 
                                         onChange={e => setAiPrompt(e.target.value)} 
                                         onKeyDown={e => e.key === 'Enter' && generateDJPlaylist()} 
                                      />
                                      <button 
                                          onClick={generateDJPlaylist} 
                                          disabled={mixing || !aiPrompt.trim()} 
                                          className="mx-2 my-2 bg-white text-black hover:bg-gray-200 font-bold px-5 py-2.5 rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                         {mixing ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>Genera</span>}
                                      </button>
                                   </div>
                                </div>
                            </div>

                            <AnimatePresence>
                                {djTracks.length > 0 && (
                                    <motion.div 
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 20 }}
                                        className="w-full bg-[#121215]/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 md:p-8 max-w-4xl mx-auto"
                                    >
                                       <div className="flex items-center justify-between gap-4 mb-6">
                                           <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                               <ListMusic className="w-5 h-5 text-sky-400" />
                                               Il tuo Mix generato
                                           </h2>
                                           <button className="h-10 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-full flex items-center justify-center transition-all px-5 font-bold text-sm"
                                              onClick={() => { setCurrentTrack(djTracks[0]); setQueue(djTracks.slice(1)); }}
                                           >
                                              <Play className="w-4 h-4 md:mr-2" fill="currentColor" /> <span className="hidden md:inline">Riproduci Playlist</span>
                                           </button>
                                       </div>
                                       <TrackList tracks={djTracks} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </section>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
