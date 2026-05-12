import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY is not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoCategoryId=10&maxResults=30&regionCode=IT&key=${apiKey}`);
    
    if (!res.ok) {
      if (res.status === 403) {
         console.warn("YouTube API quota exceeded or forbidden, falling back to alternative API...");
         try {
             // Fallback to Piped API
             const pipedRes = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=all`);
             if (pipedRes.ok) {
                 const contentType = pipedRes.headers.get('content-type');
                 if (contentType && contentType.includes('application/json')) {
                     const pipedData = await pipedRes.json();
                     const items = pipedData.items.filter((item: any) => item.type === 'stream').map((item: any) => {
                         const videoId = item.url.replace('/watch?v=', '');
                         return {
                             id: { videoId },
                             snippet: {
                                 title: item.title,
                                 channelTitle: item.uploaderName,
                                 thumbnails: {
                                     high: { url: item.thumbnail },
                                     default: { url: item.thumbnail }
                                 }
                             }
                         };
                     });
                     return NextResponse.json({ items });
                 } else {
                     console.error("Fallback API returned non-JSON response");
                 }
             }
         } catch (fallbackError) {
             console.error("Fallback API also failed:", fallbackError);
         }
      }
      
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || 'Unknown error';
      return NextResponse.json(
        { error: `YouTube API returned ${res.status}: ${errorMessage}` }, 
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Youtube API error:", error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch from YouTube API';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
