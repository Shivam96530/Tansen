import axios from "axios";

const GENIUS_API = "https://api.genius.com";
const LRCLIB_API = "https://lrclib.net/api";

/**
 * Strip common YouTube noise, remix tags, and video metadata so search
 * engines find the actual song.
 */
function cleanQuery(raw) {
  let s = (raw || "").toString().trim();
  // If query has " | ", often the title is first and movie/artist is second
  s = s.split("|")[0];
  // Strip parentheses and brackets like (Official Video), [4K], (From Movie)
  s = s.replace(/\(.*?\)/g, " ").replace(/\[.*?\]/g, " ");
  // Strip noise words
  s = s.replace(
    /\b(official|music|video|audio|lyric(?:al)?|full\s*song|hd|4k|1080p|remastered|ft\.?|feat\.?|slowed|reverb)\b/gi,
    " "
  );
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Fetch lyrics from LRCLIB (free open database, highly reliable).
 */
async function fetchLrclib(query) {
  if (!query || query.length < 2) return null;
  try {
    const res = await axios.get(`${LRCLIB_API}/search`, {
      params: { q: query },
      headers: { "User-Agent": "Tansen-Music-App/1.0" },
      timeout: 5000,
    });
    const items = res.data;
    if (Array.isArray(items) && items.length > 0) {
      const hit = items.find((i) => i.plainLyrics) || items[0];
      if (hit && hit.plainLyrics) {
        return {
          title: hit.trackName,
          artist: hit.artistName,
          lyrics: hit.plainLyrics,
          syncedLyrics: hit.syncedLyrics || null,
          source: "lrclib",
        };
      }
    }
  } catch {
    /* fallback */
  }
  return null;
}

/**
 * Fetch lyrics via Genius API + Python stream engine.
 */
async function fetchGenius(query) {
  const key = process.env.GENIUS_API_KEY || process.env.GENIUS_ACCESS_TOKEN;
  if (!key) return null;
  try {
    const searchRes = await axios.get(`${GENIUS_API}/search`, {
      params: { q: query },
      headers: { Authorization: `Bearer ${key}` },
      timeout: 4000,
    });
    const hit = searchRes.data?.response?.hits?.[0]?.result;
    if (!hit) return null;

    const streamBase = process.env.STREAM_BASE_URL || "http://localhost:5002";
    const pyRes = await axios.get(`${streamBase}/lyrics`, {
      params: { query: `${hit.primary_artist?.name || ""} ${hit.title || ""}`.trim() },
      timeout: 5000,
    });
    if (pyRes.data?.lyrics) {
      return {
        title: hit.title,
        artist: hit.primary_artist?.name,
        url: hit.url,
        lyrics: pyRes.data.lyrics,
        source: "genius",
      };
    }
  } catch {
    /* fallback */
  }
  return null;
}

/**
 * GET /api/lyrics?q=
 * Priority 1: Genius (as requested)
 * Priority 2: LRCLIB (instant fallback so lyrics show for every song)
 * Priority 3: Query variations (stripped artist/movie)
 * Always returns 200 with clean JSON to prevent console 502 errors.
 */
export async function getLyrics(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing query param ?q=" });

  const cleaned = cleanQuery(q);

  // Execute Genius and LRCLIB in parallel with quick timeouts
  const [geniusRes, lrcRes] = await Promise.allSettled([
    fetchGenius(cleaned),
    fetchLrclib(cleaned),
  ]);

  // 1 · Priority: Genius
  if (geniusRes.status === "fulfilled" && geniusRes.value?.lyrics) {
    return res.json(geniusRes.value);
  }

  // 2 · High-reliability fallback: LRCLIB
  if (lrcRes.status === "fulfilled" && lrcRes.value?.lyrics) {
    return res.json(lrcRes.value);
  }

  // 3 · Try secondary query variations if original had artist or hyphens
  const variations = [];
  if (q.includes("-")) {
    variations.push(cleanQuery(q.split("-")[0]));
    variations.push(cleanQuery(q.split("-").slice(1).join(" ")));
  }
  const rawClean = q.replace(/[\(\[\{].*?[\)\]\}]/g, "").trim();
  if (rawClean && rawClean !== cleaned) {
    variations.push(rawClean);
  }

  for (const v of variations) {
    if (v && v.length >= 3) {
      const extra = await fetchLrclib(v);
      if (extra && extra.lyrics) {
        return res.json(extra);
      }
    }
  }

  // Clean empty response (200 status prevents console errors)
  return res.json({
    title: cleaned,
    artist: "",
    lyrics: "",
    note: "no-lyrics-found",
  });
}
