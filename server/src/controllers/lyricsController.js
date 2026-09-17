import axios from "axios";

const GENIUS_API = "https://api.genius.com";
const LRCLIB_API = "https://lrclib.net/api";

/**
 * Intelligent candidate generator that extracts the core song title and artist
 * from complex YouTube video titles (e.g. "Full Song: KHAIRIYAT (BONUS TRACK) | CHHICHHORE | Sushant, Shraddha | Pritam, Amitabh B|Arijit Singh")
 */
function getCandidates(raw, rawArtist = "") {
  let s = (raw || "").trim();

  // If rawArtist is a YouTube record label channel, ignore it as artist
  const isLabel = /t-series|sony\s*music|zee\s*music|yrf|tips|saregama|vevo|speed\s*records|white\s*hill|aditya\s*music/i.test(rawArtist);
  const cleanArtist = isLabel ? "" : rawArtist.trim();

  // Strip common YouTube prefixes
  s = s.replace(/^(full\s+song|lyrical\s+(video|audio)|official\s+(video|audio)|video\s+song|audio\s+song|song|audio)\s*:\s*/i, "");

  // Strip brackets/parentheses like (From "Movie"), (Official Video), [4K], (Lyrics)
  const sNoParens = s.replace(/[\(\[\{].*?[\)\]\}]/g, " ");

  // Strip noise words
  const clean = sNoParens
    .replace(/\b(official|music|video|audio|lyric(?:al)?|full\s*song|hd|4k|1080p|remastered|slowed|reverb|from\s+movie|from\s+[a-z0-9]+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = [];
  const add = (c) => {
    const v = (c || "").replace(/\s+/g, " ").trim();
    if (v.length >= 2 && !candidates.includes(v)) {
      candidates.push(v);
    }
  };

  if (cleanArtist) add(`${clean} ${cleanArtist}`);
  add(clean);

  // Split by pipe |
  if (s.includes("|")) {
    const parts = s.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const p0 = parts[0]
        .replace(/[\(\[\{].*?[\)\]\}]/g, "")
        .replace(/\b(official|music|video|audio|lyric(?:al)?|full\s*song|hd|4k)\b/gi, "")
        .trim();
      add(p0);
      if (cleanArtist) add(`${p0} ${cleanArtist}`);

      for (let i = 1; i < parts.length; i++) {
        const pN = parts[i].replace(/[\(\[\{].*?[\)\]\}]/g, "").trim();
        if (pN.length > 0 && pN.length < 35 && !/official|video|audio|lyrics/i.test(pN)) {
          add(`${p0} ${pN}`);
        }
      }
    }
  }

  // Split by hyphen -
  if (s.includes("-")) {
    const dashParts = s.split("-").map((p) => p.trim()).filter(Boolean);
    if (dashParts.length >= 2) {
      const d0 = dashParts[0].replace(/[\(\[\{].*?[\)\]\}]/g, "").trim();
      const d1 = dashParts[1]
        .replace(/[\(\[\{].*?[\)\]\}]/g, "")
        .replace(/\b(official|music|video|audio|lyrics?)\b/gi, "")
        .trim();
      add(`${d0} ${d1}`);
      add(`${d1} ${d0}`);
      add(d1);
      add(d0);
    }
  }

  // First 3 words as a concise title fallback
  const words = clean.split(" ");
  if (words.length > 3) {
    add(words.slice(0, 3).join(" "));
  }

  return candidates.slice(0, 6);
}

/**
 * Fetch lyrics from LRCLIB (free open lyrics service, no key required).
 */
async function fetchLrclib(query) {
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
        };
      }
    }
  } catch {
    /* fallback to next */
  }
  return null;
}

/**
 * GET /api/lyrics?q=&artist=
 * Uses multi-candidate queries across Genius, LRCLIB, Python engine, and lyrics.ovh
 */
export async function getLyrics(req, res) {
  const q = (req.query.q || "").toString().trim();
  const artist = (req.query.artist || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing query param ?q=" });

  const candidates = getCandidates(q, artist);

  // 1 · Genius API (Primary: checks top candidate queries)
  const key = process.env.GENIUS_API_KEY || process.env.GENIUS_ACCESS_TOKEN;
  if (key) {
    for (const cand of candidates.slice(0, 3)) {
      try {
        const searchRes = await axios.get(`${GENIUS_API}/search`, {
          params: { q: cand },
          headers: { Authorization: `Bearer ${key}` },
          timeout: 5000,
        });
        const hit = searchRes.data?.response?.hits?.[0]?.result;
        if (hit) {
          const streamBase = process.env.STREAM_BASE_URL || "http://localhost:5002";
          try {
            const pyRes = await axios.get(`${streamBase}/lyrics`, {
              params: { query: `${hit.primary_artist?.name} ${hit.title}` },
              timeout: 6000,
            });
            if (pyRes.data?.lyrics) {
              return res.json({
                title: hit.title,
                artist: hit.primary_artist?.name,
                url: hit.url,
                lyrics: pyRes.data.lyrics,
                source: "genius",
              });
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 2 · LRCLIB (High reliability: searches candidate queries)
  for (const cand of candidates) {
    const lrc = await fetchLrclib(cand);
    if (lrc && lrc.lyrics) {
      return res.json({
        title: lrc.title,
        artist: lrc.artist,
        lyrics: lrc.lyrics,
        syncedLyrics: lrc.syncedLyrics,
        source: "lrclib",
      });
    }
  }

  // 3 · Python stream engine directly
  const streamBase = process.env.STREAM_BASE_URL || "http://localhost:5002";
  for (const cand of candidates.slice(0, 2)) {
    try {
      const pyRes = await axios.get(`${streamBase}/lyrics`, {
        params: { query: cand },
        timeout: 6000,
      });
      if (pyRes.data?.lyrics) {
        return res.json({
          title: pyRes.data.title || cand,
          artist: pyRes.data.artist || "",
          lyrics: pyRes.data.lyrics,
          source: "genius-py",
        });
      }
    } catch {
      /* ignore */
    }
  }

  // 4 · lyrics.ovh (Extra fallback for English tracks)
  for (const cand of candidates.slice(0, 3)) {
    try {
      const parts = cand.split(" ");
      if (parts.length >= 2) {
        const a = parts[0];
        const t = parts.slice(1).join(" ");
        const ovhRes = await axios.get(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`,
          { timeout: 4000 }
        );
        if (ovhRes.data?.lyrics) {
          return res.json({
            title: t,
            artist: a,
            lyrics: ovhRes.data.lyrics,
            source: "lyrics.ovh",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Graceful empty response (200 OK prevents console errors)
  return res.json({
    title: candidates[0] || q,
    artist: artist || "",
    lyrics: "",
    note: "no-lyrics-found",
  });
}
