import axios from "axios";
import * as cheerio from "cheerio";

const GENIUS_API = "https://api.genius.com";
const LRCLIB_API = "https://lrclib.net/api";
const STREAM_BASE = (process.env.STREAM_BASE_URL || "http://localhost:5002").replace(/\/+$/, "");
const GENIUS_KEY = process.env.GENIUS_API_KEY || process.env.GENIUS_ACCESS_TOKEN || "";

/* ------------------------------------------------------------------ helpers */

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(a = "", b = "") {
  const first = new Set(normalize(a).split(" ").filter(Boolean));
  const second = new Set(normalize(b).split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;
  let matches = 0;
  first.forEach((word) => {
    if (second.has(word)) matches++;
  });
  return matches / Math.max(first.size, second.size);
}

function durationScore(requested, actual) {
  if (!requested || !actual) return 0.5;
  const difference = Math.abs(requested - actual);
  if (difference > 60) return 0;
  if (difference <= 2) return 1;
  return Math.max(0, 1 - difference / 60);
}

function matchConfidence(candidate, track) {
  const titleScore = tokenScore(candidate.title, track.title);
  const artistScore = candidate.artist && track.artist ? tokenScore(candidate.artist, track.artist) : 0.5;
  const durScore = durationScore(track.duration, candidate.duration);
  return titleScore * 0.55 + artistScore * 0.3 + durScore * 0.15;
}

function candidateQueries(rawTitle = "", rawChannel = "", rawArtist = "") {
  const candidates = [];
  const seen = new Set();
  const add = (query) => {
    const cleaned = String(query ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned || cleaned.length < 2 || seen.has(cleaned)) return;
    seen.add(cleaned);
    candidates.push(cleaned);
  };

  const quotedMatch = rawTitle.match(/["“]([^"”]{2,120})["”]/) || rawTitle.match(/'([^']{2,120})'/);
  const quotedTitle = quotedMatch?.[1]?.trim();
  const afterColon = rawTitle.includes(":")
    ? rawTitle.split(":").slice(1).join(":").split("|")[0].trim()
    : "";
  const titleParts = rawTitle.split("|").map((part) => part.trim()).filter(Boolean);
  const channelClean = String(rawChannel || "").replace(/ - Topic|VEVO|Official|Records|Channel/gi, "").trim();
  const artistClean = String(rawArtist || "").replace(/ - Topic|VEVO|Official|Records|Channel/gi, "").trim();

  if (quotedTitle) {
    add(artistClean ? `${quotedTitle} ${artistClean}` : quotedTitle);
    add(`${quotedTitle} official`);
  }
  if (afterColon) {
    add(artistClean ? `${afterColon} ${artistClean}` : afterColon);
    add(`${afterColon} official`);
  }
  if (titleParts.length > 0) {
    add(titleParts.slice(0, Math.min(titleParts.length, 2)).join(" "));
  }
  add(artistClean ? `${rawTitle} ${artistClean}` : rawTitle);
  add(`${rawTitle} official`);
  if (channelClean && artistClean && channelClean !== artistClean) {
    add(`${rawTitle} ${artistClean}`);
  }
  return candidates.slice(0, 6);
}

async function fetchGeniusHits(query, limit = 6) {
  if (!GENIUS_KEY) return [];
  try {
    const { data } = await axios.get(`${GENIUS_API}/search`, {
      params: { q: query },
      headers: { Authorization: `Bearer ${GENIUS_KEY}` },
      timeout: 7000,
    });
    const hits = data?.response?.hits ?? [];
    return hits.slice(0, limit).map((hit) => hit.result).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchPythonLyrics(query) {
  try {
    const { data } = await axios.get(`${STREAM_BASE}/lyrics`, {
      params: { query },
      timeout: 9000,
    });
    if (!data?.lyrics) return null;
    return {
      title: data.title || query,
      artist: data.artist || "",
      lyrics: data.lyrics,
      syncedLyrics: null,
      source: "genius-py",
      duration: data.duration || 0,
    };
  } catch {
    return null;
  }
}

async function fetchLrclibExact(title, artist, duration) {
  if (!title || !artist) return null;
  try {
    const params = {
      track_name: title,
      artist_name: artist,
    };
    if (duration > 0) {
      params.duration = duration;
    }
    const { data } = await axios.get(`${LRCLIB_API}/get`, {
      params,
      headers: { "User-Agent": "Tansen-Music-App/2.1.0" },
      timeout: 7000,
    });
    if (!data?.plainLyrics && !data?.syncedLyrics) return null;
    return {
      title: data.trackName || title,
      artist: data.artistName || artist,
      album: data.albumName,
      duration: data.duration,
      lyrics: data.plainLyrics ?? "",
      syncedLyrics: data.syncedLyrics ?? null,
      source: "lrclib",
    };
  } catch {
    return null;
  }
}

async function fetchLrclibSearch(query, limit = 6) {
  if (!query) return [];
  try {
    const res = await axios.get(`${LRCLIB_API}/search`, {
      params: { q: query },
      headers: { "User-Agent": "Tansen-Music-App/2.1.0" },
      timeout: 7000,
    });
    const items = Array.isArray(res.data) ? res.data.slice(0, limit) : [];
    return items.map((item) => ({
      title: item.trackName,
      artist: item.artistName,
      album: item.albumName,
      duration: item.duration,
      lyrics: item.plainLyrics ?? "",
      syncedLyrics: item.syncedLyrics ?? null,
      source: "lrclib",
      confidence: null,
    }));
  } catch {
    return [];
  }
}

function selectBestMatch(track, candidates, { minConfidence = 0.72 } = {}) {
  const scored = candidates
    .map((parent) => ({
      ...parent,
      confidence: matchConfidence(parent, track),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (!best || best.confidence < minConfidence) return null;
  return best;
}

/* ------------------------------------------------------------------ route */

export async function getLyrics(req, res) {
  const rawTitle = String(req.query.q ?? "").trim();
  const rawArtist = String(req.query.artist ?? "").trim();
  const rawChannel = String(req.query.channel ?? "").trim();
  const duration = Number(req.query.duration ?? req.query.durationSec ?? 0) || 0;

  if (!rawTitle) {
    return res.status(400).json({ error: "Missing query param ?q=" });
  }

  const queries = candidateQueries(rawTitle, rawChannel, rawArtist);
  const track = {
    title: rawTitle,
    artist: rawArtist,
    channel: rawChannel,
    duration,
  };

  // 1 · LRCLIB exact match using title and artist
  if (track.title && track.artist) {
    const exact = await fetchLrclibExact(track.title, track.artist, duration);
    if (exact) {
      const confidence = matchConfidence(exact, track);
      if (confidence >= 0.72) {
        return res.json({
          lyrics: exact.lyrics,
          syncedLyrics: exact.syncedLyrics,
          title: exact.title,
          artist: exact.artist,
          album: exact.album,
          source: "lrclib",
          confidence: Number(confidence.toFixed(3)),
          note: "exact-match",
        });
      }
    }
  }

  // 2 · Genius API search candidates + Python lyrics resolution
  if (GENIUS_KEY) {
    const candidates = [];
    for (const query of queries.slice(0, 3)) {
      const hits = await fetchGeniusHits(query, 5);
      for (const hit of hits) {
        candidates.push({
          title: hit.title,
          artist: hit.primary_artist?.name ?? "",
          url: hit.url,
          duration: 0,
        });
      }
    }

    const best = selectBestMatch(track, candidates, { minConfidence: 0.72 });
    if (best) {
      const fetched = await fetchPythonLyrics(`${best.title} ${best.artist}`);
      if (fetched && fetched.lyrics) {
        const confidence = matchConfidence(fetched, track);
        if (confidence >= 0.72) {
          return res.json({
            lyrics: fetched.lyrics,
            syncedLyrics: null,
            title: fetched.title,
            artist: fetched.artist,
            source: "genius",
            confidence: Number(confidence.toFixed(3)),
            note: "genius-py",
          });
        }
      }

      // Conservative Genius page scrape if Python service has no lyrics
      if (best.url) {
        try {
          const page = await axios.get(best.url, {
            timeout: 8000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          });
          const html = page.data;
          const $ = cheerio.load(html);
          const blocks = [];
          $('div[data-lyrics-container="true"]').each((_, el) => {
            $(el).find("br").replaceWith("\n");
            blocks.push($(el).text().trim());
          });
          const scrapedLyrics = blocks.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n");
          if (scrapedLyrics) {
            return res.json({
              lyrics: scrapedLyrics,
              syncedLyrics: null,
              title: best.title,
              artist: best.artist,
              url: best.url,
              source: "genius",
              confidence: Number(best.confidence.toFixed(3)),
              note: "genius-scrape",
            });
          }
        } catch {
          /* continue to LRCLIB */
        }
      }
    }
  }

  // 3 · LRCLIB search ranking across candidates
  const lrclibCandidates = [];
  for (const query of queries.slice(0, 3)) {
    const items = await fetchLrclibSearch(query, 5);
    lrclibCandidates.push(...items);
  }

  const bestLrc = selectBestMatch(track, lrclibCandidates, { minConfidence: 0.72 });
  if (bestLrc && (bestLrc.lyrics || bestLrc.syncedLyrics)) {
    return res.json({
      lyrics: bestLrc.lyrics,
      syncedLyrics: bestLrc.syncedLyrics,
      title: bestLrc.title,
      artist: bestLrc.artist,
      album: bestLrc.album,
      source: "lrclib",
      confidence: Number(bestLrc.confidence.toFixed(3)),
      note: "scored-search",
    });
  }

  // 4 · Low confidence: Return empty lyrics instead of wrong song (avoids "Tum Hi Tum Ho" mismatch)
  return res.json({
    lyrics: "",
    syncedLyrics: null,
    title: track.title,
    artist: track.artist,
    source: "none",
    note: "lyrics-not-confident",
  });
}
