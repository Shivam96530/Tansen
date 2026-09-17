import axios from "axios";

const STREAM_BASE = process.env.STREAM_BASE_URL || "http://localhost:5002";
const GENIUS_API = "https://api.genius.com";

const normalise = (raw) => {
  const id = raw?.id ?? raw?.videoId;
  const title = raw?.title;
  if (!id || !title) return null;
  return {
    id: String(id),
    title: String(title).replace(/\s+/g, " ").trim(),
    artist: raw.artist ?? raw.uploader ?? raw.channel ?? "Unknown artist",
    thumbnail:
      raw.thumbnail ??
      `https://i.ytimg.com/vi/${raw.id ?? raw.videoId}/hqdefault.jpg`,
    duration: Number(raw.duration ?? 0),
    source: "youtube",
  };
};

/**
 * GET /api/search?q=
 * 1 · Flask stream engine — yt-dlp `ytsearch5:` (title, channel, thumbnails)
 * 2 · Genius API — metadata fallback when the stream engine is offline
 */
export async function searchSongs(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing query param ?q=" });

  try {
    const { data } = await axios.get(`${STREAM_BASE}/search`, {
      params: { q },
      timeout: 15000,
    });
    const results = (data.results || data || []).map(normalise).filter(Boolean);
    if (results.length) {
      return res.json({ source: "youtube", query: q, results });
    }
  } catch {
    /* stream engine offline — fall through to Genius */
  }

  try {
    const key = process.env.GENIUS_API_KEY;
    if (key) {
      const { data } = await axios.get(`${GENIUS_API}/search`, {
        params: { q },
        headers: { Authorization: `Bearer ${key}` },
        timeout: 8000,
      });
      const results = (data?.response?.hits || []).slice(0, 8).map((h) => ({
        id: h.result.id,
        title: h.result.title,
        artist: h.result.primary_artist?.name ?? "Unknown artist",
        thumbnail: h.result.song_art_image_thumbnail_url ?? null,
        duration: 0,
        source: "genius",
      }));
      return res.json({ source: "genius", query: q, results });
    }
  } catch {
    /* Genius unavailable */
  }

  return res.json({ source: "none", query: q, results: [] });
}

/**
 * GET /api/get-audio-url/:videoId
 * Proxies to the Flask stream engine so the browser never calls localhost:5002 directly.
 */
export async function getAudioStream(req, res) {
  const videoId = req.params.videoId;
  if (!videoId) return res.status(400).json({ error: "Missing videoId parameter" });
  try {
    const { data } = await axios.get(
      `${STREAM_BASE}/get-audio-url/${encodeURIComponent(videoId)}`,
      { timeout: 15000 }
    );
    return res.json(data);
  } catch (err) {
    // Return a clean 200 with audio_url: null so the frontend can seamlessly
    // use the browser YouTube Player without red 502 Bad Gateway errors.
    return res.json({ id: videoId, audio_url: null, note: "stream-unavailable" });
  }
}
