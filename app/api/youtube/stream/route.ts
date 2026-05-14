import { NextResponse } from 'next/server';
import { Innertube } from 'youtubei.js';
import {
  applyRateLimit,
  logApiError,
  normalizeAndLimit,
} from '@/lib/api-security';

const INVIDIOUS_INSTANCES = [
  'https://y.com.sb',
  'https://iv.nboeck.de',
  'https://iv.datura.network',
];

type InvidiousFormat = {
  type?: string;
  bitrate?: number;
  url?: string;
};

type InvidiousVideo = {
  adaptiveFormats?: InvidiousFormat[];
  title?: string;
  lengthSeconds?: number | string;
};

let youtube: Innertube | null = null;

async function getYouTube() {
  if (!youtube) {
    youtube = await Innertube.create({ gl: 'IT', hl: 'it' });
  }
  return youtube;
}

function isValidVideoId(videoId: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return (await Promise.race([promise, timeoutPromise])) as T | null;
  } catch {
    return null;
  }
}

async function getStreamFromYouTubei(videoId: string) {
  const yt = await getYouTube();
  const attempts = [
    { type: 'audio' as const, quality: 'best', format: 'mp4' },
    { type: 'audio' as const, quality: 'best' },
  ];

  for (const options of attempts) {
    const format = await withTimeout(yt.getStreamingData(videoId, options), 7000);
    if (format?.url) {
      return {
        url: format.url,
        mimeType: format.mime_type || '',
        bitrate: format.bitrate || 0,
      };
    }
  }

  return null;
}

async function getStreamFromInvidious(videoId: string) {
  for (const baseUrl of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(`${baseUrl}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Albify/1.0' },
        next: { revalidate: 0 },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      if (!res.ok) continue;

      const data = (await res.json()) as InvidiousVideo;
      const formats = Array.isArray(data.adaptiveFormats)
        ? data.adaptiveFormats
        : [];
      const audioFormats = formats.filter(
        (f) => typeof f.type === 'string' && f.type.startsWith('audio/'),
      );

      if (audioFormats.length === 0) continue;

      // Prefer m4a for iOS, then highest bitrate.
      audioFormats.sort((a, b) => {
        const aM4a = a.type?.includes('mp4') ?? false;
        const bM4a = b.type?.includes('mp4') ?? false;
        if (aM4a && !bM4a) return -1;
        if (!aM4a && bM4a) return 1;
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

      const best = audioFormats[0];
      if (best?.url) {
        return {
          url: best.url,
          title: data.title || '',
          duration: Number(data.lengthSeconds || 0) || 0,
        };
      }
    } catch {
      // Try next instance.
    }
  }

  return null;
}

export async function GET(request: Request) {
  const rateLimitResponse = applyRateLimit(request, {
    keyPrefix: 'youtube-stream',
    max: 60,
    windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const searchParams = new URL(request.url).searchParams;
  const videoId = normalizeAndLimit(searchParams.get('v'), 32);

  if (!videoId || !isValidVideoId(videoId)) {
    return NextResponse.json(
      { error: 'Valid videoId is required' },
      { status: 400 },
    );
  }

  try {
    const primaryStream = await getStreamFromInvidious(videoId);
    if (primaryStream?.url) {
      return NextResponse.json(
        {
          videoId,
          url: primaryStream.url,
          title: primaryStream.title,
          duration: primaryStream.duration,
          provider: 'invidious',
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const fallbackStream = await getStreamFromYouTubei(videoId);
    if (fallbackStream?.url) {
      return NextResponse.json(
        {
          videoId,
          url: fallbackStream.url,
          mimeType: fallbackStream.mimeType,
          bitrate: fallbackStream.bitrate,
          provider: 'youtubei',
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      );
    }
  } catch (error) {
    logApiError('YouTube stream route error', error);
  }

  return NextResponse.json({ error: 'No audio stream found' }, { status: 404 });
}
