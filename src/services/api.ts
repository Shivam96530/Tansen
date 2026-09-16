import { DEMO_TRACKS, DEMO_LYRICS } from "../data/demo";
import type { LyricsResult, ServiceStatus, Track } from "../types";

/* ------------------------------------------------------------------
 * Service endpoints — identical wiring to the original architecture:
 *   Express API      → http://localhost:5001  (search, lyrics)
 *   Flask microservice → http://localhost:5002 (yt-dlp audio URLs)
 * Both fall back gracefully to a local demo catalogue when offline.
 * ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5001";
const STREAM_BASE = import.meta.env.VITE_STREAM_BASE_URL ?? "http://localhost:5002";

const timeout = (ms: number) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
};

/* ---------------- health ---------------- */

export async function checkHealth(): Promise<ServiceStatus> {
  const ping = async (url: string): Promise<"online" | "offline"> => {
    try {
      const t = timeout(2500);
      const res = await fetch(url, { signal: t.signal });
      t.done();
      return res.ok ? "online" : "offline";
    } catch {
      return "offline";
    }
  };
  const [api, stream] = await Promise.all([
    ping(`${API_BASE}/health`),
    ping(`${STREAM_BASE}/health`),
  ]);
  return { api, stream };
}

/* ---------------- search ----------------
 * Express → /api/search?q=  (proxies yt-dlp `ytsearch5:` on Flask,
 * Genius API metadata as fallback). */

function normalise(raw: any): Track | null {
  const id = raw?.id ?? raw?.videoId;
  const title = raw?.title;
  if (!id || !title) return null;
  return {
    id: String(id),
    title: String(title).replace(/\s+/g, " ").trim(),
    artist: raw.artist ?? raw.uploader ?? raw.channel ?? "Unknown artist",
    thumbnail: raw.thumbnail ?? (raw.id || raw.videoId ? `https://i.ytimg.com/vi/${raw.id ?? raw.videoId}/hqdefault.jpg` : null),
    duration: Number(raw.duration ?? 0),
    source: "youtube",
  };
}

export async function searchTracks(query: string): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];

  // 1 · Express API (canonical path)
  try {
    const t = timeout(12000);
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`, { signal: t.signal });
    t.done();
    if (res.ok) {
      const data = await res.json();
      const list = (data.results ?? data).map(normalise).filter(Boolean) as Track[];
      if (list.length) return list;
    }
  } catch {
    /* fall through */
  }

  // 2 · Direct to Flask microservice
  try {
    const t = timeout(12000);
    const res = await fetch(`${STREAM_BASE}/search?q=${encodeURIComponent(q)}`, { signal: t.signal });
    t.done();
    if (res.ok) {
      const data = await res.json();
      const list = (data.results ?? data).map(normalise).filter(Boolean) as Track[];
      if (list.length) return list;
    }
  } catch {
    /* fall through */
  }

  // 3 · Demo catalogue (offline mode)
  const needle = q.toLowerCase();
  const matches = DEMO_TRACKS.filter(
    (t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle)
  );
  return matches.length ? matches : DEMO_TRACKS.slice(0, 6);
}

/* ---------------- audio stream ----------------
 * Flask → /get-audio-url/<video_id>  (yt-dlp extracts the direct
 * .m4a stream URL — nothing is downloaded server-side). */

export async function getAudioUrl(videoId: string): Promise<string | null> {
  if (videoId.startsWith("demo-")) return null; // simulated playback
  try {
    const t = timeout(15000);
    const res = await fetch(`${STREAM_BASE}/get-audio-url/${encodeURIComponent(videoId)}`, {
      signal: t.signal,
    });
    t.done();
    if (res.ok) {
      const data = await res.json();
      return data.audio_url ?? data.audioUrl ?? data.url ?? null;
    }
  } catch {
    /* offline */
  }
  return null;
}

/* ---------------- lyrics ----------------
 * Express → /api/lyrics?q=  (genius.com search + cheerio scrape of
 * [data-lyrics-container="true"]). */

export async function getLyrics(track: Track): Promise<LyricsResult> {
  if (track.source === "demo") {
    return { lyrics: DEMO_LYRICS[track.id] ?? DEMO_LYRICS.default, title: track.title, artist: track.artist };
  }
  const q = `${track.title} ${track.artist}`.trim();
  try {
    const t = timeout(12000);
    const res = await fetch(`${API_BASE}/api/lyrics?q=${encodeURIComponent(q)}`, { signal: t.signal });
    t.done();
    if (res.ok) {
      const data = await res.json();
      if (data.lyrics) return { lyrics: data.lyrics, title: data.title, artist: data.artist };
    }
  } catch {
    /* fall through */
  }
  return { lyrics: "", title: track.title, artist: track.artist };
}
