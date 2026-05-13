import { NextResponse } from "next/server";
import { applyRateLimit, logApiError } from '@/lib/api-security';

const INVIDIOUS_INSTANCES = [
  'https://y.com.sb',
  'https://iv.nboeck.de',
  'https://iv.datura.network',
];

export async function GET(request: Request) {
  const rateLimitResponse = applyRateLimit(request, {
    keyPrefix: 'youtube-stream',
    max: 60,
    windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('v');

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Valid videoId is required' }, { status: 400 });
  }

  for (const baseUrl of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Albify/1.0' },
        next: { revalidate: 0 },
      });
      if (!res.ok) continue;

      const data = await res.json();
      const formats = data.adaptiveFormats || [];
      const audioFormats = formats.filter((f: any) =>
        f.type && f.type.startsWith('audio/')
      );

      if (audioFormats.length === 0) continue;

      // Prefer m4a for iOS, then highest bitrate
      audioFormats.sort((a: any, b: any) => {
        const aM4a = a.type.includes('mp4');
        const bM4a = b.type.includes('mp4');
        if (aM4a && !bM4a) return -1;
        if (!aM4a && bM4a) return 1;
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

      const best = audioFormats[0];
      if (best.url) {
        return NextResponse.json({
          videoId,
          url: best.url,
          title: data.title || '',
          duration: data.lengthSeconds || 0,
        });
      }
    } catch (e) {
      // try next instance
    }
  }

  return NextResponse.json({ error: 'No audio stream found' }, { status: 404 });
}
