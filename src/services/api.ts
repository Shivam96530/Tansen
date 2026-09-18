import { dedupeTracks, songKey } from "../lib/dedupe";
import type { LyricsResult, Track } from "../types";

/* ------------------------------------------------------------------
 * Service endpoints:
 *   Express API (canonical bridge) → /api/search, /api/lyrics, /api/get-audio-url
 * In production, requests use same-origin relative paths (/api/...).
 * ------------------------------------------------------------------ */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const STREAM_BASE = (import.meta.env.VITE_STREAM_BASE_URL || "").replace(/\/+$/, "");

const timeout = (ms: number) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
};

/* ---------------- health ---------------- */

export async function checkHealth(): Promise<{ api: boolean; stream: boolean }> {
  const ping = async (url: string): Promise<boolean> => {
    try {
      const t = timeout(2500);
      const res = await fetch(url, { signal: t.signal });
      t.done();
      return res.ok;
    } catch {
      return false;
    }
  };
  const [api, stream] = await Promise.all([
    ping(`${API_BASE}/health`),
    ping(`${API_BASE}/api/stream-health`),
  ]);
  return { api, stream };
}

/* ---------------- search ---------------- */
const PLAYLIST_REGEX = /\b(jukebox|full album|nonstop|non stop|compilation|all songs|top \d+|best of \d+|hour mix|\d+\s*hours?|\d+\s*min(?:s|utes)? mix|playlist|mashup mix)\b/i;

export function isSingleTrack(t: Track): boolean {
  if (t.duration > 660 || (t.duration > 0 && t.duration < 45)) return false;
  if (PLAYLIST_REGEX.test(t.title)) return false;
  return true;
}

function normalise(raw: any): Track | null {
  const id = raw?.id ?? raw?.videoId;
  const title = raw?.title;
  if (!id || !title) return null;
  const duration = Number(raw.duration ?? 0);
  if (duration > 660 || (duration > 0 && duration < 45)) return null;
  if (PLAYLIST_REGEX.test(String(title))) return null;

  return {
    id: String(id),
    title: String(title).replace(/\s+/g, " ").trim(),
    artist: raw.artist ?? raw.uploader ?? raw.channel ?? "Unknown artist",
    channel: raw.channel ?? raw.uploader ?? raw.artist ?? "",
    thumbnail: raw.thumbnail ?? (raw.id || raw.videoId ? `https://i.ytimg.com/vi/${raw.id ?? raw.videoId}/hqdefault.jpg` : null),
    duration,
    source: "youtube",
  };
}

export async function searchTracks(query: string, limit = 12): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];

  // 1 · Express API (canonical path)
  try {
    const t = timeout(12000);
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: t.signal });
    t.done();
    if (res.ok) {
      const data = await res.json();
      const list = (data.results ?? data).map(normalise).filter(Boolean) as Track[];
      const filtered = dedupeTracks(list.filter(isSingleTrack));
      if (filtered.length) return filtered;
    }
  } catch {
    /* fall through */
  }

  // 2 · Direct to Flask microservice (dev fallback only)
  if (STREAM_BASE) {
    try {
      const t = timeout(12000);
      const res = await fetch(`${STREAM_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: t.signal });
      t.done();
      if (res.ok) {
        const data = await res.json();
        const list = (data.results ?? data).map(normalise).filter(Boolean) as Track[];
        const filtered = dedupeTracks(list.filter(isSingleTrack));
        if (filtered.length) return filtered;
      }
    } catch {
      /* fall through */
    }
  }

  return [];
}

/* ---------------- related tracks (radio) ----------------
 * Fetches songs related to a seed track for autoplay radio.
 * Uses multiple search queries and filters out already-heard songs. */

export async function getRelatedTracks(
  seed: Track,
  heard: Set<string>,
  count = 4,
  contextQuery = ""
): Promise<Track[]> {
  // Strip record label channels so they don't pollute similarity queries
  const LABEL_RE = /\b(t-?series|sony\s*music|zee\s*music|saregama|tips\s*official|vevo|yrf|warner\s*music|universal\s*music|speed\s*records)\b/i;
  let artist = (seed.artist || seed.channel || "")
    .replace(/\s*-\s*topic\s*$/i, "")
    .replace(/\s*vevo\b/i, "")
    .trim();
  if (LABEL_RE.test(artist)) artist = "";

  const cleanTitle = seed.title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const intent = contextQuery.trim();
  const queries = [
    intent && intent,
    artist && `${artist} popular songs`,
    artist && `${artist} hits song`,
    cleanTitle && `songs like ${cleanTitle}`,
    intent && `${intent} mix songs`,
    cleanTitle && `${cleanTitle} type songs`,
  ].filter(Boolean) as string[];

  const picked: Track[] = [];
  const seenKeys = new Set<string>([songKey(seed)]);
  heard.forEach((k) => seenKeys.add(k));

  for (const q of queries) {
    if (picked.length >= count) break;
    try {
      const found = await searchTracks(q, 6);
      for (const t of found) {
        const key = songKey(t);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          picked.push(t);
          if (picked.length >= count) break;
        }
      }
    } catch {
      /* skip failed query */
    }
  }

  return picked.sort(() => Math.random() - 0.5);
}

/* ---------------- audio stream ----------------
 * Flask → /get-audio-url/<video_id> (yt-dlp extracts the direct
 * .m4a stream URL — nothing is downloaded server-side). */

export async function getAudioUrl(videoId: string): Promise<string | null> {
  // 1 · Express API proxy (/api/get-audio-url/:id) — works on deployed site
  try {
    const t = timeout(20000);
    const res = await fetch(`${API_BASE}/api/get-audio-url/${encodeURIComponent(videoId)}`, {
      signal: t.signal,
    });
    t.done();
    if (res.ok) {
      const data = await res.json();
      const url = data.audio_url ?? data.audioUrl ?? data.url ?? data.proxy_url ?? null;
      if (url) return url;
    }
  } catch {
    /* fall through */
  }

  // 2 · Direct Flask stream engine (local dev fallback only)
  if (STREAM_BASE) {
    try {
      const t = timeout(20000);
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
  }

  return null;
}

/* ---------------- lyrics ----------------
 * Express → /api/lyrics?q= (LRCLIB exact + Genius + cheerio scrape). */

export async function getLyrics(track: Track): Promise<LyricsResult> {
  try {
    const t = timeout(12000);
    const queryParams = new URLSearchParams({
      q: track.title,
      artist: track.artist || "",
      channel: track.channel || "",
      duration: String(track.duration || 0),
    });
    const res = await fetch(`${API_BASE}/api/lyrics?${queryParams.toString()}`, { signal: t.signal });
    t.done();
    if (res.ok) {
      const data = await res.json();
      if (data.lyrics) {
        return {
          lyrics: data.lyrics,
          syncedLyrics: data.syncedLyrics ?? null,
          title: data.title || track.title,
          artist: data.artist || track.artist,
          source: data.source,
          confidence: data.confidence,
        };
      }
    }
  } catch {
    /* fall through */
  }
  return { lyrics: "", title: track.title, artist: track.artist };
}
