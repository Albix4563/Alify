"use client";

import { useEffect, useState } from "react";
import { Play, Heart, MoreVertical, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Track } from "@/lib/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GENRES = [
  { id: "rap", label: "RAP Italiano" },
  { id: "reggaeton", label: "Reggaeton" },
  { id: "inglese", label: "Pop Inglese" },
  { id: "indie", label: "Indie Italia" },
  { id: "pop", label: "Pop Italiano" },
];

export function TrendingGenres({
  onPlay,
  toggleFavorite,
  favorites,
  userPlaylists,
  addToPlaylist,
}: {
  onPlay: (track: Track, queue: Track[]) => void;
  toggleFavorite: (track: Track) => void;
  favorites: any[];
  userPlaylists: any[];
  addToPlaylist: (track: Track, playlistId: string) => void;
}) {
  const [activeGenre, setActiveGenre] = useState(GENRES[0].id);
  const [tracksByGenre, setTracksByGenre] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tracksByGenre[activeGenre]) {
      fetchTrending(activeGenre);
    }
  }, [activeGenre, tracksByGenre]);

  const fetchTrending = async (genre: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/youtube/trending?genre=${genre}`);
      if (!res.ok) {
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      setTracksByGenre((prev) => ({
        ...prev,
        [genre]: data.items || [],
      }));
    } catch (err) {
      console.error(err);
      toast.error(`Errore nel caricamento tendenze ${genre}`);
    } finally {
      setLoading(false);
    }
  };

  const tracks = tracksByGenre[activeGenre] || [];

  return (
    <section className="relative z-0 mt-8 pb-4">
      <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white drop-shadow-md mb-6">
        Top Tendenze di Oggi
      </h2>

      {/* Genre Selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {GENRES.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveGenre(g.id)}
            className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm ${
              activeGenre === g.id
                ? "bg-white text-black shadow-white/20 scale-105"
                : "bg-white/10 text-white hover:bg-white/20 border border-white/5"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Tracks Grid/List */}
      {loading && tracks.length === 0 ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {tracks.map((t: any, idx: number) => {
            const trk = {
              videoId: t.id?.videoId || t.videoId,
              title: t.snippet?.title || t.title || "",
              channelTitle: t.snippet?.channelTitle || t.channelTitle || "",
              thumbnailUrl: t.snippet?.thumbnails?.high?.url || t.thumbnailUrl || "",
            };
            if (!trk.videoId) return null;
            const isFav = favorites.some((f) => f.videoId === trk.videoId);

            return (
              <div
                key={trk.videoId + idx}
                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg backdrop-blur-sm group relative flex flex-col"
                onClick={(e) => {
                  const now = Date.now();
                  const lastTap = (e.currentTarget as any)._lastTap || 0;
                  if (now - lastTap < 300) {
                    toggleFavorite(trk as Track);
                    toast.success(isFav ? "Rimosso dai Preferiti" : "Aggiunto ai Preferiti");
                  } else {
                    const queue = tracks.slice(idx + 1).map((x: any) => ({
                      videoId: x.id?.videoId || x.videoId,
                      title: x.snippet?.title || x.title,
                      channelTitle: x.snippet?.channelTitle || x.channelTitle,
                      thumbnailUrl: x.snippet?.thumbnails?.high?.url || x.thumbnailUrl,
                    }));
                    onPlay(trk as Track, queue as Track[]);
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
                    <Play className="w-8 h-8 text-white drop-shadow-md" fill="white" />
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="bg-black/60 p-1.5 rounded-full text-blue-200/60 hover:text-white transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(trk as Track);
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
                              addToPlaylist(trk as Track, p.id);
                              toast.success(`Aggiunto a ${p.title}`);
                            }}
                            className="focus:bg-white/10 focus:text-white cursor-pointer transition-colors"
                          >
                            {p.title}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden" title={trk.title}>
                  <h3 className="font-bold text-white text-[13px] leading-tight truncate mb-[2px]">
                    {trk.title}
                  </h3>
                  <p className="text-[11px] text-blue-200/60 truncate" title={trk.channelTitle}>
                    {trk.channelTitle}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
