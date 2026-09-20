import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import * as cheerio from "cheerio";

const execFileAsync = promisify(execFile);
const ytSubtitleCache = new Map();

const GENIUS_API = "https://api.genius.com";
const LRCLIB_API = "https://lrclib.net/api";
const NETEASE_SEARCH_API = "https://music.163.com/api/search/get";
const NETEASE_LYRIC_API = "https://music.163.com/api/song/lyric";
const SAAVN_API = "https://saavn.dev/api"; // free, no key — best coverage for Hindi/Indian/regional catalog
const LYRICS_OVH_API = "https://api.lyrics.ovh/v1"; // free, no key — simple artist/title lookup, good Western fallback
const STREAM_BASE = (process.env.STREAM_BASE_URL || "http://localhost:5002").replace(/\/+$/, "");
const GENIUS_KEY = process.env.GENIUS_API_KEY || process.env.GENIUS_ACCESS_TOKEN || "";

async function fetchYouTubeCaptionsDirect(videoId) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  if (ytSubtitleCache.has(videoId)) return ytSubtitleCache.get(videoId);

  // 1. Try Flask endpoint first
  try {
    const res = await axios.get(`${STREAM_BASE}/subtitles/${encodeURIComponent(videoId)}`, { timeout: 3000 });
    if (res.data?.syncedLyrics) {
      ytSubtitleCache.set(videoId, res.data);
      return res.data;
    }
  } catch {
    /* fallback to standalone python script */
  }

  // 2. Direct python script fallback (100% reliable)
  try {
    const scriptPath1 = path.resolve(process.cwd(), "..", "python", "get_subtitles.py");
    const scriptPath2 = path.resolve(process.cwd(), "python", "get_subtitles.py");
    const targetScript = fs.existsSync(scriptPath1) ? scriptPath1 : scriptPath2;
    if (fs.existsSync(targetScript)) {
      const { stdout } = await execFileAsync("python", [targetScript, videoId], { timeout: 12000 });
      const parsed = JSON.parse(stdout.trim() || "{}");
      if (parsed.syncedLyrics) {
        ytSubtitleCache.set(videoId, parsed);
        return parsed;
      }
    }
  } catch {
    /* pass */
  }

  ytSubtitleCache.set(videoId, null);
  return null;
}

// Confidence tiers: try the strict pass first (safe, high-precision match).
// If nothing clears it, fall back to a looser pass and clearly mark the
// result as a "best guess" rather than returning nothing.
const STRICT_CONFIDENCE = 0.72;
const RELAXED_CONFIDENCE = 0.55;

/* ------------------------------------------------------------------ text cleanup */

// Words/phrases that show up in YouTube titles but never in a song title.
// Stripping these before we build search queries is the single biggest
// lever for match quality — almost every miss traces back to noise like
// "(Official Video)" or "[4K Lyrics]" getting sent to the lyrics APIs.
const NOISE_TERMS = [
  "official video", "official music video", "official audio", "official lyric video",
  "official visualizer", "lyric video", "lyrics video", "music video", "visualizer",
  "official", "full video", "full song", "video song", "hd video", "4k video",
  "4k", "hd", "mv", "audio", "with lyrics", "lyrics", "lirik", "letra", "paroles",
  "color coded lyrics", "romanized", "romanization", "sub español", "english translation",
  "cover", "live performance", "live version", "live", "remastered", "remaster",
  "explicit", "clean version", "clean", "radio edit", "extended mix", "extended version",
  "album version", "from the album", "soundtrack", "ost", "teaser", "trailer",
  "behind the scenes", "making of", "reaction", "dance practice", "choreography",
  "performance video", "stage mix", "fancam", "new song", "new release", "latest song",
  "dance scene", "dance clip", "dancing", "dance", "scene", "clip", "tribute", "edit",
  "edits", "amv", "edit audio", "status", "whatsapp status", "reels", "reel", "shorts",
];

const NOISE_REGEX = new RegExp(
  `\\b(${NOISE_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

// Channel/label suffixes and record labels that are publishers, not artists.
const LABEL_SUFFIX_RE = /\b(vevo|official|records?|music|channel|- topic)\b/gi;
const RECORD_LABEL_RE = /\b(t-?series|sony\s*music|zee\s*music|saregama|tips\s*official|tips|yrf|warner\s*music|universal\s*music|speed\s*records|geet\s*mp3|white\s*hill|desi\s*music\s*factory|vyrl|aditya\s*music|lahari\s*music|svf|venus|shemaroo)\b/i;

function isRecordLabel(str = "") {
  const s = String(str || "").trim();
  return RECORD_LABEL_RE.test(s) || /\b(songs?|hits?|jukebox|classics?|collection|station)\b/i.test(s);
}

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PREFIX_NOISE_RE = /^\s*(?:full\s*(?:video\s*)?song|video\s*song|official\s*(?:music\s*)?(?:video|audio|lyric\s*video)?|lyric(?:al)?\s*(?:video)?|audio\s*song|song|audio|video)\s*[:\-]\s*/i;

// Strips bracketed content and known noise phrases, leaving just the song title.
function stripNoise(text = "") {
  let cleaned = String(text);
  cleaned = cleaned.replace(PREFIX_NOISE_RE, "");
  cleaned = cleaned.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ");
  cleaned = cleaned.replace(NOISE_REGEX, " ");
  cleaned = cleaned.replace(/[|•·–—]+/g, " - ");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  cleaned = cleaned.replace(/^[\s\-:|]+|[\s\-:|]+$/g, "");
  return cleaned;
}

// Discards metadata-only placeholders (e.g. NetEase Chinese credit lines, engineer suffixes, and placeholders without lyrics)
const CREDIT_LINE_RE = /^(?:[\u4e00-\u9fa5]{1,12}\s*[:：]|(?:作词|作曲|编曲|制作|监制|录音|混音|母带|吉他|贝斯|鼓|键盘|弦乐|和声|原唱|翻唱|人声|主唱|伴唱|配唱|统筹|企划|出品|发行|音频|工程|乐手|编写|填词|谱曲|混音师|母带师|录音师|制作人)[\u4e00-\u9fa5\s]*[:：]|(?:lyricist|lyrics(?:\s*by)?|composer|composed\s*by|written\s*by|produced\s*by|arranged\s*by|mixed\s*by|mastered\s*by|engineered\s*by|recording\s*engineer|mixing\s*engineer|mastering\s*engineer|vocals?|backing\s*vocals?|lead\s*vocals?|guitars?|bass|drums?|keys|synths?|synthesizer|piano|recorded\s*(?:at|by)|mixed\s*at|mastered\s*at|audio\s*engineer|studio|label|publisher)\s*[:：\-])/i;

function isUsableLyrics(text = "", queryHasChinese = false) {
  if (!text) return false;
  const stripped = text.replace(/\[\d{1,2}:\d{2}[^\]]*\]/gi, "").trim();
  const lines = stripped.split("\n").map((l) => l.trim()).filter(Boolean);
  const contentLines = lines.filter((l) =>
    !CREDIT_LINE_RE.test(l) &&
    !/^(纯音乐|instrumental|no lyrics|lyrics not available)/i.test(l) &&
    !/^\[(?:intro|outro|verse\s*\d*|chorus\s*\d*|bridge|hook|music|instrumental|credits?)\]\s*$/i.test(l)
  );
  if (contentLines.length < 4 || contentLines.join(" ").length < 50) return false;
  if (lines.length > 0 && contentLines.length / lines.length < 0.4 && contentLines.length < 8) return false;

  // Language consistency: if query does not contain Chinese characters,
  // reject lyrics where Chinese characters dominate (prevents NetEase Chinese false matches)
  if (!queryHasChinese) {
    const joined = contentLines.join(" ");
    const chineseCount = (joined.match(/[\u4e00-\u9fa5]/g) || []).length;
    const totalChars = joined.replace(/\s+/g, "").length;
    if (totalChars > 20 && (chineseCount / totalChars) > 0.20) {
      return false;
    }
  }

  return true;
}

function cleanArtistName(text = "") {
  const str = String(text || "").trim();
  if (isRecordLabel(str)) return "";
  return str
    .replace(LABEL_SUFFIX_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Most music-video titles are literally "Artist - Title".
function splitArtistTitleDash(text = "") {
  const match = text.match(/^\s*([^-–—]{1,60}?)\s*[-–—]\s*(.{2,120})$/);
  if (!match) return null;
  const [, left, right] = match;
  if (!left.trim() || !right.trim()) return null;
  return { left: left.trim(), right: right.trim() };
}

function extractFeat(text = "") {
  const m = text.match(/\b(?:feat\.?|ft\.?|featuring|singers?|sung by)\s*[:\-]?\s*([^,\-|(]+)/i);
  return m ? m[1].trim() : "";
}

/* ------------------------------------------------------------------ similarity scoring */

function tokenScore(a = "", b = "") {
  const first = new Set(normalize(a).split(" ").filter(Boolean));
  const second = new Set(normalize(b).split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;
  let matches = 0;
  first.forEach((word) => {
    if (second.has(word)) matches++;
  });
  const minSize = Math.min(first.size, second.size);
  const maxSize = Math.max(first.size, second.size);
  return Math.max(matches / maxSize, (matches / minSize) * 0.85);
}

// Character-bigram Dice coefficient for fuzzy near-matches.
function diceCoefficient(a = "", b = "") {
  const bigrams = (s) => {
    const clean = normalize(s).replace(/\s+/g, "");
    const arr = [];
    for (let i = 0; i < clean.length - 1; i++) arr.push(clean.slice(i, i + 2));
    return arr;
  };
  const first = bigrams(a);
  const secondFull = bigrams(b);
  const second = [...secondFull];
  if (!first.length || !second.length) return 0;
  let matches = 0;
  for (const bg of first) {
    const idx = second.indexOf(bg);
    if (idx !== -1) {
      matches++;
      second.splice(idx, 1);
    }
  }
  return (2 * matches) / (first.length + secondFull.length);
}

function titleSimilarity(a, b) {
  const word = tokenScore(a, b);
  const dice = diceCoefficient(a, b);
  const hi = Math.max(word, dice);
  const lo = Math.min(word, dice);
  return hi * 0.7 + lo * 0.3;
}

function durationScore(requested, actual, hasSynced = false) {
  if (!requested || !actual) return 0.7;
  const difference = Math.abs(requested - actual);
  if (difference <= 3) return 1.0;
  if (difference <= 8) return 0.95;
  if (difference <= 15) return 0.85;
  if (hasSynced) {
    if (difference <= 30) return 0.6;
    if (difference <= 60) return 0.35;
    return 0.1;
  }
  if (difference <= 30) return 0.8;
  if (difference <= 60) return 0.65;
  return 0.4;
}

function matchConfidence(candidate, track) {
  // Script / language coherence guard:
  // If track title and artist do NOT contain Chinese characters, reject candidates with Chinese titles or artists
  const trackHasChinese = /[\u4e00-\u9fa5]/.test(String(track.title || "") + " " + String(track.artist || ""));
  const candHasChinese = /[\u4e00-\u9fa5]/.test(String(candidate.title || "") + " " + String(candidate.artist || ""));
  if (!trackHasChinese && candHasChinese) {
    return 0.0;
  }

  const cleanTitles = track.cleanTitles || [];
  const titleCandidates = [track.title, stripNoise(track.title), ...cleanTitles].filter(Boolean);
  const titleScores = titleCandidates.map((t) => titleSimilarity(candidate.title, t));
  const titleScore = Math.max(...titleScores, 0);

  let artistScore = 0.6;
  const candArtist = String(candidate.artist || "").toLowerCase().trim();
  const rawTitleLower = String(track.title || "").toLowerCase();

  if (candArtist) {
    const candWords = candArtist.split(/\s+/).filter(Boolean);
    // If candArtist is a single short word (e.g. "tony", "sia", "air", "dj"), require exact word token matching
    if (candWords.length === 1 && candArtist.length <= 5) {
      const cleanTrackArtist = String(track.artist || "").toLowerCase().trim();
      if (cleanTrackArtist === candArtist) {
        artistScore = 0.95;
      } else {
        const titleTokens = rawTitleLower.split(/[\s\-–—|:]+/).filter(Boolean);
        if (titleTokens.includes(candArtist)) {
          artistScore = 0.85;
        } else {
          artistScore = 0.5;
        }
      }
    } else if (rawTitleLower.includes(candArtist)) {
      artistScore = 0.95;
    } else {
      const candTokens = candArtist.split(/[\s,&/]+/).filter((w) => w.length > 2);
      const matchedTokens = candTokens.filter((tok) => rawTitleLower.includes(tok));
      if (candTokens.length > 0 && matchedTokens.length === candTokens.length) {
        artistScore = 0.95;
      } else if (matchedTokens.length > 0) {
        artistScore = 0.85;
      } else if (track.artist && !isRecordLabel(track.artist)) {
        artistScore = titleSimilarity(candidate.artist, track.artist);
      } else if (isRecordLabel(track.artist)) {
        artistScore = 0.75;
      }
    }
  } else if (!track.artist || isRecordLabel(track.artist)) {
    artistScore = 0.75;
  }

  const hasSynced = Boolean(candidate.syncedLyrics);
  const durScore = durationScore(track.duration, candidate.duration, hasSynced);

  // Synced lyrics: duration matching is essential to prevent playing an album cut on an edited video
  if (hasSynced && track.duration > 20 && candidate.duration > 20) {
    const diff = Math.abs(track.duration - candidate.duration);
    let score = titleScore * 0.45 + artistScore * 0.25 + durScore * 0.30;
    // Perfect duration alignment bonus (within 4 seconds)
    if (diff <= 4 && titleScore >= 0.75) {
      score = Math.min(1.0, score + 0.12);
    }
    // Severe duration mismatch penalty for synced lyrics (> 25s difference)
    if (diff > 25) {
      score = Math.min(score, 0.68);
    }
    return score;
  }

  // Plain lyrics: standard text scoring
  if (titleScore >= 0.85 && artistScore >= 0.85) {
    return Math.max(titleScore * 0.65 + artistScore * 0.35, titleScore * 0.55 + artistScore * 0.3 + durScore * 0.15);
  }

  return titleScore * 0.55 + artistScore * 0.3 + durScore * 0.15;
}

/* ------------------------------------------------------------------ candidate generation */

function deriveCandidates(rawTitle = "", rawChannel = "", rawArtist = "") {
  const pairs = [];
  const cleanTitles = [];
  const seen = new Set();
  const add = (title, artist, weight) => {
    const t = stripNoise(String(title || "")).trim();
    const a = cleanArtistName(String(artist || "")).trim();
    if (!t) return;
    if (!cleanTitles.includes(t)) cleanTitles.push(t);
    const key = `${t.toLowerCase()}|${a.toLowerCase()}`;
    if (seen.has(key)) {
      const existing = pairs.find((p) => `${p.title.toLowerCase()}|${p.artist.toLowerCase()}` === key);
      if (existing) existing.weight = Math.min(1, existing.weight + 0.15);
      return;
    }
    seen.add(key);
    pairs.push({ title: t, artist: a, weight });
  };

  const channelClean = cleanArtistName(rawChannel);
  const artistClean = cleanArtistName(rawArtist);
  const feat = extractFeat(rawTitle);

  // 1. Pipe / delimiter segments (very common in Indian & Asian catalog):
  // "Full Song: Tujhe Kitna Chahne Lage | Kabir Singh | Mithoon Feat. Arijit Singh | Shahid K, Kiara A"
  // "Tu Pyar Hai Kisi Aur Ka (Full Song):Aamir K, Pooja B| Anuradha P, Kumar Sanu| Dil Hai Ke Manta Nahin"
  // "Kishore Kumar: Pyar Deewana Hota Hai Mastana Hota Hai | Dard Geet Bollywood | 70s Ols Song"
  const segments = rawTitle.split(/[|•·–—]+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    let mainTitle = "";
    let subTitle = "";
    if (segments[0].includes(":")) {
      const seg0Parts = segments[0].split(":");
      const part0 = stripNoise(seg0Parts[0]);
      const part1 = stripNoise(seg0Parts.slice(1).join(":"));
      if (PREFIX_NOISE_RE.test(seg0Parts[0].trim() + ":")) {
        mainTitle = part1;
        if (part1) {
          if (feat) add(part1, feat, 0.95);
          if (artistClean) add(part1, artistClean, 0.9);
          add(part1, "", 0.95);
        }
      } else {
        // [Artist]: [Title] (e.g. Kishore Kumar: Pyar Deewana Hota Hai)
        if (part1) {
          add(part1, part0, 0.95);
          add(part1, "", 0.95);
          const p1Words = part1.split(/\s+/);
          if (p1Words.length >= 4) {
            const shortP1 = p1Words.slice(0, 4).join(" ");
            add(shortP1, part0, 0.95);
            add(shortP1, "", 0.95);
          }
          mainTitle = part1;
        }
        // [Title]: [Details] (e.g. Tu Pyar Hai: Aamir K)
        if (part0) {
          add(part0, part1, 0.95);
          add(part0, "", 0.95);
          subTitle = part0;
        }
      }
    } else {
      mainTitle = stripNoise(segments[0]);
      if (mainTitle) {
        if (feat) add(mainTitle, feat, 0.95);
        if (artistClean) add(mainTitle, artistClean, 0.9);
        add(mainTitle, "", 0.95);
      }
    }

    for (const seg of segments.slice(1)) {
      const segFeat = extractFeat(seg);
      if (segFeat) {
        if (mainTitle) add(mainTitle, segFeat, 0.95);
        if (subTitle) add(subTitle, segFeat, 0.95);
      }
      const segArtist = cleanArtistName(seg);
      if (segArtist && !isRecordLabel(segArtist)) {
        if (mainTitle) add(mainTitle, segArtist, 0.95);
        if (subTitle) add(subTitle, segArtist, 0.95);
        const subArtists = segArtist.split(/\s*(?:[x&,]|feat\.?|ft\.?)\s*/i).map((s) => s.trim()).filter(Boolean);
        if (subArtists.length > 1 && subArtists[0]) {
          if (mainTitle) add(mainTitle, subArtists[0], 0.95);
          if (subTitle) add(subTitle, subArtists[0], 0.95);
        }
      }
    }
  }

  // 2. Standard "Artist - Title" or "Title - Artist" dash pattern
  const strippedTitle = stripNoise(rawTitle);
  const dash = splitArtistTitleDash(strippedTitle);
  if (dash) {
    // Orientation A: Artist - Title (e.g. Sia - Unstoppable)
    add(dash.right, dash.left, 0.95);
    // Orientation B: Title - Artist (e.g. Unstoppable - Dino James)
    add(dash.left, dash.right, 0.95);
    if (artistClean) {
      add(dash.right, artistClean, 0.9);
      add(dash.left, artistClean, 0.9);
    }
    if (channelClean) {
      add(dash.right, channelClean, 0.85);
      add(dash.left, channelClean, 0.85);
    }
    add(dash.right, "", 0.75);
    add(dash.left, "", 0.75);
  }

  // 3. Quoted title
  const quotedMatch = rawTitle.match(/["“]([^"”]{2,120})["”]/) || rawTitle.match(/'([^']{2,120})'/);
  if (quotedMatch?.[1]) {
    add(quotedMatch[1].trim(), artistClean || channelClean, 0.85);
    add(quotedMatch[1].trim(), "", 0.75);
  }

  // 4. Colon pattern: e.g. "Kishore Kumar: Pyar Deewana Hota Hai" or "Tu Pyar Hai: Aamir K"
  if (rawTitle.includes(":")) {
    const colonParts = rawTitle.split(":");
    const beforeColon = colonParts[0].trim();
    const afterColon = colonParts.slice(1).join(":").split("|")[0].trim();
    if (PREFIX_NOISE_RE.test(beforeColon + ":")) {
      const cleanAfter = stripNoise(afterColon);
      if (cleanAfter) {
        if (feat) add(cleanAfter, feat, 0.95);
        if (artistClean) add(cleanAfter, artistClean, 0.85);
        add(cleanAfter, "", 0.95);
      }
    } else {
      const cleanAfter = stripNoise(afterColon);
      const cleanBefore = stripNoise(beforeColon);
      // Case A: [Artist]: [Title]
      if (cleanAfter) {
        add(cleanAfter, cleanBefore, 0.95);
        add(cleanAfter, "", 0.95);
        const pWords = cleanAfter.split(/\s+/);
        if (pWords.length >= 4) {
          const shortTitle = pWords.slice(0, 4).join(" ");
          add(shortTitle, cleanBefore, 0.95);
          add(shortTitle, "", 0.95);
        }
      }
      // Case B: [Title]: [Details]
      if (cleanBefore) {
        add(cleanBefore, cleanAfter, 0.95);
        add(cleanBefore, "", 0.95);
      }
    }
  }

  // 5. Delimiter-less titles (e.g. fan edits / clips: "Rita Hayworth Sway", "Audrey Hepburn Moon River")
  const words = strippedTitle.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 5) {
    const lastWord = words[words.length - 1];
    const firstPart = words.slice(0, -1).join(" ");
    if (lastWord.length >= 2) {
      add(lastWord, firstPart, 0.8);
      add(lastWord, "", 0.85); // Critical: title-only query for song name
    }
    if (words.length >= 3) {
      const lastTwo = words.slice(-2).join(" ");
      const firstRest = words.slice(0, -2).join(" ");
      add(lastTwo, firstRest, 0.8);
      add(lastTwo, "", 0.85);
    }
    const firstWord = words[0];
    const rest = words.slice(1).join(" ");
    add(firstWord, rest, 0.7);
  }

  if (channelClean) add(strippedTitle, channelClean, 0.65);
  if (artistClean) add(strippedTitle, artistClean, 0.8);

  if (feat) {
    add(strippedTitle, feat, 0.65);
  }

  add(strippedTitle, "", 0.6);
  add(rawTitle, "", 0.25);

  return { pairs: pairs.sort((a, b) => b.weight - a.weight), cleanTitles };
}

function candidateQueries(pairs, limit = 6) {
  const seen = new Set();
  const queries = [];
  const artistQueries = [];
  const titleOnlyQueries = [];

  for (const p of pairs) {
    if (p.artist) {
      const q = `${p.title} ${p.artist}`.trim();
      if (q && !seen.has(q.toLowerCase())) {
        seen.add(q.toLowerCase());
        artistQueries.push(q);
      }
    }
    const qTitle = p.title.trim();
    if (qTitle && !seen.has(qTitle.toLowerCase())) {
      seen.add(qTitle.toLowerCase());
      titleOnlyQueries.push(qTitle);
    }
  }

  // Interleave artist queries and title-only queries so clean titles are never starved
  const maxLen = Math.max(artistQueries.length, titleOnlyQueries.length);
  for (let i = 0; i < maxLen; i++) {
    if (artistQueries[i]) queries.push(artistQueries[i]);
    if (titleOnlyQueries[i]) queries.push(titleOnlyQueries[i]);
    if (queries.length >= limit) break;
  }
  return queries.slice(0, limit);
}

/* ------------------------------------------------------------------ source fetchers */

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
    const params = { track_name: title, artist_name: artist };
    if (duration > 0) params.duration = duration;
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

async function fetchLrclibSearch(queries) {
  const out = [];
  for (const query of queries) {
    if (!query) continue;
    try {
      const res = await axios.get(`${LRCLIB_API}/search`, {
        params: { q: query },
        headers: { "User-Agent": "Tansen-Music-App/2.1.0" },
        timeout: 7000,
      });
      const items = Array.isArray(res.data) ? res.data.slice(0, 20) : [];
      out.push(
        ...items.map((item) => ({
          title: item.trackName,
          artist: item.artistName,
          album: item.albumName,
          duration: item.duration,
          lyrics: item.plainLyrics ?? "",
          syncedLyrics: item.syncedLyrics ?? null,
          source: "lrclib",
        }))
      );
    } catch {
      /* try next query */
    }
  }
  return out;
}

async function fetchNetEaseSearch(queries) {
  const out = [];
  for (const query of queries) {
    if (!query) continue;
    try {
      const { data } = await axios.get(NETEASE_SEARCH_API, {
        params: { s: query, type: 1, limit: 15 },
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 6000,
      });
      const songs = data?.result?.songs ?? [];
      out.push(
        ...songs.map((s) => ({
          id: s.id,
          title: s.name,
          artist: s.artists?.map((a) => a.name).join(", ") ?? "",
          duration: s.duration ? Math.round(s.duration / 1000) : 0,
          source: "netease",
        }))
      );
    } catch {
      /* try next query */
    }
  }
  return out;
}

async function fetchNetEaseLyric(songId, queryHasChinese = false) {
  try {
    const { data } = await axios.get(NETEASE_LYRIC_API, {
      params: { id: songId, lv: -1, kv: -1, tv: -1 },
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 6000,
    });
    const raw = data?.lrc?.lyric;
    if (!raw || data?.nolyric || data?.uncollected) return null;
    if (!isUsableLyrics(raw, queryHasChinese)) return null;
    const plain = raw
      .replace(/\[\d{1,2}:\d{2}[^\]]*\]/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    return { syncedLyrics: raw, lyrics: plain || raw };
  } catch {
    return null;
  }
}

// JioSaavn (via the free, keyless saavn.dev community API) — by far the best
// source for Hindi/Bollywood/regional-Indian tracks, which LRCLIB and
// NetEase barely cover. `hasLyrics` lets us skip a wasted lyrics request.
async function fetchSaavnSearch(queries) {
  const out = [];
  for (const query of queries) {
    if (!query) continue;
    try {
      const { data } = await axios.get(`${SAAVN_API}/search/songs`, {
        params: { query, limit: 5 },
        timeout: 7000,
      });
      const results = data?.data?.results ?? data?.results ?? [];
      out.push(
        ...results
          .map((s) => ({
            id: s.id,
            title: s.name || s.song || s.title || "",
            artist:
              (Array.isArray(s.artists?.primary) ? s.artists.primary.map((a) => a.name).join(", ") : "") ||
              s.primaryArtists ||
              s.singers ||
              "",
            duration: Number(s.duration) || 0,
            hasLyrics: Boolean(s.hasLyrics ?? s.has_lyrics),
            source: "jiosaavn",
          }))
          .filter((s) => s.id && s.title)
      );
    } catch {
      /* try next query */
    }
  }
  return out;
}

async function fetchSaavnLyrics(songId) {
  try {
    const { data } = await axios.get(`${SAAVN_API}/songs/${songId}/lyrics`, { timeout: 7000 });
    const raw = data?.data?.lyrics ?? data?.lyrics;
    if (!raw) return null;
    const cleaned = String(raw)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/\\n/g, "\n")
      .trim();
    return cleaned ? { lyrics: cleaned } : null;
  } catch {
    return null;
  }
}

// lyrics.ovh needs an exact-ish artist/title pair rather than a free-text
// query, so it's tried against our best (title, artist) guesses directly
// instead of the generated search-query strings.
async function fetchLyricsOvhPairs(pairs, limit = 3) {
  const tried = new Set();
  for (const pair of pairs) {
    if (!pair.artist || !pair.title) continue;
    const key = `${pair.artist.toLowerCase()}|${pair.title.toLowerCase()}`;
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const { data } = await axios.get(
        `${LYRICS_OVH_API}/${encodeURIComponent(pair.artist)}/${encodeURIComponent(pair.title)}`,
        { timeout: 7000 }
      );
      if (data?.lyrics) {
        return { title: pair.title, artist: pair.artist, lyrics: String(data.lyrics).trim() };
      }
    } catch {
      /* try next pair */
    }
    if (tried.size >= limit) break;
  }
  return null;
}

function rankMatches(track, candidates) {
  return candidates
    .map((parent) => ({ ...parent, confidence: matchConfidence(parent, track) }))
    .sort((a, b) => b.confidence - a.confidence);
}

function selectBestMatch(track, candidates, minConfidence) {
  const scored = rankMatches(track, candidates);
  const best = scored[0];
  if (!best || best.confidence < minConfidence) return null;
  return best;
}

/* ------------------------------------------------------------------ route */

export async function getLyrics(req, res) {
  const rawTitle = String(req.query.q ?? "").trim();
  const rawArtist = String(req.query.artist ?? "").trim();
  const rawChannel = String(req.query.channel ?? "").trim();
  const videoId = String(req.query.videoId || req.query.id || "").trim();
  const duration = Number(req.query.duration ?? req.query.durationSec ?? 0) || 0;

  if (!rawTitle) {
    return res.status(400).json({ error: "Missing query param ?q=" });
  }

  const { pairs, cleanTitles } = deriveCandidates(rawTitle, rawChannel, rawArtist);
  const queries = candidateQueries(pairs, 6);
  const track = { title: rawTitle, artist: rawArtist, channel: rawChannel, duration, cleanTitles };
  const respond = (payload) => res.json(payload);

  // 00 · YouTube timed captions — 100% frame-accurate to the EXACT video audio (dialogues/skits/rap intros)
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    const ytSubRes = await fetchYouTubeCaptionsDirect(videoId);
    if (ytSubRes?.syncedLyrics) {
      return respond({
        lyrics: ytSubRes.plainLyrics || ytSubRes.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2}\]\s*/g, ""),
        syncedLyrics: ytSubRes.syncedLyrics,
        title: track.title,
        artist: track.artist,
        source: "youtube-subs",
        confidence: 1.0,
        note: "exact-video-synced",
        refDuration: track.duration,
      });
    }
  }

  // 0 · LRCLIB exact match — cheapest, most reliable when we have a clean artist.
  const exactArtist = (!isRecordLabel(track.artist) && track.artist) || pairs[0]?.artist || "";
  const exactTitle = pairs[0]?.title || track.title;
  if (exactTitle && exactArtist) {
    const exact = await fetchLrclibExact(exactTitle, exactArtist, duration);
    if (exact) {
      const confidence = matchConfidence(exact, track);
      if (confidence >= STRICT_CONFIDENCE) {
        return respond({
          lyrics: exact.lyrics,
          syncedLyrics: exact.syncedLyrics,
          title: exact.title,
          artist: exact.artist,
          album: exact.album,
          refDuration: Number(exact.duration || 0),
          source: "lrclib",
          confidence: Number(confidence.toFixed(3)),
          note: "exact-match",
        });
      }
    }
  }

  // Gather every candidate pool ONCE, in parallel, so the relaxed retry
  // below doesn't refetch anything and the extra sources don't add latency.
  const [lrclibCandidates, neteaseRaw, saavnRaw, geniusRaw] = await Promise.all([
    fetchLrclibSearch(queries),
    fetchNetEaseSearch(queries),
    fetchSaavnSearch(queries),
    GENIUS_KEY
      ? (async () => {
          const hits = [];
          for (const query of queries.slice(0, 4)) {
            const results = await fetchGeniusHits(query, 5);
            for (const hit of results) {
              hits.push({ title: hit.title, artist: hit.primary_artist?.name ?? "", url: hit.url, duration: 0 });
            }
          }
          return hits;
        })()
      : Promise.resolve([]),
  ]);

  // Source priority, both tiers: LRCLIB (lyrics already in hand) -> JioSaavn
  // (best for Indian/regional catalog) -> NetEase -> lyrics.ovh (needs a
  // direct artist/title guess) -> Genius (most expensive, scrape fallback).
  for (const [tier, minConfidence] of [["strict", STRICT_CONFIDENCE], ["relaxed", RELAXED_CONFIDENCE]]) {
    const bestLrc = selectBestMatch(track, lrclibCandidates, minConfidence);
    if (bestLrc && (bestLrc.lyrics || bestLrc.syncedLyrics)) {
      return respond({
        lyrics: bestLrc.lyrics,
        syncedLyrics: bestLrc.syncedLyrics,
        title: bestLrc.title,
        artist: bestLrc.artist,
        album: bestLrc.album,
        refDuration: Number(bestLrc.duration || 0),
        source: "lrclib",
        confidence: Number(bestLrc.confidence.toFixed(3)),
        note: tier === "strict" ? "scored-search" : "low-confidence-guess",
      });
    }

    const scoredSaavn = rankMatches(track, saavnRaw.filter((s) => s.hasLyrics)).filter(
      (c) => c.confidence >= minConfidence
    );
    for (const cand of scoredSaavn.slice(0, 2)) {
      const lrc = await fetchSaavnLyrics(cand.id);
      if (lrc && lrc.lyrics) {
        return respond({
          lyrics: lrc.lyrics,
          syncedLyrics: null,
          title: cand.title,
          artist: cand.artist,
          refDuration: Number(cand.duration || 0),
          source: "jiosaavn",
          confidence: Number(cand.confidence.toFixed(3)),
          note: tier === "strict" ? "jiosaavn-matched" : "low-confidence-guess",
        });
      }
    }

    const trackHasChinese = /[\u4e00-\u9fa5]/.test(String(track.title || "") + " " + String(track.artist || ""));
    const scoredNetease = rankMatches(track, neteaseRaw).filter((c) => c.confidence >= minConfidence);
    for (const cand of scoredNetease.slice(0, 2)) {
      const lrc = await fetchNetEaseLyric(cand.id, trackHasChinese);
      if (lrc && (lrc.lyrics || lrc.syncedLyrics)) {
        return respond({
          lyrics: lrc.lyrics,
          syncedLyrics: lrc.syncedLyrics,
          title: cand.title,
          artist: cand.artist,
          refDuration: Number(cand.duration || 0),
          source: "netease",
          confidence: Number(cand.confidence.toFixed(3)),
          note: tier === "strict" ? "netease-matched" : "low-confidence-guess",
        });
      }
    }

    // lyrics.ovh has no search/confidence of its own, so only trust it on
    // the strict tier, and only for pairs whose own derived weight is high.
    if (tier === "strict") {
      const ovhPairs = pairs.filter((p) => p.artist && p.weight >= 0.7);
      const ovh = await fetchLyricsOvhPairs(ovhPairs, 3);
      if (ovh) {
        const confidence = matchConfidence(ovh, track);
        if (confidence >= minConfidence) {
          return respond({
            lyrics: ovh.lyrics,
            syncedLyrics: null,
            title: ovh.title,
            artist: ovh.artist,
            source: "lyricsovh",
            confidence: Number(confidence.toFixed(3)),
            note: "lyricsovh-matched",
          });
        }
      }
    }

    // Python stream-engine Genius (runs via Flask microservice on :5002)
    for (const q of queries.slice(0, 5)) {
      const fetched = await fetchPythonLyrics(q);
      if (fetched && isUsableLyrics(fetched.lyrics)) {
        const confidence = matchConfidence(fetched, track);
        if (confidence >= minConfidence) {
          return respond({
            lyrics: fetched.lyrics,
            syncedLyrics: null,
            title: fetched.title,
            artist: fetched.artist,
            source: "genius",
            confidence: Number(confidence.toFixed(3)),
            note: tier === "strict" ? "genius-py" : "low-confidence-guess",
          });
        }
      }
    }

    if (GENIUS_KEY) {
      const best = selectBestMatch(track, geniusRaw, minConfidence);
      if (best) {
        const fetched = await fetchPythonLyrics(`${best.title} ${best.artist}`);
        if (fetched && isUsableLyrics(fetched.lyrics)) {
          const confidence = matchConfidence(fetched, track);
          if (confidence >= minConfidence) {
            return respond({
              lyrics: fetched.lyrics,
              syncedLyrics: null,
              title: fetched.title,
              artist: fetched.artist,
              refDuration: Number(fetched.duration || 0),
              source: "genius",
              confidence: Number(confidence.toFixed(3)),
              note: tier === "strict" ? "genius-py" : "low-confidence-guess",
            });
          }
        }

        if (best.url) {
          try {
            const page = await axios.get(best.url, {
              timeout: 8000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
            });
            const $ = cheerio.load(page.data);
            const blocks = [];
            $('div[data-lyrics-container="true"]').each((_, el) => {
              $(el).find("br").replaceWith("\n");
              blocks.push($(el).text().trim());
            });
            const scrapedLyrics = blocks.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n");
            if (scrapedLyrics && isUsableLyrics(scrapedLyrics)) {
              return respond({
                lyrics: scrapedLyrics,
                syncedLyrics: null,
                title: best.title,
                artist: best.artist,
                url: best.url,
                refDuration: Number(best.duration || 0),
                source: "genius",
                confidence: Number(best.confidence.toFixed(3)),
                note: tier === "strict" ? "genius-scrape" : "low-confidence-guess",
              });
            }
          } catch {
            /* continue */
          }
        }
      }
    }
  }

  // Nothing at all, even relaxed — genuinely couldn't find it.
  return respond({
    lyrics: "",
    syncedLyrics: null,
    title: track.title,
    artist: track.artist,
    source: "none",
    note: "lyrics-not-confident",
  });
}
