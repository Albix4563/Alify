import { NextResponse } from "next/server";
import { Innertube } from 'youtubei.js';

let youtube: Innertube | null = null;
async function getYouTube() {
  if (!youtube) {
    youtube = await Innertube.create({ gl: 'IT', hl: 'it' });
  }
  return youtube;
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Identify URL type
    const isYoutube = url.includes("youtube.com") || url.includes("youtu.be");

    if (!isYoutube) {
      return NextResponse.json({ error: "Unsupported URL type. Only YouTube is supported." }, { status: 400 });
    }

    const urlObj = new URL(url);
    const playlistId = urlObj.searchParams.get("list");
    if (!playlistId) {
      return NextResponse.json({ error: "Invalid YouTube Playlist URL (missing list parameter)" }, { status: 400 });
    }

    try {
      const yt = await getYouTube();
      const playlist = await yt.getPlaylist(playlistId);
      
      const playlistTitle = playlist.info.title || "Imported YouTube Playlist";

      const tracks = playlist.videos.map((item: any) => ({
        source: "youtube",
        originalId: item.id,
        title: item.title?.text || "Unknown Title",
        channelTitle: item.author?.name || "Unknown Channel",
        thumbnailUrl: item.thumbnails?.[item.thumbnails.length - 1]?.url || item.thumbnails?.[0]?.url || "",
        videoId: item.id,
        found: true
      })).filter((t: any) => t.title !== "Private video" && t.title !== "Deleted video");

      return NextResponse.json({
        playlistTitle,
        source: "youtube",
        tracks
      });
      
    } catch (ytError: any) {
        console.error("Youtubei API error:", ytError);
        
        // Fallback to official API
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (apiKey) {
            console.log("Attempting Official YouTube API fallback");
            const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}`);
            let data;
            try { data = await res.json(); } catch (e) { throw new Error('Official API returned non-JSON'); }

            if (!res.ok) {
              throw new Error(`Official API Error: ${data?.error?.message || "Unknown error"}`);
            }

            const listRes = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`);
            let listData: any = {};
            try { listData = await listRes.json(); } catch (e) {}
            const fallbackTitle = listData.items?.[0]?.snippet?.title || "Imported YouTube Playlist";

            const fallbackTracks = data.items.map((item: any) => ({
              source: "youtube",
              originalId: item.contentDetails.videoId,
              title: item.snippet.title,
              channelTitle: item.snippet.videoOwnerChannelTitle || "Unknown Channel",
              thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
              videoId: item.contentDetails.videoId, // Direct mapping possible
              found: true
            })).filter((t: any) => t.title !== "Private video" && t.title !== "Deleted video");

            return NextResponse.json({
              playlistTitle: fallbackTitle,
              source: "youtube",
              tracks: fallbackTracks
            });
        }
        
        throw new Error(ytError.message || "Failed to fetch playlist");
    }
  } catch (error: any) {
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
