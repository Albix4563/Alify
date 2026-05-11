'use client';

import { useState, useEffect } from 'react';
import { usePlayerStore, Track } from '@/lib/store';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { collection, query, where, doc, setDoc, deleteDoc, serverTimestamp, onSnapshot, addDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';
import { Search, Play, Heart, Plus, Share2, MoreVertical, Loader2, ListMusic, Sparkles, Library } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

export function MainContent({ currentView, currentPlaylist, setCurrentView, createPlaylistDialog, setCreatePlaylistDialog, setCurrentPlaylist }: any) {
    const { user } = useAuth();
    const { setCurrentTrack, setQueue } = usePlayerStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

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

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setCurrentView('search');
        try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchQuery)}`);
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
         if(!currentPlaylist) return;
         try {
             await setDoc(doc(db, 'playlists', currentPlaylist.id), { ...currentPlaylist, isPublic: true, updatedAt: serverTimestamp() });
             const url = `${window.location.origin}/share/${currentPlaylist.id}`;
             navigator.clipboard.writeText(url);
             toast.success("Playlist condivisa! Link copiato.");
         } catch (e) { handleFirestoreError(e, OperationType.UPDATE, `playlists/${currentPlaylist.id}`); }
    }

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

    const TrackList = ({ tracks, contextPlaylistId, isHistory = false, compact = false }: { tracks: any[], contextPlaylistId?: string, isHistory?: boolean, compact?: boolean }) => (
        <div className={`space-y-${compact ? '1' : '2'} mt-${compact ? '3' : '6'}`}>
            {tracks.map((t, idx) => {
                const trk = {
                    videoId: t.videoId || t.id?.videoId, title: t.title || t.snippet?.title || '',
                    channelTitle: t.channelTitle || t.snippet?.channelTitle || '',
                    thumbnailUrl: t.thumbnailUrl || t.snippet?.thumbnails?.high?.url || ''
                };
                if (!trk.videoId) return null;
                const isFav = favorites.some(f => f.videoId === trk.videoId);

                return (
                    <div key={trk.videoId} className={`flex items-center ${compact ? 'p-1.5' : 'p-3'} bg-white/5 hover:bg-white/10 ${compact ? 'rounded-lg' : 'rounded-xl'} transition-all group cursor-pointer border border-transparent hover:border-white/10 backdrop-blur-sm shadow-[0_2px_4px_rgba(0,0,0,0.1)] hover:shadow-md`}>
                        <div className={`${compact ? 'w-10 h-10' : 'w-12 h-12'} relative overflow-hidden rounded-md bg-black/40 shadow-xl border border-white/10`}
                             onClick={() => {
                                 setCurrentTrack(trk);
                                 setQueue(tracks.slice(idx + 1).map(x => ({
                                      videoId: x.videoId || x.id?.videoId, title: x.title || x.snippet?.title,
                                      channelTitle: x.channelTitle || x.snippet?.channelTitle, thumbnailUrl: x.thumbnailUrl || x.snippet?.thumbnails?.high?.url
                                 })));
                             }}
                        >
                            <img src={trk.thumbnailUrl} alt={trk.title} className="w-full h-full object-cover relative z-0" />
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                <Play className="w-5 h-5 text-white drop-shadow-md" fill="white" />
                            </div>
                        </div>
                        <div className="ml-3 flex-1 overflow-hidden" onClick={() => {
                                 setCurrentTrack(trk);
                                 setQueue(tracks.slice(idx + 1).map(x => ({
                                      videoId: x.videoId || x.id?.videoId, title: x.title || x.snippet?.title,
                                      channelTitle: x.channelTitle || x.snippet?.channelTitle, thumbnailUrl: x.thumbnailUrl || x.snippet?.thumbnails?.high?.url
                                 })));
                             }}>
                            <div className={`truncate font-bold ${compact ? 'text-xs' : 'text-sm'} text-white mb-0.5 drop-shadow-sm`}>{trk.title}</div>
                            <div className={`truncate ${compact ? 'text-[10px]' : 'text-xs'} text-blue-200/60 drop-shadow-sm`}>{trk.channelTitle}</div>
                        </div>
                        <div className="flex items-center space-x-1 md:space-x-2 opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                            {isHistory ? (
                                <button className="text-red-400/60 hover:text-red-400 p-1 md:p-2 transition-colors text-[10px] md:text-xs font-medium uppercase tracking-wider" onClick={(e) => { e.stopPropagation(); removeHistoryTrack(trk.videoId); }}>
                                    Rimuovi
                                </button>
                            ) : null}
                            <button className="text-blue-200/60 hover:text-white p-1 md:p-2 transition-colors" onClick={(e) => { e.stopPropagation(); toggleFavorite(trk); }}>
                                <Heart className={`${compact ? 'w-4 h-4' : 'w-5 h-5'}`} fill={isFav ? "white" : "none"} color={isFav ? "white" : "currentColor"} />
                            </button>
                            <DropdownMenu>
                                <DropdownMenuTrigger className="text-blue-200/60 hover:text-white p-1 md:p-2 transition-colors" onClick={e => e.stopPropagation()}>
                                    <Plus className={`${compact ? 'w-4 h-4' : 'w-5 h-5'}`} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48 bg-black/80 backdrop-blur-xl border-white/20 text-white shadow-xl">
                                    <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-300/50">Aggiungi alla playlist</div>
                                    {userPlaylists.map(p => (
                                        <DropdownMenuItem key={p.id} onClick={() => addToPlaylist(trk, p.id)} className="focus:bg-white/10 focus:text-white cursor-pointer transition-colors">
                                            {p.title}
                                        </DropdownMenuItem>
                                    ))}
                                    {contextPlaylistId && (
                                        <>
                                            <div className="h-px bg-white/10 my-1" />
                                            <DropdownMenuItem className="text-red-400 focus:bg-red-500/20 focus:text-red-300 cursor-pointer transition-colors" onClick={() => removeFromPlaylist(trk.videoId, contextPlaylistId)}>
                                                Rimuovi dalla playlist
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    return (
        <div className="p-8 pb-32">
            <header className="flex justify-between items-center mb-8 sticky top-0 bg-transparent z-10 py-4 -mx-8 px-8">
                <div className="absolute inset-0 bg-black/20 backdrop-blur-xl border-b border-white/10"></div>
                <div className="relative w-96 flex z-10">
                    <span className="absolute inset-y-0 left-3 flex items-center text-blue-200/50">
                        <Search className="w-5 h-5 ml-1 drop-shadow-sm" />
                    </span>
                    <input 
                        type="text" placeholder="Cerca brani o URL di YouTube..." 
                        className="w-full bg-white/5 border border-white/10 rounded-full py-3 h-10 pl-11 pr-4 text-[13px] md:text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/50 focus:bg-white/10 text-white transition-all placeholder-cyan-100/40 font-medium backdrop-blur-md shadow-inner"
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    />
                </div>
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

            {currentView === 'home' && (
                <>
                    <section className="mb-10 relative z-0">
                        <h2 className="text-[28px] font-bold mb-6 tracking-tight text-white drop-shadow-md">Benvenuto</h2>
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
                <section className="relative z-0">
                    <h2 className="text-2xl font-bold mb-6 text-white drop-shadow-md">Risultati della Ricerca</h2>
                    {searching ? <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div> : <TrackList tracks={searchResults} />}
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
                    <div className="flex items-center gap-4 mb-6">
                        <button className="w-14 h-14 bg-gradient-to-r from-sky-500 to-blue-500 hover:opacity-90 text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_25px_rgba(56,189,248,0.6)]"
                           onClick={() => { if(playlistTracks.length) { setCurrentTrack(playlistTracks[0]); setQueue(playlistTracks.slice(1)); } }}
                        >
                           <Play className="w-7 h-7 ml-1 drop-shadow-sm" fill="currentColor" />
                        </button>
                        <button className="w-12 h-12 flex items-center justify-center text-blue-200/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md rounded-full transition-all" onClick={sharePlaylist} title="Condividi link pubblico">
                           <Share2 className="w-5 h-5 drop-shadow-sm" />
                        </button>
                    </div>
                    <TrackList tracks={playlistTracks} contextPlaylistId={currentPlaylist.id} />
                </section>
            )}

            {currentView === 'ai-dj' && (
                <section className="relative z-0">
                    <div className="flex items-end gap-6 mb-8 mt-4">
                       <div className="w-48 h-48 bg-gradient-to-br from-sky-500 to-blue-500 shadow-[0_0_40px_rgba(56,189,248,0.3)] border border-white/20 flex items-center justify-center rounded-2xl relative overflow-hidden backdrop-blur-md">
                           <div className="absolute inset-0 bg-white/10 backdrop-blur-sm Mix-blend-overlay"></div>
                           <Sparkles className="w-20 h-20 text-white drop-shadow-xl relative z-10" />
                       </div>
                       <div className="pb-2 flex-1">
                           <div className="text-xs font-bold uppercase tracking-widest text-blue-200/60 mb-2 drop-shadow-sm">Intelligenza Artificiale</div>
                           <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 text-white drop-shadow-lg">DJ Automatico</h1>
                           <div className="text-sm text-blue-200/60 font-medium drop-shadow-sm">
                               Genera rapidamente una playlist personalizzata in base alla tua richiesta!
                           </div>
                       </div>
                    </div>
                    
                    <div className="mb-8">
                       <div className="relative max-w-2xl">
                          <input type="text" placeholder="es. Synthpop anni '80 per guidare..." className="w-full bg-white/5 border border-white/10 rounded-xl py-4 h-14 pl-4 pr-32 focus:outline-none focus:ring-1 focus:ring-blue-400/50 text-white placeholder-cyan-100/40 text-lg shadow-inner" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && generateDJPlaylist()} />
                          <button onClick={generateDJPlaylist} disabled={mixing} className="absolute right-2 top-2 bottom-2 bg-gradient-to-r from-blue-600 to-sky-500 hover:opacity-90 text-white font-bold px-6 rounded-lg transition-all flex items-center gap-2">
                             {mixing ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Genera</span>}
                          </button>
                       </div>
                    </div>

                    {djTracks.length > 0 && (
                        <div>
                           <div className="flex items-center gap-4 mb-6">
                               <button className="w-14 h-14 bg-gradient-to-r from-blue-500 to-sky-400 hover:opacity-90 text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(52,211,153,0.4)] transition-all hover:scale-105"
                                  onClick={() => { setCurrentTrack(djTracks[0]); setQueue(djTracks.slice(1)); }}
                               >
                                  <Play className="w-7 h-7 ml-1" fill="currentColor" />
                               </button>
                           </div>
                           <TrackList tracks={djTracks} />
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
