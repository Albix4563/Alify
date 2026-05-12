import { NextResponse } from "next/server";
import { Innertube } from 'youtubei.js';
import { unstable_cache } from 'next/cache';

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
    
    return searchResults.videos.slice(0, 15).map((video: any) => ({
      id: { videoId: video.id },
      snippet: {
        title: video.title?.text || "Unknown Title",
        channelTitle: video.author?.name || "Unknown Channel",
        thumbnails: {
          default: { url: video.thumbnails?.[0]?.url || "" },
          high: { url: video.thumbnails?.[video.thumbnails.length - 1]?.url || "" }
        }
      }
    }));
  },
  ['trending-youtube-genre'],
  { revalidate: 86400 } // 24 hours
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genre = searchParams.get('genre') || 'rap';
  
  const queryMap: Record<string, string> = {
    'rap': 'top hit rap italiano',
    'reggaeton': 'top hit reggaeton',
    'inglese': 'top hit pop english',
    'indie': 'top hit indie italia',
    'pop': 'top hit pop italia'
  };

  const query = queryMap[genre] || `top hit ${genre}`;

  try {
    const items = await getCachedTrending(query);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Youtubei Trending API error:", error);
    return NextResponse.json({ error: 'Failed to fetch trending' }, { status: 500 });
  }
}
