"use client";

import { useState } from "react";
import { Download, Loader2, Music4, Check, X, Search, Youtube, Activity, Plus } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp, collection, addDoc } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/firestore-error";
import { Track } from "@/lib/store";

export function ImportView({ currentView, userPlaylists, setCurrentView }: { currentView: string, userPlaylists: any[], setCurrentView: (view: string) => void }) {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [importedData, setImportedData] = useState<{
    playlistTitle: string;
    source: string;
    tracks: Array<{
      source: string;
      originalId: string;
      title: string;
      channelTitle: string;
      thumbnailUrl: string;
      videoId?: string;
      query?: string;
      found: boolean;
      selected?: boolean;
    }>;
  } | null>(null);

  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("new");

  if (currentView !== "import") return null;

  const handleImport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setImportedData(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Errore durante l'importazione");
      } else {
        // Automatically select all tracks
        const tracks = (data.tracks || []).map((t: any) => ({ ...t, selected: true }));
        setImportedData({ ...data, tracks });
        if (data.source === "spotify") {
            toast.info("Brani Spotify analizzati. Albify cercherà ora i video corrispondenti.");
        }
      }
    } catch (err) {
      toast.error("Errore di connessione.");
    } finally {
      setLoading(false);
    }
  };

  const resolveSpotifyTrack = async (track: any, index: number) => {
    if (track.found && track.videoId) return;

    setResolvingIds(prev => new Set(prev).add(track.originalId));
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(track.query)}`);
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const firstResult = data.items?.[0];
      
      setImportedData(prev => {
        if (!prev) return prev;
        const newTracks = [...prev.tracks];
        if (firstResult) {
          newTracks[index] = {
            ...track,
            found: true,
            videoId: firstResult.id.videoId,
            thumbnailUrl: firstResult.snippet?.thumbnails?.high?.url || track.thumbnailUrl,
            // Keep original Spotify title for display, but it's now linked to YT videoId
          };
        } else {
          newTracks[index] = { ...track, found: false, selected: false };
        }
        return { ...prev, tracks: newTracks };
      });
    } catch (err) {
      setImportedData(prev => {
        if (!prev) return prev;
        const newTracks = [...prev.tracks];
        newTracks[index] = { ...track, found: false, selected: false };
        return { ...prev, tracks: newTracks };
      });
    } finally {
      setResolvingIds(prev => {
        const next = new Set(prev);
        next.delete(track.originalId);
        return next;
      });
    }
  };

  const saveSelected = async () => {
    if (!user || !importedData) return;
    const tracksToSave = importedData.tracks.filter(t => t.selected && t.found && t.videoId);
    
    if (tracksToSave.length === 0) {
      toast.error("Nessun brano valido selezionato.");
      return;
    }

    setSaving(true);
    let targetPlaylistId = selectedPlaylistId;

    try {
      if (targetPlaylistId === "new") {
        const docRef = await addDoc(collection(db, "playlists"), {
          ownerId: user.uid,
          title: `Imported: ${importedData.playlistTitle}`,
          description: `Imported from ${importedData.source}`,
          isPublic: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        targetPlaylistId = docRef.id;
      }

      const promises = tracksToSave.map(t => 
        setDoc(doc(db, "playlists", targetPlaylistId, "tracks", t.videoId!), {
          videoId: t.videoId,
          title: t.title,
          channelTitle: t.channelTitle,
          thumbnailUrl: t.thumbnailUrl,
          addedAt: serverTimestamp()
        })
      );

      await Promise.all(promises);
      toast.success(`${tracksToSave.length} brani importati con successo!`);
      // Reset state after success
      setImportedData(null);
      setUrl("");
      setCurrentView("library");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `playlists/${targetPlaylistId}/tracks`);
      toast.error("Errore nel salvataggio dei brani.");
    } finally {
       setSaving(false);
    }
  };

  const toggleTrackSelection = (idx: number) => {
    setImportedData(prev => {
      if (!prev) return prev;
      const t = [...prev.tracks];
      t[idx].selected = !t[idx].selected;
      return { ...prev, tracks: t };
    });
  };

  return (
    <section className="relative z-0 min-h-[70vh] flex flex-col justify-start mt-4 px-4 md:px-8 max-w-5xl mx-auto w-full">
      <div className="bg-[#121215]/80 backdrop-blur-3xl border border-white/10 rounded-[28px] md:rounded-3xl p-6 md:p-12 mb-8 shadow-2xl relative overflow-hidden flex flex-col items-center">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 via-emerald-400 to-sky-500"></div>

        <div className="flex items-center gap-4 mb-4 relative z-10">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-green-500 to-emerald-400 rounded-xl flex items-center justify-center border border-white/20 shadow-lg">
            <Download className="w-5 h-5 md:w-6 md:h-6 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            Importa Playlist
          </h1>
        </div>

        <p className="text-sm md:text-base text-blue-100/70 font-medium max-w-lg text-center mb-8 relative z-10">
          Incolla qui sotto il link pubblico di una playlist da Spotify o YouTube.
          Penseremo noi a trovare i brani corrispondenti nel nostro catalogo.
        </p>

        <div className="w-full max-w-2xl relative z-10">
          <div className="relative w-full bg-black/60 border border-white/20 rounded-[24px] shadow-inner flex flex-col md:flex-row items-stretch md:items-center focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all overflow-hidden">
            <div className="hidden md:flex pl-4 pr-2 text-emerald-400">
               <Music4 className="w-5 h-5" />
            </div>
            <input
              type="url"
              placeholder="https://open.spotify.com/playlist/... oppure https://youtube.com/playlist?list=..."
              className="flex-1 bg-transparent border-none p-4 md:py-4 text-white focus:outline-none placeholder-white/30 text-sm md:text-base"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleImport()}
            />
            <div className="p-3 md:p-2 bg-black/20 md:bg-transparent border-t md:border-none border-white/10 flex justify-end">
              <button
                onClick={handleImport}
                disabled={loading || !url.trim()}
                className="bg-white text-black hover:bg-gray-200 font-bold px-6 py-3 md:px-5 md:py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <span>Analizza</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {importedData && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="w-full bg-[#121215]/60 backdrop-blur-2xl border border-white/10 rounded-[28px] md:rounded-3xl p-6 md:p-8"
          >
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
              <div>
                 <h2 className="text-xl font-bold text-white flex items-center gap-2">
                   {importedData.source === 'spotify' ? <Activity className="w-5 h-5 text-green-400" /> : <Youtube className="w-5 h-5 text-red-500" />}
                   {importedData.playlistTitle}
                 </h2>
                 <p className="text-sm text-blue-200/60 mt-1">
                   {importedData.tracks.length} brani trovati. Seleziona quelli da importare.
                 </p>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                 <select
                   className="bg-black/60 border border-white/10 rounded-lg text-white text-sm px-3 py-2.5 focus:outline-none focus:border-emerald-500/50"
                   value={selectedPlaylistId}
                   onChange={e => setSelectedPlaylistId(e.target.value)}
                 >
                   <option value="new">+ Crea Nuova Playlist</option>
                   {userPlaylists.map(p => (
                     <option key={p.id} value={p.id}>Importa in: {p.title}</option>
                   ))}
                 </select>
                 <button
                   className="h-10 border border-transparent bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-lg px-6 transition-all disabled:opacity-50 flex items-center"
                   onClick={saveSelected}
                   disabled={saving || !importedData.tracks.some(t => t.selected && t.found && t.videoId)}
                 >
                   {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salva Selezione"}
                 </button>
              </div>
            </div>
            
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
               {importedData.tracks.map((track, idx) => (
                 <div key={idx} className={`flex items-center p-3 rounded-xl border transition-all ${track.selected ? (track.found ? 'bg-[#18181b] border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-red-500/10 border-red-500/30') : 'bg-[#18181b] border-white/5 opacity-80'}`}>
                    <button
                      onClick={() => toggleTrackSelection(idx)}
                      className={`w-6 h-6 rounded-md flex items-center justify-center mr-4 flex-shrink-0 transition-colors ${track.selected ? 'bg-emerald-500 text-black shadow-md' : 'bg-white/5 border border-white/10 hover:bg-white/10'}`}
                      disabled={!track.found && !resolvingIds.has(track.originalId)}
                    >
                       {track.selected && <Check className="w-4 h-4" />}
                    </button>
                    
                    {track.thumbnailUrl ? (
                      <img src={track.thumbnailUrl} alt="" className="w-12 h-12 rounded-md object-cover mr-4 flex-shrink-0 shadow-sm" />
                    ) : (
                      <div className="w-12 h-12 rounded-md mr-4 flex-shrink-0 bg-white/5 border border-white/10 flex items-center justify-center shadow-sm">
                        <Music4 className="w-5 h-5 text-white/40" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                       <p className={`text-sm font-bold truncate ${track.found ? 'text-white' : 'text-white/70'}`}>{track.title}</p>
                       <p className="text-xs text-white/50 truncate">{track.channelTitle}</p>
                    </div>

                    <div className="ml-4 flex-shrink-0 flex items-center">
                       {resolvingIds.has(track.originalId) ? (
                         <div className="flex items-center text-sky-400 text-xs gap-1"><Loader2 className="w-3 h-3 animate-spin"/> Ricerca...</div>
                       ) : track.found ? (
                         <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded">Trovato</span>
                       ) : track.source === 'spotify' && track.query ? (
                         <button 
                           onClick={() => resolveSpotifyTrack(track, idx)} 
                           className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1"
                         >
                           <Search className="w-3 h-3"/> Cerca
                         </button>
                       ) : (
                         <span className="text-xs text-red-400 font-bold bg-red-500/10 px-2 py-1 rounded">Non Trovato</span>
                       )}
                    </div>
                 </div>
               ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
