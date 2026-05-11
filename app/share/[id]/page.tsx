'use client';

import { useEffect, useState, use } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query } from 'firebase/firestore';
import { Play, ListMusic, Loader2 } from 'lucide-react';
import { usePlayerStore } from '@/lib/store';
import { Player } from '@/components/Player';
import { useAuth } from '@/lib/auth-context';
import { AuthForm } from '@/components/AuthForm';

export default function SharedPlaylist({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { user, loading: authLoading } = useAuth();
    const [playlist, setPlaylist] = useState<any>(null);
    const [tracks, setTracks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { setCurrentTrack, setQueue } = usePlayerStore();

    useEffect(() => {
        if (!user) { setLoading(false); return; }

        let isMounted = true;
        const fetchPlaylist = async () => {
            try {
                const docRef = doc(db, 'playlists', id);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists() && isMounted) {
                    setPlaylist({ id: docSnap.id, ...docSnap.data() });
                    const q = query(collection(db, 'playlists', id, 'tracks'));
                    const snap = await getDocs(q);
                    const trks: any[] = [];
                    snap.forEach(d => trks.push({ ...d.data() }));
                    if (isMounted) setTracks(trks);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        fetchPlaylist();
        return () => { isMounted = false; };
    }, [id, user]);

    if (authLoading || loading) return <div className="h-screen w-screen flex items-center justify-center bg-transparent text-sky-400 relative z-10"><Loader2 className="w-8 h-8 animate-spin" /></div>;
    if (!user) return <AuthForm />;
    if (!playlist) return <div className="h-screen w-screen flex flex-col items-center justify-center bg-transparent text-blue-300 gap-4 relative z-10"><h1 className="text-2xl font-bold">Playlist non trovata o privata</h1></div>;

    return (
        <div className="flex flex-col h-screen bg-transparent text-white overflow-hidden font-sans relative z-10">
            <div className="flex-1 overflow-y-auto pb-24 p-8 max-w-5xl mx-auto w-full relative z-0">
                <div className="flex items-end gap-6 mb-8 mt-4 relative z-0">
                   <div className="w-48 h-48 bg-white/5 backdrop-blur-xl shadow-2xl flex items-center justify-center rounded-2xl border border-white/20 relative overflow-hidden">
                       <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                       <ListMusic className="w-20 h-20 text-blue-200/50 relative z-10 drop-shadow-md" />
                   </div>
                   <div className="pb-2">
                       <div className="text-xs font-bold uppercase tracking-widest text-blue-200/60 mb-2 drop-shadow-sm">Playlist Condivisa</div>
                       <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 text-white drop-shadow-lg">{playlist.title}</h1>
                       <div className="text-sm text-blue-200/60 font-medium drop-shadow-sm">{tracks.length} brani</div>
                   </div>
                </div>
                
                <div className="flex items-center gap-4 mb-6 relative z-0">
                    <button className="w-14 h-14 bg-gradient-to-r from-sky-500 to-blue-500 hover:opacity-90 text-black rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_25px_rgba(56,189,248,0.6)]"
                       onClick={() => { if(tracks.length) { setCurrentTrack(tracks[0]); setQueue(tracks.slice(1)); } }}
                    >
                       <Play className="w-7 h-7 ml-1 drop-shadow-sm" fill="currentColor" />
                    </button>
                </div>

                <div className="space-y-2 relative z-0">
                    {tracks.map((trk, idx) => (
                        <div key={trk.videoId} className="flex items-center p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all group cursor-pointer border border-transparent hover:border-white/10 backdrop-blur-sm shadow-sm hover:shadow-md" onClick={() => {
                                 setCurrentTrack(trk);
                                 setQueue(tracks.slice(idx + 1).map(x => ({ videoId: x.videoId, title: x.title, channelTitle: x.channelTitle, thumbnailUrl: x.thumbnailUrl })));
                             }}>
                            <div className="w-12 h-12 relative overflow-hidden rounded-md bg-black/40 shadow-xl border border-white/10">
                                <img src={trk.thumbnailUrl} alt={trk.title} className="w-full h-full object-cover relative z-0" />
                                <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    <Play className="w-5 h-5 text-white drop-shadow-md" fill="white" />
                                </div>
                            </div>
                            <div className="ml-4 flex-1 overflow-hidden">
                                <div className="truncate font-bold text-sm text-white mb-0.5 drop-shadow-sm">{trk.title}</div>
                                <div className="truncate text-xs text-blue-200/60 drop-shadow-sm">{trk.channelTitle}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <Player />
        </div>
    );
}
