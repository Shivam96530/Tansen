import { MOODS, MOOD_DEMO_MAP, findsDemo, DEMO_TRACKS } from "../data/demo";
import { searchTracks, isSingleTrack } from "./api";
import { songKey } from "../lib/dedupe";
import type { MoodKey, Track } from "../types";

/* ------------------------------------------------------------------
 * Hugging Face Inference API — Trained Semantic Emotion & Mood Engine
 * Models:
 *   - SamLowe/roberta-base-go_emotions: 28 nuanced human emotions
 *   - cardiffnlp/twitter-roberta-base-sentiment-latest: polarity check
 * Offline/local:
 *   - Multi-lingual linguistic parser (English, Hindi, Hinglish, genres, artists)
 * ------------------------------------------------------------------ */

const HF_KEY = (import.meta.env.VITE_HUGGING_FACE_API_KEY ?? "").trim();
const HF_INFERENCE_BASE = "https://router.huggingface.co/hf-inference/models";
const EMOTION_MODEL = "SamLowe/roberta-base-go_emotions";
const SENTIMENT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest";

/** POST to HF Inference API with automatic retry on cold start */
async function hfPost(model: string, payload: unknown): Promise<any | null> {
  if (!HF_KEY || HF_KEY.length < 8) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${HF_INFERENCE_BASE}/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        const wait = Math.min((body?.estimated_time ?? 5) * 1000, 10000);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/* ---------------- Emotion Classification ---------------- */

export interface DetectedEmotion {
  label: string;
  score: number;
}

async function hfDetectEmotions(text: string): Promise<DetectedEmotion[]> {
  try {
    const data = await hfPost(EMOTION_MODEL, { inputs: text });
    if (!data) return [];
    const list = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : [];
    return list.map((item: any) => ({
      label: String(item.label || "").toLowerCase(),
      score: Number(item.score || 0),
    }));
  } catch {
    return [];
  }
}

async function hfSentimentPolarity(text: string): Promise<"POSITIVE" | "NEGATIVE" | null> {
  try {
    const data = await hfPost(SENTIMENT_MODEL, { inputs: text });
    if (!data) return null;
    const list = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : [];
    const top = list.sort((a: any, b: any) => b.score - a.score)[0];
    const lbl = (top?.label || "").toLowerCase();
    if (lbl.includes("pos")) return "POSITIVE";
    if (lbl.includes("neg")) return "NEGATIVE";
    return null;
  } catch {
    return null;
  }
}

/* ---------------- Semantic Entities & Intent Parser ---------------- */

const KNOWN_ARTISTS = [
  "arijit singh", "arijit", "atif aslam", "atif", "the weeknd", "weeknd",
  "taylor swift", "taylor", "diljit dosanjh", "diljit", "sidhu moose wala", "sidhu",
  "kk", "shreya ghoshal", "kishore kumar", "lata mangeshkar", "mohit chauhan",
  "prateek kuhad", "anuv jain", "drake", "billie eilish", "ed sheeran",
  "eminem", "kendrick lamar", "post malone", "bruno mars", "sonu nigam",
  "justin bieber", "coldplay", "imagine dragons", "alan walker", "ap dhillon",
  "shubh", "karan aujla", "charlie puth", "adele", "lana del rey", "dua lipa",
];

const KNOWN_GENRES = [
  "phonk", "lofi", "ghazal", "rock", "pop", "hip hop", "rap", "sufi",
  "classical", "acoustic", "metal", "edm", "qawwali", "indie", "bollywood",
  "punjabi", "k-pop", "kpop", "synthwave", "r&b", "jazz", "soul", "blues",
  "ambient", "drill", "bhangra",
];

const KNOWN_ACTIVITIES = [
  { words: ["gym", "workout", "deadlift", "lift", "training", "cardio", "pump"], tag: "gym" },
  { words: ["late night", "night", "midnight", "nocturnal", "sleepless", "insomnia"], tag: "late night" },
  { words: ["driving", "drive", "road trip", "car ride", "highway"], tag: "driving" },
  { words: ["study", "studying", "coding", "code", "work", "focus", "reading", "exam"], tag: "study" },
  { words: ["sleep", "bedtime", "relax", "unwind", "nap"], tag: "sleep" },
  { words: ["rain", "raining", "rainy", "monsoon", "barish"], tag: "rain" },
  { words: ["party", "club", "dance", "dancing", "banger"], tag: "party" },
  { words: ["breakup", "heartbreak", "heartbroken", "dumped", "ex", "crying", "alone"], tag: "heartbreak" },
  { words: ["date", "dinner", "candlelight", "valentine"], tag: "date" },
  { words: ["nostalgia", "nostalgic", "childhood", "90s", "2000s", "old school"], tag: "nostalgia" },
];

const HINDI_EMOTIONS = [
  { words: ["dard", "judai", "rona", "roye", "gham", "udas", "dil toot", "tanha", "bikhra"], mood: "sad" as MoodKey },
  { words: ["khush", "khushi", "mast", "masti", "jashn", "nach", "maza"], mood: "happy" as MoodKey },
  { words: ["pyar", "ishq", "mohobbat", "aashiq", "deewana", "sanam", "jaan"], mood: "romantic" as MoodKey },
  { words: ["sukoon", "shanti", "halka", "thanda", "aaram"], mood: "calm" as MoodKey },
  { words: ["josh", "dhamaka", "aag", "dum"], mood: "energetic" as MoodKey },
];

const LOCAL_KEYWORD_MAP: Record<MoodKey, string[]> = {
  sad: [
    "sad", "down", "depressed", "heartbroken", "lonely", "cry", "crying",
    "upset", "miserable", "grief", "blue", "miss", "miss her", "miss him",
    "hurt", "tired", "empty", "tear", "pain", "dark", "hopeless", "alone",
  ],
  happy: [
    "happy", "joy", "great", "awesome", "excited", "good", "amazing",
    "wonderful", "glad", "cheerful", "delighted", "grateful", "sunny",
    "vibing", "celebrate", "smile", "laugh", "euphoric",
  ],
  romantic: [
    "love", "romantic", "crush", "date", "valentine", "beloved", "heart",
    "adore", "anniversary", "wedding", "beautiful", "cuddle", "together",
    "intimate", "candlelight",
  ],
  energetic: [
    "energy", "workout", "gym", "party", "dance", "pump", "run", "hype",
    "power", "adrenaline", "fast", "epic", "extreme", "heavy", "lift",
    "beast", "rage", "hardstyle", "club",
  ],
  calm: [
    "calm", "relax", "peace", "sleep", "chill", "quiet", "meditate",
    "soft", "gentle", "breathe", "evening", "rain", "slow", "ambient",
    "serene", "tranquil", "soothing",
  ],
  focus: [
    "focus", "study", "work", "concentrate", "code", "coding", "read",
    "exam", "deep", "productive", "flow", "writing", "deadline", "lofi",
    "instrumental", "background",
  ],
};

function parseEntities(text: string) {
  const lower = text.toLowerCase();
  const foundArtist = KNOWN_ARTISTS.find((a) => lower.includes(a));
  const foundGenre = KNOWN_GENRES.find((g) => lower.includes(g));
  const foundActivity = KNOWN_ACTIVITIES.find((act) => act.words.some((w) => lower.includes(w)))?.tag;
  return { artist: foundArtist, genre: foundGenre, activity: foundActivity };
}

function detectLocalMood(text: string): MoodKey {
  const lower = text.toLowerCase();

  // Check Hindi sentiment first
  for (const item of HINDI_EMOTIONS) {
    if (item.words.some((w) => lower.includes(w))) {
      return item.mood;
    }
  }

  // Check English keyword weights
  let bestMood: MoodKey = "calm";
  let highestScore = 0;

  (Object.keys(LOCAL_KEYWORD_MAP) as MoodKey[]).forEach((key) => {
    const score = LOCAL_KEYWORD_MAP[key].reduce((acc, word) => {
      return acc + (lower.includes(word) ? 1 : 0);
    }, 0);
    if (score > highestScore) {
      highestScore = score;
      bestMood = key;
    }
  });

  return highestScore > 0 ? bestMood : "calm";
}

function mapEmotionToGoMood(emotions: DetectedEmotion[], polarity: "POSITIVE" | "NEGATIVE" | null): MoodKey {
  if (!emotions.length) return polarity === "NEGATIVE" ? "sad" : "happy";

  const top = emotions[0];
  const label = top.label;

  const sadLabels = ["sadness", "grief", "disappointment", "remorse", "embarrassment"];
  const happyLabels = ["joy", "optimism", "gratitude", "amusement", "pride", "relief"];
  const romanticLabels = ["love", "caring", "desire", "admiration"];
  const energeticLabels = ["excitement", "anger", "annoyance"];
  const calmLabels = ["nervousness", "fear", "approval"];
  const focusLabels = ["curiosity", "realization", "neutral", "confusion"];

  if (sadLabels.includes(label)) return "sad";
  if (romanticLabels.includes(label)) return "romantic";
  if (energeticLabels.includes(label)) return "energetic";
  if (happyLabels.includes(label)) return "happy";
  if (focusLabels.includes(label)) return "focus";
  if (calmLabels.includes(label)) return "calm";

  return polarity === "NEGATIVE" ? "sad" : "happy";
}

/* ---------------- Dynamic Targeted Song Query Synthesis ---------------- */

function synthesizeQueries(
  rawText: string,
  mood: MoodKey,
  entities: { artist?: string; genre?: string; activity?: string }
): string[] {
  const queries: string[] = [];
  const { artist, genre, activity } = entities;

  // 1 · Direct artist context
  if (artist) {
    if (mood === "sad") {
      queries.push(`${artist} emotional sad song`);
      queries.push(`${artist} heartbreak acoustic song`);
    } else if (mood === "romantic") {
      queries.push(`${artist} romantic love song`);
      queries.push(`${artist} soulful acoustic ballad song`);
    } else if (mood === "energetic") {
      queries.push(`${artist} upbeat dance hit song`);
      queries.push(`${artist} high energy anthem song`);
    } else {
      queries.push(`${artist} best acoustic song`);
      queries.push(`${artist} popular single song`);
    }
    return queries;
  }

  // 2 · Activity + Genre context
  if (activity === "gym") {
    queries.push(`${genre || "drift"} phonk workout song`);
    queries.push("heavy gym adrenaline motivation song");
    queries.push("beast mode workout anthem track");
    return queries;
  }

  if (activity === "late night" || activity === "sleep") {
    queries.push("late night chill lofi beat");
    queries.push("deep nocturnal calming acoustic song");
    queries.push("peaceful sleep ambient track");
    return queries;
  }

  if (activity === "driving") {
    queries.push("night drive synthwave song");
    queries.push("long drive chill vibe song");
    return queries;
  }

  if (activity === "study") {
    queries.push("deep focus chill lofi beat");
    queries.push("study concentration piano track");
    return queries;
  }

  if (activity === "rain") {
    queries.push("rainy day melancholic acoustic song");
    queries.push("rain aesthetic chill song");
    return queries;
  }

  if (activity === "heartbreak") {
    queries.push("heartbreak emotional acoustic song");
    queries.push("sad piano ballad tearjerker song");
    queries.push("deep emotional hurt acoustic song");
    return queries;
  }

  // 3 · Genre-specific
  if (genre) {
    queries.push(`${genre} hit song`);
    queries.push(`${mood} ${genre} track`);
    return queries;
  }

  // 4 · Specific text blend (cleaned of punctuation, ensuring "song" is target)
  const cleanInput = rawText
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanInput.length > 3 && cleanInput.split(" ").length <= 4) {
    queries.push(`${cleanInput} single song`);
  }

  // 5 · Mood-tuned queries targeting real individual songs (never playlists!)
  const moodDef = MOODS.find((m) => m.key === mood) ?? MOODS[0];
  queries.push(...moodDef.queries);

  return Array.from(new Set(queries));
}

/* ---------------- Empathetic Studio Reply Generation ---------------- */

function generateStudioReply(
  mood: MoodKey,
  rawText: string,
  entities: { artist?: string; genre?: string; activity?: string },
  topEmotion?: DetectedEmotion,
  trackCount = 0
): string {
  const { artist, genre, activity } = entities;

  if (artist) {
    return `Dialed straight into ${artist.toUpperCase()} with ${mood} frequencies. Assembled ${trackCount} single tracks for your session. Hit Play All to start listening without interruptions.`;
  }

  if (activity === "gym") {
    return `Adrenaline locked. Curated ${trackCount} hard-hitting phonk & workout tracks to keep your momentum high. Volume up.`;
  }

  if (activity === "late night" || activity === "sleep") {
    return `Night mode active. Queued ${trackCount} gentle, uninterrupted nocturnal tracks to help you unwind and settle in.`;
  }

  if (activity === "heartbreak" || (topEmotion && topEmotion.label === "sadness" && topEmotion.score > 0.4)) {
    return `I hear that heavy feeling. Here are ${trackCount} heartfelt, acoustic single tracks to hold space with you. Take it slow.`;
  }

  if (genre) {
    return `Tuning your feed into ${genre.toUpperCase()} vibes. Handpicked ${trackCount} distinct tracks that match the exact tone you described.`;
  }

  const openers: Record<MoodKey, string> = {
    happy: `Sunlit energy captured! Here are ${trackCount} feel-good single songs tuned to lift you higher.`,
    sad: `Gentle melodies coming through. Assembled ${trackCount} comforting tracks to let you process and breathe.`,
    romantic: `Candlelight frequencies active. Here are ${trackCount} warm, intimate love songs ready to flow.`,
    energetic: `High tempo and full voltage. Queued ${trackCount} electrifying single songs to get you moving.`,
    calm: `Still water and clear air. Queued ${trackCount} peaceful, ambient tracks to wash out the noise.`,
    focus: `Deep work mode engaged. Curated ${trackCount} focused, distraction-free tracks for your flow state.`,
  };

  return openers[mood];
}

/* ---------------- Main Mood Analysis Export ---------------- */

export interface MoodAnalysis {
  mood: MoodKey;
  source: "huggingface" | "local";
  sentiment: "POSITIVE" | "NEGATIVE" | null;
  emotion?: string;
  reply: string;
  tracks: Track[];
}

export async function analyseMood(text: string): Promise<MoodAnalysis> {
  const trimmed = text.trim();
  const entities = parseEntities(trimmed);

  // 1 · Live HF Emotion + Sentiment classification
  const [emotions, polarity] = await Promise.all([
    hfDetectEmotions(trimmed),
    hfSentimentPolarity(trimmed),
  ]);

  let mood: MoodKey;
  let source: "huggingface" | "local" = "local";
  let topEmotion: DetectedEmotion | undefined;

  if (emotions.length > 0) {
    source = "huggingface";
    topEmotion = emotions[0];
    const local = detectLocalMood(trimmed);

    // If local keyword or Hindi intent is very explicit, respect it; otherwise use GoEmotions
    if (local !== "calm" && topEmotion.score < 0.35) {
      mood = local;
    } else {
      mood = mapEmotionToGoMood(emotions, polarity);
    }
  } else if (polarity) {
    source = "huggingface";
    const local = detectLocalMood(trimmed);
    mood = local !== "calm" ? local : polarity === "POSITIVE" ? "happy" : "sad";
  } else {
    mood = detectLocalMood(trimmed);
  }

  // 2 · Synthesize single-song search queries (no playlist keywords)
  const targetQueries = synthesizeQueries(trimmed, mood, entities);

  // 3 · Multi-query harvesting for a continuous stream of 10 to 15 single songs
  let harvested: Track[] = [];
  const seenKeys = new Set<string>();

  for (const q of targetQueries.slice(0, 3)) {
    try {
      const results = await searchTracks(q, 15);
      for (const t of results) {
        if (!isSingleTrack(t)) continue;
        const k = songKey(t);
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          harvested.push(t);
        }
        if (harvested.length >= 15) break;
      }
    } catch {
      /* offline query */
    }
    if (harvested.length >= 10) break;
  }

  // 4 · Fallback only if live search is completely offline or empty
  if (!harvested.length) {
    const ids = MOOD_DEMO_MAP[mood] ?? [];
    harvested = ids.map((id) => findsDemo(id)).filter(Boolean) as Track[];
    if (!harvested.length) harvested = DEMO_TRACKS.slice(0, 6);
  }

  const finalTracks = harvested.slice(0, 15);
  const reply = generateStudioReply(mood, trimmed, entities, topEmotion, finalTracks.length);

  return {
    mood,
    source,
    sentiment: polarity,
    emotion: topEmotion?.label,
    reply,
    tracks: finalTracks,
  };
}

export function moodLabel(key: MoodKey) {
  return MOODS.find((m) => m.key === key)?.label ?? key;
}
