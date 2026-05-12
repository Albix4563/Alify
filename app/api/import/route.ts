import { NextResponse } from "next/server";

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
  } catch (error: any) {
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
