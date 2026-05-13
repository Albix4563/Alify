import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

let aiInstance: GoogleGenAI | null = null;
function getAi() {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' });
  }
  return aiInstance;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body.prompt;
    if (!prompt) {
      return NextResponse.json({ error: 'Manca la prompt' }, { status: 400 });
    }

    const aiPrompt = `
      Genera una lista di 10 canzoni basate su questa richiesta: "${prompt}".
      La tua risposta DEVE ESSERE un array JSON, niente markdown o preamboli.
      L'output deve rispettare questo formato:
      [
        { "title": "Nome Canzone", "artist": "Nome Artista" }
      ]
    `;

    const response = await getAi().models.generateContent({
      model: 'gemini-2.5-flash',
      contents: aiPrompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    let resultList = [];
    if (response.text) {
      resultList = JSON.parse(response.text);
    }

    const API_KEY = process.env.YOUTUBE_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;

    if (!API_KEY) {
      throw new Error("Manca la chiave API di YouTube");
    }

    const tracks = [];
    // Only search the first 10
    for (const item of resultList.slice(0, 10)) {
      const q = encodeURIComponent(`${item.title} ${item.artist} official audio or video`);
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${q}&type=video&key=${API_KEY}`);
      if (!res.ok) continue;

      const data = await res.json();
      if (data.items && data.items.length > 0) {
        const snippet = data.items[0].snippet;
        tracks.push({
          videoId: data.items[0].id.videoId,
          title: snippet.title,
          channelTitle: snippet.channelTitle,
          thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
        });
      }
    }

    return NextResponse.json({ tracks });

  } catch (err: any) {
    console.error("Smart playlist error:", err);
    return NextResponse.json({ error: 'Errore durante la generazione della playlist' }, { status: 500 });
  }
}
