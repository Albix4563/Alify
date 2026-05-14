import { NextResponse } from "next/server";
import { Innertube } from 'youtubei.js';
import {
  applyRateLimit,
  logApiError,
  normalizeAndLimit,
  sanitizeText,
} from '@/lib/api-security';

let youtube: Innertube | null = null;
async function getYouTube() {
  if (!youtube) {
    youtube = await Innertube.create({ gl: 'IT', hl: 'it' });
  }
  return youtube;
}

export async function GET(request: Request) {
  const rateLimitResponse = applyRateLimit(request, {
    keyPrefix: 'youtube-search',
    max: 45,
    windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const q = normalizeAndLimit(searchParams.get('q'), 120);
  
  if (!q) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
  }

  try {
    const yt = await getYouTube();
    const searchResults = await yt.search(q, { type: 'video' });
    
    // Map to standard YouTube Data API v3 format to maintain compatibility with the frontend
    const items = searchResults.videos.slice(0, 30).map((video: any) => {
      const thumbs = Array.isArray(video.thumbnails) ? video.thumbnails : [];
      const defaultThumb = thumbs[0]?.url || "";
      const highThumb = thumbs[thumbs.length - 1]?.url || defaultThumb;
      return {
        id: { videoId: video.id },
        snippet: {
          title: sanitizeText(video.title?.text || "Unknown Title", 220),
          channelTitle: sanitizeText(video.author?.name || "Unknown Channel", 220),
          thumbnails: {
            default: { url: defaultThumb },
            high: { url: highThumb }
          }
        }
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    logApiError("YouTube search API error", error);
    return NextResponse.json(
      { error: 'Failed to search YouTube at the moment.' },
      { status: 500 },
    );
  }
}
