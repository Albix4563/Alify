import { NextResponse } from 'next/server';
import {
  applyRateLimit,
  logApiError,
  normalizeAndLimit,
} from '@/lib/api-security';

const STREAMER_URL = process.env.ALBIFY_STREAMER_URL || '';

function isValidVideoId(videoId: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
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

  if (!STREAMER_URL) {
    return NextResponse.json(
      { error: 'Streamer not configured. Set ALBIFY_STREAMER_URL env var.' },
      { status: 503 },
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(`${STREAMER_URL}/extract?v=${videoId}`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { error: 'Stream extraction failed', detail: text },
        { status: res.status },
      );
    }

    const data = await res.json();

    if (!data.audioUrl) {
      return NextResponse.json(
        { error: 'No audio stream found' },
        { status: 404 },
      );
    }

    // Se il microservizio supporta proxy, usiamolo per bypassare CORS/referrer
    // Altrimenti restituiamo l'URL diretto (dipende dal client Android/iOS che yt-dlp emula)
    const proxyUrl = `${STREAMER_URL}/proxy?url=${encodeURIComponent(data.audioUrl)}`;

    // Per ora restituiamo entrambi: url diretto e proxy
    // Il frontend può provare diretto prima, poi fallback a proxy
    return NextResponse.json(
      {
        videoId,
        url: data.audioUrl,
        proxyUrl,
        provider: 'yt-dlp',
        mimeType: data.mimeType || 'audio/mp4',
        bitrate: data.audioBitrate || 0,
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        candidates: [
          {
            url: data.audioUrl,
            provider: 'yt-dlp',
            mimeType: data.mimeType || 'audio/mp4',
            bitrate: data.audioBitrate || 0,
          },
        ],
        candidateCount: 1,
        selectedIndex: 0,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    logApiError('YouTube stream route error', error);
    return NextResponse.json(
      { error: 'Stream extraction failed' },
      { status: 500 },
    );
  }
}
