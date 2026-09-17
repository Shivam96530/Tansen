import axios from "axios";

const GENIUS_API = "https://api.genius.com";
const LRCLIB_API = "https://lrclib.net/api";

/**
 * Strip YouTube video title noise so search can find the clean song identity.
 * e.g. "Harry Styles - As It Was (Official Video)" → "Harry Styles As It Was"
 *      "Tujhe Sochta Hoon (Lyrical Audio) | KK | Jannat 2" → "Tujhe Sochta Hoon KK"
 */
function cleanQuery(raw) {
  return raw
    .split("|")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\b(official|music|video|audio|lyric(?:al)?|full\s*song|hd|4k|ft\.?|feat\.?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Fetch lyrics from LRCLIB (free open lyrics service, no key required).
 */
async function fetchLrclib(query) {
  try {
    const res = await axios.get(`${LRCLIB_API}/search`, {
      params: { q: query },
      headers: { "User-Agent": "Tansen-Music-App/1.0" },
      timeout: 8000,
    });
    const items = res.data;
    if (Array.isArray(items) && items.length > 0) {
      // Pick first item that has plainLyrics
      const hit = items.find((i) => i.plainLyrics) || items[0];
      if (hit && hit.plainLyrics) {
        return {
          title: hit.trackName,
          artist: hit.artistName,
          lyrics: hit.plainLyrics,
          syncedLyrics: hit.syncedLyrics || null,
        };
      }
    }
  } catch {
    /* fallback to next provider */
  }
  return null;
}

/**
 * GET /api/lyrics?q=
 * 1. Queries LRCLIB (fast, free, no API key needed).
 * 2. Fallbacks to Genius API if configured.
 * 3. Fallbacks to Python stream engine.
 * Always answers 200 with clean JSON (never 502/503) so the console stays clean.
 */
export async function getLyrics(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing query param ?q=" });

  const cleaned = cleanQuery(q);

  // 1 · Try Genius API first (using configured GENIUS_API_KEY or GENIUS_ACCESS_TOKEN)
  const key = process.env.GENIUS_API_KEY || process.env.GENIUS_ACCESS_TOKEN;
  if (key) {
    try {
      const headers = { Authorization: `Bearer ${key}` };
      const searchRes = await axios.get(`${GENIUS_API}/search`, {
        params: { q: cleaned },
        headers,
        timeout: 8000,
      });

      const hit = searchRes.data?.response?.hits?.[0]?.result;
      if (hit) {
        // Fetch lyrics via Python engine lyricsgenius scraper
        const streamBase = process.env.STREAM_BASE_URL || "http://localhost:5002";
        try {
          const pyRes = await axios.get(`${streamBase}/lyrics`, {
            params: { query: `${hit.primary_artist?.name} ${hit.title}` },
            timeout: 10000,
          });
          const pyLyrics = pyRes.data?.lyrics;
          if (pyLyrics) {
            return res.json({
              title: hit.title,
              artist: hit.primary_artist?.name,
              url: hit.url,
              lyrics: pyLyrics,
              source: "genius",
            });
          }
        } catch {
          /* try next */
        }
      }
    } catch {
      /* try next */
    }
  }

  // 2 · Try Python stream engine directly with cleaned query
  const streamBase = process.env.STREAM_BASE_URL || "http://localhost:5002";
  try {
    const pyRes = await axios.get(`${streamBase}/lyrics`, {
      params: { query: cleaned },
      timeout: 10000,
    });
    if (pyRes.data?.lyrics) {
      return res.json({
        title: pyRes.data.title || cleaned,
        artist: pyRes.data.artist || "",
        lyrics: pyRes.data.lyrics,
        source: "genius-py",
      });
    }
  } catch {
    /* try next */
  }

  // 3 · Fallback to LRCLIB (if Genius is rate-limited, missing token, or has no lyrics)
  const lrc = await fetchLrclib(cleaned);
  if (lrc && lrc.lyrics) {
    return res.json({
      title: lrc.title,
      artist: lrc.artist,
      lyrics: lrc.lyrics,
      syncedLyrics: lrc.syncedLyrics,
      source: "lrclib",
    });
  }

  // Graceful empty response (status 200 keeps console clean)
  return res.json({
    title: cleaned,
    artist: "",
    lyrics: "",
    note: "no-lyrics-found",
  });
}
