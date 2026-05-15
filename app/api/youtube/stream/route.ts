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
  const tryIndex = parseInt(searchParams.get('try') || '0', 10);

  if (!videoId || !isValidVideoId(videoId)) {
    return NextResponse.json(
      { error: 'Valid videoId is required' },
      { status: 400 },
    );
  }

  // Gather all candidates (url + provider + mimeType + bitrate) for native retry
  type Candidate = { url: string; provider: string; mimeType: string; bitrate: number };
  const candidates: Candidate[] = [];

  try {
    // Invidious candidates (multiple)
    for (const baseUrl of INVIDIOUS_INSTANCES) {
      try {
        const ctrl = new AbortController();
        const tId = setTimeout(() => ctrl.abort(), 7000);
        const res = await fetch(`${baseUrl}/api/v1/videos/${videoId}`, {
          headers: { 'User-Agent': 'Albify/1.0' },
          next: { revalidate: 0 },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(tId));
        if (!res.ok) continue;

        const data = (await res.json()) as InvidiousVideo;
        const formats = Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [];
        const audio = formats.filter(f => typeof f.type === 'string' && f.type.startsWith('audio/'));

        audio.sort((a, b) => {
          const aM4a = a.type?.includes('mp4') ?? false;
          const bM4a = b.type?.includes('mp4') ?? false;
          if (aM4a && !bM4a) return -1;
          if (!aM4a && bM4a) return 1;
          return (b.bitrate || 0) - (a.bitrate || 0);
        });

        for (const f of audio) {
          if (f.url && !candidates.some(c => c.url === f.url)) {
            candidates.push({
              url: f.url,
              provider: 'invidious',
              mimeType: f.type || 'audio/mp4',
              bitrate: f.bitrate || 0,
            });
          }
        }
      } catch { /* next instance */ }
    }

    // youtubei candidates
    try {
      const yt = await getYouTube();
      for (const opts of [
        { type: 'audio' as const, quality: 'best', format: 'mp4' },
        { type: 'audio' as const, quality: 'best' },
      ]) {
        const fmt = await withTimeout(yt.getStreamingData(videoId, opts), 7000);
        if (fmt?.url && !candidates.some(c => c.url === fmt.url)) {
          candidates.push({
            url: fmt.url,
            provider: 'youtubei',
            mimeType: fmt.mime_type || 'audio/mp4',
            bitrate: fmt.bitrate || 0,
          });
        }
      }
    } catch { /* youtubei failed */ }
  } catch (error) {
    logApiError('YouTube stream route error', error);
  }

  if (candidates.length === 0) {
    return NextResponse.json({ error: 'No audio stream found' }, { status: 404 });
  }

  // If try=n requested and exists, return that specific candidate as primary
  const selectedIndex = Math.max(0, Math.min(tryIndex, candidates.length - 1));
  const primary = candidates[selectedIndex];

  // Reorder: selected first, rest follow (no duplicates)
  const reordered = [primary, ...candidates.filter((_, i) => i !== selectedIndex)];

  return NextResponse.json(
    {
      videoId,
      url: primary.url,
      provider: primary.provider,
      mimeType: primary.mimeType,
      bitrate: primary.bitrate,
      candidates: reordered.map(c => ({
        url: c.url,
        provider: c.provider,
        mimeType: c.mimeType,
        bitrate: c.bitrate,
      })),
      candidateCount: reordered.length,
      selectedIndex,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
