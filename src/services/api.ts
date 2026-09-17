import { DEMO_TRACKS, DEMO_LYRICS } from "../data/demo";
import { dedupeTracks, songKey } from "../lib/dedupe";
import type { LyricsResult, ServiceStatus, Track } from "../types";

/* ------------------------------------------------------------------
 * Service endpoints — identical wiring to the original architecture:
 *   Express API      → http://localhost:5001  (search, lyrics)
 *   Flask microservice → http://localhost:5002 (yt-dlp audio URLs)
 * Both fall back gracefully to a local demo catalogue when offline.
 * ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:5001" : "");
// In production, never call localhost:5002 — Express proxies stream requests via STREAM_BASE_URL env var.
const STREAM_BASE = import.meta.env.VITE_STREAM_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:5002" : "");

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
  // Proxy the stream health check through Express (/api/stream-health)
  // so the browser never tries to contact localhost:5002 on deployed sites.
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
    thumbnail: raw.thumbnail ?? (raw.id || raw.videoId ? `https://i.ytimg.com/vi/${raw.id ?? raw.videoId}/hqdefault.jpg` : null),
    duration,
    source: "youtube",
  };
}

export async function searchTracks(query: string, limit = 12, allowDemoFallback = false): Promise<Track[]> {
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

  // 2 · Direct to Flask microservice
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

  // 3 · Demo catalogue (only if explicitly allowed, e.g. for offline demo testing)
  if (allowDemoFallback) {
    const needle = q.toLowerCase();
    const matches = DEMO_TRACKS.filter(
      (t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle)
    );
    return matches.length ? matches : DEMO_TRACKS.slice(0, 6);
  }

  return [];
}

/* ---------------- related tracks (radio) ----------------
 * Fetches songs related to a seed track for autoplay radio.
 * Uses multiple search queries and filters out already-heard songs. */

export async function getRelatedTracks(
  seed: Track,
  heard: Set<string>,
  count = 4
): Promise<Track[]> {
  // Clean channel names or video labels from seed info
  const cleanTitle = seed.title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleanArtist = seed.artist
    .replace(/ - Topic|VEVO|Official|Records|Channel/gi, "")
    .trim();

  const queries = [
    `${cleanTitle} single song`,
    `${cleanArtist || seed.artist} hit song`,
    `songs like ${cleanTitle}`,
  ];

  const picked: Track[] = [];
  const seenKeys = new Set<string>([songKey(seed)]);

  for (const q of queries) {
    if (picked.length >= count) break;
    try {
      const results = await searchTracks(q, 8);
      for (const t of results) {
        if (!isSingleTrack(t)) continue;
        const k = songKey(t);
        if (!seenKeys.has(k) && !heard.has(k)) {
          seenKeys.add(k);
          picked.push(t);
          if (picked.length >= count) break;
        }
      }
    } catch {
      /* skip failed query */
    }
  }

  // Shuffle so radio doesn't always start with the same song
  return picked.sort(() => Math.random() - 0.5);
}

/* ---------------- audio stream ----------------
 * Flask → /get-audio-url/<video_id>  (yt-dlp extracts the direct
 * .m4a stream URL — nothing is downloaded server-side). */

export async function getAudioUrl(videoId: string): Promise<string | null> {
  if (videoId.startsWith("demo-")) return null; // simulated playback

  // 1 · Express API proxy (/api/get-audio-url/:id) — works on deployed site
  //     because Express knows the real Python engine URL from STREAM_BASE_URL env var.
  try {
    const t = timeout(20000);
    const res = await fetch(`${API_BASE}/api/get-audio-url/${encodeURIComponent(videoId)}`, {
      signal: t.signal,
    });
    t.done();
    if (res.ok) {
      const data = await res.json();
      const url = data.audio_url ?? data.audioUrl ?? data.url ?? null;
      if (url) return url;
    }
  } catch {
    /* fall through */
  }

  // 2 · Direct Flask stream engine (local dev only when VITE_STREAM_BASE_URL is set)
  if (STREAM_BASE && STREAM_BASE !== "") {
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
 * Express → /api/lyrics?q=  (genius.com search + cheerio scrape of
 * [data-lyrics-container="true"]). */

export async function getLyrics(track: Track): Promise<LyricsResult> {
  if (track.source === "demo") {
    return { lyrics: DEMO_LYRICS[track.id] ?? DEMO_LYRICS.default, title: track.title, artist: track.artist };
  }
  try {
    const t = timeout(12000);
    const queryParams = new URLSearchParams({
      q: track.title,
      artist: track.artist || "",
    });
    const res = await fetch(`${API_BASE}/api/lyrics?${queryParams.toString()}`, { signal: t.signal });
    t.done();
    if (res.ok) {
      const data = await res.json();
      if (data.lyrics) return { lyrics: data.lyrics, title: data.title || track.title, artist: data.artist || track.artist };
    }
  } catch {
    /* fall through */
  }
  return { lyrics: "", title: track.title, artist: track.artist };
}
