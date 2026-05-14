import { NextResponse } from "next/server";
import { Innertube } from 'youtubei.js';
import { unstable_cache } from 'next/cache';
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

const getCachedTrending = unstable_cache(
  async (genreQuery: string) => {
    const yt = await getYouTube();
    const searchResults = await yt.search(genreQuery, { type: 'video' });
    
    return searchResults.videos.slice(0, 15).map((video: any) => {
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
            high: { url: highThumb },
          },
        },
      };
    });
  },
  ['trending-youtube-genre'],
  { revalidate: 86400 } // 24 hours
);

export async function GET(request: Request) {
  const rateLimitResponse = applyRateLimit(request, {
    keyPrefix: 'youtube-trending',
    max: 60,
    windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const requestedGenre = normalizeAndLimit(searchParams.get('genre'), 24).toLowerCase();
  
  const queryMap: Record<string, string> = {
    'rap': 'top hit rap italiano',
    'reggaeton': 'top hit reggaeton',
    'inglese': 'top hit pop english',
    'indie': 'top hit indie italia',
    'pop': 'top hit pop italia'
  };

  const genre = requestedGenre && requestedGenre in queryMap ? requestedGenre : 'rap';
  const query = queryMap[genre] || `top hit ${genre}`;

  try {
    const items = await getCachedTrending(query);
    return NextResponse.json({ items });
  } catch (error) {
    logApiError("YouTube trending API error", error);
    return NextResponse.json({ error: 'Failed to fetch trending' }, { status: 500 });
  }
}
