import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Identify URL type
    const isYoutube = url.includes("youtube.com") || url.includes("youtu.be");
    const isSpotify = url.includes("spotify.com");

    if (!isYoutube && !isSpotify) {
      return NextResponse.json({ error: "Unsupported URL type" }, { status: 400 });
    }

    if (isYoutube) {
      const urlObj = new URL(url);
      const playlistId = urlObj.searchParams.get("list");
      if (!playlistId) {
        return NextResponse.json({ error: "Invalid YouTube Playlist URL (missing list parameter)" }, { status: 400 });
      }

      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "YOUTUBE_API_KEY is not configured" }, { status: 500 });
      }

      const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}`);
      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json({ error: `YouTube API Error: ${data.error?.message || "Unknown error"}` }, { status: res.status });
      }

      const listRes = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`);
      const listData = await listRes.json();
      const playlistTitle = listData.items?.[0]?.snippet?.title || "Imported YouTube Playlist";

      const tracks = data.items.map((item: any) => ({
        source: "youtube",
        originalId: item.contentDetails.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.videoOwnerChannelTitle || "Unknown Channel",
        thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
        videoId: item.contentDetails.videoId, // Direct mapping possible
        found: true
      })).filter((t: any) => t.title !== "Private video" && t.title !== "Deleted video");

      return NextResponse.json({
        playlistTitle,
        source: "youtube",
        tracks
      });
    }

    if (isSpotify) {
      // open.spotify.com/playlist/{id}
      const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!match) {
        return NextResponse.json({ error: "Invalid Spotify Playlist URL" }, { status: 400 });
      }
      const playlistId = match[1];

      const clientId = process.env.SPOTIFY_CLIENT_ID;
      const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
         return NextResponse.json({ error: "Spotify credentials are not configured" }, { status: 500 });
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials'
      });

      if (!tokenRes.ok) {
        return NextResponse.json({ error: "Failed to authenticate with Spotify" }, { status: 500 });
      }

      const tokenData = await tokenRes.json();
      const token = tokenData.access_token;

      const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!playlistRes.ok) {
        return NextResponse.json({ error: "Failed to fetch Spotify playlist" }, { status: 500 });
      }

      const playlistData = await playlistRes.json();
      
      const tracks = playlistData.tracks.items.map((item: any) => {
         const track = item.track;
         if (!track) return null;
         return {
           source: "spotify",
           originalId: track.id,
           title: track.name,
           channelTitle: track.artists.map((a: any) => a.name).join(", "),
           thumbnailUrl: track.album.images?.[0]?.url || "",
           query: `${track.name} ${track.artists[0]?.name || ""}`.trim(),
           found: false // Needs resolution
         };
      }).filter(Boolean);

      return NextResponse.json({
        playlistTitle: playlistData.name || "Imported Spotify Playlist",
        source: "spotify",
        tracks
      });
    }

  } catch (error: any) {
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
