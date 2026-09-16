import axios from "axios";

const GENIUS_API = "https://api.genius.com";

/**
 * Strip YouTube video title noise so Genius search can find the song.
 * e.g. "Tujhe Sochta Hoon (Lyrical Audio) | KK | Jannat 2 Sony Music India"
 *   → "Tujhe Sochta Hoon KK"
 */
function cleanQuery(raw) {
  return raw
    .split("|")[0]                                        // keep only before first pipe
    .replace(/\(.*?\)/g, "")                              // strip (Lyrical Audio), (Official Video) etc.
    .replace(/\[.*?\]/g, "")                              // strip [4K], [HD] etc.
    .replace(/\b(official|video|audio|lyric(?:al)?|full\s*song|hd|4k|ft\.?|feat\.?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * GET /api/lyrics?q=
 * Genius search → top hit → fetch lyrics via Genius /songs/{id} API
 * (no page scraping — avoids Cloudflare 403 blocks on genius.com).
 */
export async function getLyrics(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing query param ?q=" });

  const key = process.env.GENIUS_API_KEY;
  if (!key) {
    return res
      .status(503)
      .json({ error: "GENIUS_API_KEY is not configured on the API bridge." });
  }

  const headers = { Authorization: `Bearer ${key}` };
  const geniusQuery = cleanQuery(q);

  try {
    // Step 1: search for top matching song (use cleaned query, not raw YouTube title)
    const searchRes = await axios.get(`${GENIUS_API}/search`, {
      params: { q: geniusQuery },
      headers,
      timeout: 8000,
    });

    const hit = searchRes.data?.response?.hits?.[0]?.result;
    if (!hit) return res.status(404).json({ error: "No Genius match found." });

    // Step 2: fetch full song data from the API (has lyrics_state and description)
    const songRes = await axios.get(`${GENIUS_API}/songs/${hit.id}`, {
      params: { text_format: "plain" },
      headers,
      timeout: 8000,
    });

    const song = songRes.data?.response?.song;
    if (!song) return res.status(404).json({ error: "Song details not found." });

    // Step 3: Use the Python stream engine's lyricsgenius as fallback if available
    const streamBase = process.env.STREAM_BASE_URL || "http://localhost:5002";
    let lyrics = "";

    try {
      const pyRes = await axios.get(`${streamBase}/lyrics`, {
        params: { query: `${hit.primary_artist?.name} ${hit.title}` },
        timeout: 12000,
      });
      lyrics = pyRes.data?.lyrics || "";
    } catch {
      // Python engine unavailable or no Genius token — use description as fallback
      lyrics = song.description?.plain || "";
    }

    if (!lyrics) {
      return res.status(404).json({ error: "Lyrics not available for this song." });
    }

    return res.json({
      title: song.title,
      artist: song.primary_artist?.name,
      url: song.url,
      lyrics,
    });
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Lyrics resolution failed.", detail: String(err?.message || err) });
  }
}
