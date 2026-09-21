import axios from "axios";
import { directYoutubeSearch } from "../lib/youtubeSearch.js";

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const GENIUS_API = "https://api.genius.com";
const GENIUS_KEY = process.env.GENIUS_API_KEY || process.env.GENIUS_ACCESS_TOKEN || "";
const STREAM_BASE = (process.env.STREAM_BASE_URL || "http://localhost:5002").replace(/\/+$/, "");

const ALLOWED_MOODS = new Set(["happy", "sad", "romantic", "energetic", "calm", "focus"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenScore = (a = "", b = "") => {
  const first = new Set(normalize(a).split(" ").filter(Boolean));
  const second = new Set(normalize(b).split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;
  let matches = 0;
  first.forEach((word) => second.has(word) && matches++);
  return matches / Math.max(first.size, second.size);
};

const jsonFromModel = (content) => {
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
};

async function hfChat(messages, { maxTokens = 500, temperature = 0.2 } = {}) {
  const token = process.env.HF_TOKEN;
  if (!token) return { error: "HF_NOT_CONFIGURED" };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.post(
        HF_CHAT_URL,
        {
          model: process.env.HF_CHAT_MODEL || "Qwen/Qwen3-32B:fastest",
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 25000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (response.status === 503) {
        await sleep(1200);
        continue;
      }
      if (!response.status || response.status >= 400) {
        return { error: `HF_HTTP_${response.status || "UNKNOWN"}` };
      }
      if (!content) return { error: "HF_EMPTY_RESPONSE" };
      return { content };
    } catch (err) {
      if (err.response?.status === 503) {
        await sleep(1200);
        continue;
      }
      return { error: err.response?.data?.error || err.message || "HF_REQUEST_FAILED" };
    }
  }
  return { error: "HF_PROVIDER_UNAVAILABLE" };
}

function replyForMood(mood, trackCount = 0) {
  const replies = {
    happy: `Bright energy captured. Here are ${trackCount} uplifting tracks tuned to your mood.`,
    sad: `I hear that heaviness. Here are ${trackCount} gentle tracks selected for how you feel.`,
    romantic: `Warm, intimate frequencies selected. Here are ${trackCount} love-infused tracks.`,
    energetic: `You’re running on voltage. Here are ${trackCount} fiery tracks to keep the pace.`,
    calm: `Let’s soften the noise. Here are ${trackCount} calm, air-light tracks for you.`,
    focus: `Deep focus selected. Here are ${trackCount} distraction-free tracks for your flow.`,
  };
  return replies[mood] || `Here are ${trackCount} tracks selected for you.`;
}

async function searchYoutube(query, limit = 8) {
  try {
    const items = await directYoutubeSearch(query, limit);
    return items.filter((t) => t.id && t.title);
  } catch {
    return [];
  }
}

const KNOWN_ARTISTS_DETECT = [
  "arijit singh", "arijit", "atif aslam", "atif", "taylor swift", "taylor",
  "ed sheeran", "ed", "diljit dosanjh", "diljit", "shreya ghoshal",
  "kishore kumar", "lata mangeshkar", "mohit chauhan", "sonu nigam",
  "bruno mars", "billie eilish", "eminem", "coldplay", "drake",
  "post malone", "justin bieber", "anurag saikia", "prateek kuhad", "anuv jain"
];

function detectIntent(text) {
  const lower = text.toLowerCase();
  const isChat =
    /(who|what|when|where|why|how|which|composed|singer|artist|song|movie|album|lyrics|year|released)\b/.test(
      lower
    ) || /\?$/.test(lower.trim());

  let moodSearch = "";
  if (/(sad|cry|depressed|dard|judai|broken|alone|hurt)/.test(lower)) moodSearch = "sad";
  else if (/(happy|joy|khush|masti|party|excited)/.test(lower)) moodSearch = "happy";
  else if (/(love|pyar|romantic|ishq|crush|date)/.test(lower)) moodSearch = "romantic";
  else if (/(gym|workout|energy|power|josh|hype)/.test(lower)) moodSearch = "energetic";
  else if (/(study|focus|exam|code|padhai|work)/.test(lower)) moodSearch = "focus";
  else if (/(calm|relax|sleep|peace|sukoon|chill)/.test(lower)) moodSearch = "calm";

  const artistMatch = KNOWN_ARTISTS_DETECT.find((artist) => lower.includes(artist));
  return { isChat, moodSearch, artistMatch };
}

async function fetchGeniusFacts(query) {
  if (!GENIUS_KEY) return null;
  try {
    const { data } = await axios.get(`${GENIUS_API}/search`, {
      params: { q: query },
      headers: { Authorization: `Bearer ${GENIUS_KEY}` },
      timeout: 7000,
    });
    const hits = data?.response?.hits ?? [];
    const best =
      hits
        .map((hit) => hit.result)
        .filter(Boolean)
        .map((hit) => ({
          ...hit,
          _score: tokenScore(query, hit.title) + tokenScore(query, hit.primary_artist?.name || ""),
        }))
        .sort((a, b) => b._score - a._score)[0] || null;
    if (!best) return null;
    return {
      title: best.title,
      artist: best.primary_artist?.name,
      url: best.url,
      date: best.release_date_for_display,
      album: best.album?.name,
    };
  } catch {
    return null;
  }
}

function buildIntentPrompt(text) {
  return [
    {
      role: "system",
      content:
        'You are an intelligent music assistant. Reply with JSON. Output only this exact shape: {"mood":"happy|sad|romantic|energetic|calm|focus","emotion":"string","reply":"string","searchQueries":["string","string","string"]}',
    },
    {
      role: "user",
      content: `User says: "${text}". Understand language, mood, and context. Provide lyrical and helpful recommendations in ${text.match(/[ऀ-ॿ]/) ? "Hinglish" : "English"}.`,
    },
  ];
}

export async function analyseMood(req, res) {
  const text = String(req.body?.text ?? "").trim();
  if (!text || text.length > 500) {
    return res.status(400).json({ error: "Text must contain 1-500 characters.", code: "INVALID_PAYLOAD" });
  }

  const intent = detectIntent(text);
  const moodFallback = intent.moodSearch ? intent.moodSearch : "calm";
  let modelJson = null;
  let modelError = null;

  if (process.env.HF_TOKEN) {
    const prompt = buildIntentPrompt(text);
    const hf = await hfChat(prompt, { maxTokens: 500, temperature: 0.18 });
    if (hf.error) {
      modelError = hf.error;
    } else {
      modelJson = jsonFromModel(hf.content);
    }
  }

  let mood = modelJson && ALLOWED_MOODS.has(modelJson.mood) ? modelJson.mood : moodFallback;
  if (!ALLOWED_MOODS.has(mood)) mood = "calm";

  let searchQueries = Array.isArray(modelJson?.searchQueries) ? modelJson.searchQueries : [];
  searchQueries = searchQueries
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (!searchQueries.length && intent.artistMatch) {
    searchQueries = [
      `${intent.artistMatch} hit songs`,
      `${intent.artistMatch} emotional songs`,
      `${intent.artistMatch} top tracks`,
    ];
  }
  if (!searchQueries.length && intent.moodSearch) {
    searchQueries = [`${intent.moodSearch} acoustic song`, `${intent.moodSearch} hit song`];
  }
  if (!searchQueries.length) {
    searchQueries = [text];
  }

  let facts = null;
  if (intent.isChat) {
    facts = await fetchGeniusFacts(text);
  }

  let tracks = [];
  for (const query of searchQueries) {
    const results = await searchYoutube(query, 8);
    tracks = tracks.concat(results);
    if (tracks.length >= 12) break;
  }

  const deduped = [];
  const seen = new Set();
  for (const track of tracks) {
    const key = track.id || `${track.title}-${track.artist}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(track);
  }

  const replyBase = String(modelJson?.reply ?? replyForMood(mood, deduped.length));
  const reply = facts
    ? `${replyBase} Fun fact: "${facts.title}" is by ${facts.artist}${
        facts.album ? ` from ${facts.album}` : ""
      }${facts.date ? `, released ${facts.date}` : ""}.`
    : replyBase;

  return res.json({
    mood,
    emotion: modelJson?.emotion ? String(modelJson.emotion) : mood,
    reply: reply || `Here are ${deduped.length} tracks selected for you.`,
    tracks: deduped.slice(0, 12),
    source: modelJson ? "huggingface" : "local",
    note: modelError || undefined,
  });
}
