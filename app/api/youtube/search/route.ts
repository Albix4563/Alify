import { NextResponse } from "next/server";
import { Innertube } from 'youtubei.js';

let youtube: Innertube | null = null;
async function getYouTube() {
  if (!youtube) {
    youtube = await Innertube.create({ gl: 'IT', hl: 'it' });
  }
  return youtube;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
  }

  try {
    const yt = await getYouTube();
    const searchResults = await yt.search(q, { type: 'video' });
    
    // Map to standard YouTube Data API v3 format to maintain compatibility with the frontend
    const items = searchResults.videos.map((video: any) => {
      return {
        id: { videoId: video.id },
        snippet: {
          title: video.title?.text || "Unknown Title",
          channelTitle: video.author?.name || "Unknown Channel",
          thumbnails: {
            default: { url: video.thumbnails?.[0]?.url || "" },
            high: { url: video.thumbnails?.[video.thumbnails.length - 1]?.url || "" }
          }
        }
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Youtubei API error:", error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to search YouTube';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
