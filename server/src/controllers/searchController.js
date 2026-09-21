import axios from "axios";
import { directYoutubeSearch } from "../lib/youtubeSearch.js";

const STREAM_BASE = (process.env.STREAM_BASE_URL || "http://localhost:5002").replace(/\/+$/, "");

const PLAYLIST_REGEX = /\b(jukebox|full album|nonstop|non stop|compilation|all songs|top \d+|best of \d+|hour mix|\d+\s*hours?|\d+\s*min(?:s|utes)? mix|playlist|mashup mix)\b/i;
const VARIANT_REGEX = /\b(karaoke|instrumental|cover|reaction|tutorial|slowed|reverb|nightcore|remix|live|mashup|choreography|amv|lofi|reedits?)\b/i;

const SHORT_CLIP_MIN_SEC = 45;
const MAX_SINGLE_SONG_SEC = 540;
const MAX_SONG_SEC_BONUS = 720;

const OFFICIAL_CHANNEL_HINTS = [
  "topic",
  "vevo",
  "t-series",
  "sony music",
  "zee music",
  "saregama",
  "tips official",
  "hrithik music",
  "yrf music",
  "emi music",
  "universal music",
  "atlantic records",
  "warner music",
  "sonymusic",
  "sonymusicindia",
  "sonymusicsouth",
  "sonymusicvevo",
];

function normalization(input = "") {
  return String(input)
    .replace(/["“”'‘’]/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenScore(a = "", b = "") {
  const first = new Set(normalization(a).split(" ").filter(Boolean));
  const second = new Set(normalization(b).split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;
  let matches = 0;
  first.forEach((word) => {
    if (second.has(word)) matches++;
  });
  return matches / Math.max(first.size, second.size);
}

function isSingleTrack(duration) {
  if (!duration) return true;
  if (duration < SHORT_CLIP_MIN_SEC) return false;
  if (duration > MAX_SONG_SEC_BONUS) return false;
  return true;
}

function isPlaylist(title) {
  return PLAYLIST_REGEX.test(title ?? "");
}

function isVariant(title, rawQuery) {
  const titleLower = normalization(title);
  const queryLower = normalization(rawQuery);
  return VARIANT_REGEX.test(titleLower) && !VARIANT_REGEX.test(queryLower);
}

function scoreResult(query, item, { queryIntentRaw }) {
  const titleNorm = normalization(item.title);
  const channelNorm = normalization(item.channel ?? item.artist ?? "");
  const artistNorm = normalization(item.artist ?? "");
  const queryNorm = normalization(query);
  let score = 0;

  if (titleNorm && queryNorm && titleNorm.includes(queryNorm)) {
    score += 35;
  }
  score += tokenScore(queryNorm, titleNorm) * 30;

  if (queryIntentRaw?.title) {
    score += tokenScore(queryIntentRaw.title, titleNorm) * 20;
    if (queryNorm === titleNorm) score += 30;
  }

  if (queryIntentRaw?.artist && artistNorm) {
    score += tokenScore(queryIntentRaw.artist, artistNorm) * 10;
  }

  const hasHint = OFFICIAL_CHANNEL_HINTS.some((hint) => channelNorm.includes(hint));
  if (hasHint) score += 15;

  const duration = Number(item.duration || 0);
  if (duration > 0) {
    if (isSingleTrack(duration)) score += 10;
    else if (duration > MAX_SINGLE_SONG_SEC && duration < 1200) score -= 10;
    else if (duration >= 1200) score -= 30;
  }

  if (isVariant(item.title, query)) score -= 25;
  if (isPlaylist(item.title)) score -= 50;

  return score;
}

function scoreAndRank(query, candidates, { queryIntentRaw }) {
  return candidates
    .map((c) => ({
      ...c,
      score: scoreResult(query, c, { queryIntentRaw }),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((c) => c.score > -20);
}

export async function searchSongs(req, res) {
  const rawQuery = String(req.query.q ?? "").trim();
  const limit = Math.min(
    Math.max(Number.parseInt(req.query.limit, 10) || 12, 1),
    30
  );

  if (!rawQuery || rawQuery.length < 2 || rawQuery.length > 200) {
    return res.status(400).json({
      error: "Query must be between 2 and 200 characters",
      code: "INVALID_QUERY_LENGTH",
    });
  }

  const titleQuote = rawQuery.match(/["“]([^"”]+)["”]/)?.[1];
  const queryIntentRaw = {
    title: titleQuote || rawQuery.split(/[-|]/)[0]?.trim() || rawQuery,
    artist: req.query.artist?.trim() || req.query.a?.trim() || "",
  };

  const candidates = [];
  const seenIds = new Set();
  const queriesToTry = [
    rawQuery,
    titleQuote ? titleQuote : null,
    queryIntentRaw.title !== rawQuery ? queryIntentRaw.title : null,
  ].filter(Boolean);

  for (const q of queriesToTry) {
    let results = [];
    try {
      results = await directYoutubeSearch(q, limit + 5);
    } catch {
      results = [];
    }

    for (const raw of results) {
      const incoming = {
        id: String(raw?.id ?? raw?.videoId ?? "").trim(),
        title: String(raw?.title ?? "").trim(),
        artist: String(raw?.artist ?? raw?.uploader ?? raw?.channel ?? "Unknown artist").trim(),
        channel: String(raw?.channel ?? raw?.uploader ?? raw?.artist ?? "").trim(),
        thumbnail:
          raw?.thumbnail ??
          (raw?.id || raw?.videoId ? `https://i.ytimg.com/vi/${raw?.id ?? raw?.videoId}/hqdefault.jpg` : null),
        duration: Number(raw?.duration ?? 0),
        source: "youtube",
      };

      if (!incoming.id || !incoming.title) continue;
      if (seenIds.has(incoming.id)) continue;
      seenIds.add(incoming.id);
      candidates.push(incoming);
    }

    if (candidates.length >= limit * 2) break;
  }

  const ranked = scoreAndRank(rawQuery, candidates, { queryIntentRaw });
  const results = ranked.slice(0, limit).map(({ score, ...item }) => item);

  return res.json({
    source: "youtube",
    query: rawQuery,
    results,
  });
}

export async function getAudioStream(req, res) {
  const videoId = String(req.params.videoId ?? "").trim();
  const YT_ID_REGEX = /^[a-zA-Z0-9_-]{8,15}$/;
  if (!videoId || !YT_ID_REGEX.test(videoId)) {
    return res.status(400).json({ error: "Invalid videoId parameter", code: "INVALID_VIDEO_ID" });
  }

  try {
    const { data } = await axios.get(
      `${STREAM_BASE}/get-audio-url/${encodeURIComponent(videoId)}`,
      { timeout: 20000 }
    );
    const audioUrl = data?.audio_url ?? data?.audioUrl ?? data?.url ?? null;
    if (audioUrl) {
      return res.json({
        id: videoId,
        audio_url: audioUrl,
        title: data?.title,
        duration: data?.duration ?? 0,
      });
    }
    return res.json({
      id: videoId,
      audio_url: null,
      note: data?.note || data?.error || "stream-unavailable",
    });
  } catch (err) {
    // Return clean JSON without 502 crash so frontend can seamlessly fallback to YT Player
    return res.json({
      id: videoId,
      audio_url: null,
      note: "stream-unavailable",
    });
  }
}
