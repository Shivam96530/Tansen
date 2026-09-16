import type { Track } from "../types";

/* ------------------------------------------------------------------
 * Song identity
 * YouTube search returns many uploads of the SAME song:
 *   "Kesariya (Official Video)" · "Kesariya | Lyrics" · "Kesariya 4K HD"
 * These all collapse to one identity so the queue never repeats a song.
 * ------------------------------------------------------------------ */

const NOISE = [
  "official video", "official music video", "official audio", "official lyric video",
  "official lyrics video", "official trailer", "official song", "official",
  "full video song", "full video", "full audio", "full song", "full movie song",
  "video song", "lyric video", "lyrics video", "lyrics", "lyric", "audio song",
  "audio", "video", "hd", "4k", "1080p", "720p", "hq", "remastered",
  "with lyrics", "songs", "song", "mp3", "new song", "latest song",
  "slowed and reverb", "slowed reverb", "slowed", "reverb", "bass boosted",
  "extended", "visualizer", "colour coded", "color coded", "eng sub",
  "netflix", "t series", "tseries", "hindi", "tamil", "telugu",
];

/** Normalise a raw upload title down to a comparable song name. */
export function normaliseTitle(raw: string): string {
  let s = (raw || "").toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\{[^}]*\}/g, " ");
  s = s.split("|")[0];
  s = s.replace(/\b(feat|ft|featuring|with)\b.*$/i, " ");
  for (const word of NOISE) {
    s = s.replace(new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "g"), " ");
  }
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return s;
}

/** Stable identity key for a song (ignores which channel uploaded it). */
export function songKey(track: Track): string {
  const t = normaliseTitle(track.title);
  return t || track.title.toLowerCase().trim() || track.id;
}

/** Token-overlap similarity, 0 → 1. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const A = new Set(a.split(" ").filter((w) => w.length > 2));
  const B = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.min(A.size, B.size);
}

/** True when two tracks are the same song (possibly different uploads). */
export function isSameSong(a: Track | null, b: Track | null): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  return similarity(songKey(a), songKey(b)) >= 0.82;
}

/**
 * Collapse duplicate uploads, keeping the best candidate of each song.
 * Preference: has a real duration → shorter, cleaner title → earlier rank.
 */
export function dedupeTracks(tracks: Track[]): Track[] {
  const out: Track[] = [];
  const betterOf = (a: Track, b: Track): Track => {
    const score = (t: Track) =>
      (t.duration > 0 ? 2 : 0) +
      (/(official|audio)/i.test(t.title) ? 1 : 0) -
      Math.min(t.title.length / 90, 1);
    return score(b) > score(a) ? b : a;
  };
  for (const t of tracks) {
    const idx = out.findIndex((o) => isSameSong(o, t));
    if (idx === -1) out.push(t);
    else out[idx] = betterOf(out[idx], t);
  }
  return out;
}

/** Remove anything the listener has already heard this session. */
export function excludeHeard(tracks: Track[], heard: Set<string>): Track[] {
  return tracks.filter((t) => !heard.has(songKey(t)));
}
