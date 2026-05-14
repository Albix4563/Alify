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

const VALID_PLAYLIST_ID = /^[a-zA-Z0-9_-]{10,100}$/;
const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

function isAllowedYouTubeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_YOUTUBE_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object') return body as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function buildGooglePlaylistItemsUrl(apiKey: string, playlistId: string): string {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('playlistId', playlistId);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function buildGooglePlaylistMetaUrl(apiKey: string, playlistId: string): string {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', playlistId);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

export async function POST(request: Request) {
  const rateLimitResponse = applyRateLimit(request, {
    keyPrefix: 'youtube-import',
    max: 10,
    windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await safeJson(request);
    const url = normalizeAndLimit(body?.url, 2048);

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!isAllowedYouTubeUrl(url)) {
      return NextResponse.json({ error: "Unsupported URL type. Only YouTube is supported." }, { status: 400 });
    }

    const urlObj = new URL(url);
    const playlistId = urlObj.searchParams.get("list");

    if (!playlistId || !VALID_PLAYLIST_ID.test(playlistId)) {
      return NextResponse.json({ error: "Invalid YouTube Playlist URL (missing list parameter)" }, { status: 400 });
    }

    try {
      const yt = await getYouTube();
      const playlist = await yt.getPlaylist(playlistId);
      
      const playlistTitle = sanitizeText(
        playlist.info.title || "Imported YouTube Playlist",
        220,
      );

      const tracks = playlist.videos.map((item: any) => {
        const thumbs = Array.isArray(item.thumbnails) ? item.thumbnails : [];
        const defaultThumb = thumbs[0]?.url || "";
        const highThumb = thumbs[thumbs.length - 1]?.url || defaultThumb;

        return {
          source: "youtube",
          originalId: item.id,
          title: sanitizeText(item.title?.text || "Unknown Title", 220),
          channelTitle: sanitizeText(item.author?.name || "Unknown Channel", 220),
          thumbnailUrl: highThumb,
          videoId: item.id,
          found: true,
        };
      }).filter((t: any) => t.title !== "Private video" && t.title !== "Deleted video");

      return NextResponse.json({
        playlistTitle,
        source: "youtube",
        tracks
      });
      
    } catch (ytError: any) {
        logApiError("Youtubei import API error", ytError);
        
        // Fallback to official API
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (apiKey) {
            const res = await fetch(buildGooglePlaylistItemsUrl(apiKey, playlistId), {
              signal: AbortSignal.timeout(8000),
            });
            let data;
            try { data = await res.json(); } catch (e) { throw new Error('Official API returned non-JSON'); }

            if (!res.ok) {
              throw new Error(`Official API Error: ${data?.error?.message || "Unknown error"}`);
            }

            const listRes = await fetch(buildGooglePlaylistMetaUrl(apiKey, playlistId), {
              signal: AbortSignal.timeout(8000),
            });
            let listData: any = {};
            try { listData = await listRes.json(); } catch (e) {}
            const fallbackTitle = sanitizeText(
              listData.items?.[0]?.snippet?.title || "Imported YouTube Playlist",
              220,
            );

            const fallbackTracks = (Array.isArray(data.items) ? data.items : []).map((item: any) => ({
              source: "youtube",
              originalId: item?.contentDetails?.videoId || "",
              title: sanitizeText(item?.snippet?.title || "Unknown Title", 220),
              channelTitle: sanitizeText(item?.snippet?.videoOwnerChannelTitle || "Unknown Channel", 220),
              thumbnailUrl: item?.snippet?.thumbnails?.high?.url || item?.snippet?.thumbnails?.default?.url || "",
              videoId: item?.contentDetails?.videoId || "",
              found: true
            })).filter((t: any) => t.videoId && t.title !== "Private video" && t.title !== "Deleted video");

            return NextResponse.json({
              playlistTitle: fallbackTitle,
              source: "youtube",
              tracks: fallbackTracks
            });
        }
        
        throw new Error(ytError.message || "Failed to fetch playlist");
    }
  } catch (error) {
    logApiError("Import API error", error);
    return NextResponse.json(
      { error: 'Unable to import playlist right now. Please try again.' },
      { status: 500 },
    );
  }
}
