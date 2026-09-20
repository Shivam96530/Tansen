import { MOODS } from "../lib/moods";
import { searchTracks } from "./api";
import type { MoodKey, Track } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:5001" : "");

const ALLOWED_MOODS: MoodKey[] = ["happy", "sad", "romantic", "energetic", "calm", "focus"];

const LOCAL_MOOD_KEYWORDS: Record<MoodKey, string[]> = {
  happy: [
    "happy", "joy", "great", "awesome", "excited", "good", "amazing", "wonderful",
    "glad", "cheerful", "delighted", "grateful", "sunny", "vibing", "celebrate", "smile", "laugh"
  ],
  sad: [
    "sad", "down", "depressed", "heartbroken", "lonely", "cry", "crying", "upset",
    "miserable", "grief", "blue", "miss", "hurt", "tired", "empty", "tear", "pain", "dark", "alone", "breakup"
  ],
  romantic: [
    "love", "romantic", "crush", "date", "valentine", "beloved", "heart", "adore",
    "anniversary", "wedding", "beautiful", "cuddle", "intimate", "soulful"
  ],
  energetic: [
    "energy", "workout", "gym", "party", "dance", "pump", "run", "hype", "power",
    "adrenaline", "fast", "epic", "extreme", "heavy", "lift", "beast", "rage", "club"
  ],
  calm: [
    "calm", "relax", "peace", "sleep", "chill", "quiet", "meditate", "soft", "gentle",
    "breathe", "evening", "rain", "slow", "ambient", "serene", "soothing", "unwind"
  ],
  focus: [
    "focus", "study", "work", "concentrate", "code", "coding", "read", "exam",
    "deep", "productive", "flow", "writing", "deadline", "lofi", "instrumental", "background", "pomodoro"
  ],
};

function detectLocalMood(text: string): MoodKey {
  const lower = text.toLowerCase();
  const hindiMap: [string[], MoodKey][] = [
    [["dard", "judai", "rona", "roye", "gham", "udas", "dil toot", "tanha", "bikhra", "dil"], "sad"],
    [["khush", "khushi", "mast", "masti", "jashn", "nach", "maza", "vibe"], "happy"],
    [["pyar", "ishq", "mohobbat", "aashiq", "deewana", "sanam", "jaan", "pyaar"], "romantic"],
    [["sukoon", "shanti", "halka", "thanda", "aaram"], "calm"],
    [["josh", "dhamaka", "aag", "dum"], "energetic"],
    [["padhai", "study", "exam", "focus", "paper"], "focus"],
  ];
  for (const [words, mood] of hindiMap) {
    if (words.some((w) => lower.includes(w))) return mood;
  }

  let best: MoodKey = "calm";
  let bestScore = 0;
  (Object.keys(LOCAL_MOOD_KEYWORDS) as MoodKey[]).forEach((mood) => {
    const score = LOCAL_MOOD_KEYWORDS[mood].reduce((acc, word) => acc + (lower.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = mood;
    }
  });
  return best;
}

function normalizeMoodCandidate(value: unknown): MoodKey {
  const normalized = String(value ?? "").toLowerCase();
  return ALLOWED_MOODS.includes(normalized as MoodKey) ? (normalized as MoodKey) : "calm";
}

async function callServerAnalyse(text: string): Promise<{
  mood: MoodKey;
  emotion?: string;
  reply: string;
  tracks: Track[];
  source: string;
} | null> {
  try {
    const res = await fetch(`${API_BASE}/api/ai/analyse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const mood = normalizeMoodCandidate(data?.mood);
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    return {
      mood,
      emotion: data?.emotion ? String(data.emotion) : undefined,
      reply: String(data?.reply ?? ""),
      tracks,
      source: String(data?.source ?? "server"),
    };
  } catch {
    return null;
  }
}

const KNOWN_ARTISTS = [
  "arijit singh", "arijit", "atif aslam", "atif", "taylor swift", "taylor",
  "ed sheeran", "ed", "diljit dosanjh", "diljit", "shreya ghoshal", "kishore kumar",
  "lata mangeshkar", "mohit chauhan", "sonu nigam", "bruno mars", "billie eilish",
  "eminem", "coldplay", "drake", "post malone", "justin bieber", "anuv jain",
  "prateek kuhad", "ap dhillon", "shubh", "karan aujla", "charlie puth", "adele",
  "dua lipa", "lana del rey",
];

const KNOWN_GENRES = [
  "phonk", "lofi", "ghazal", "rock", "pop", "hip hop", "rap", "sufi",
  "classical", "acoustic", "metal", "edm", "qawwali", "indie", "bollywood",
  "punjabi", "k-pop", "kpop", "synthwave", "r&b", "jazz", "soul", "blues", "ambient", "drill", "bhangra"
];

const KNOWN_ACTIVITIES = [
  { words: ["gym", "workout", "deadlift", "lift", "training", "cardio", "pump"], tag: "gym" },
  { words: ["late night", "night", "midnight", "nocturnal", "sleepless", "insomnia"], tag: "late night" },
  { words: ["driving", "drive", "road trip", "car ride", "highway"], tag: "driving" },
  { words: ["exercise", "cardio", "workout"], tag: "gym" },
];

function buildLocalQueries(text: string): string[] {
  const lower = text.toLowerCase();
  const artist = KNOWN_ARTISTS.find((a) => lower.includes(a));
  if (artist) {
    return [`${artist} emotional song`, `${artist} popular tracks`, `${artist} hit songs`];
  }

  const genre = KNOWN_GENRES.find((g) => lower.includes(g));
  const activity = KNOWN_ACTIVITIES.find((a) => a.words.some((w) => lower.includes(w)))?.tag;
  const fallbackMood = detectLocalMood(text);

  if (activity === "gym") {
    return [`${genre || "workout"} phonk song`, "gym motivation anthem", "workout power track"];
  }
  if (activity === "late night") {
    return ["late night calm song", "sleep lofi ambient", "peaceful night acoustic"];
  }
  if (activity === "driving") {
    return ["long drive upbeat song", "night drive synthwave track", "road trip vibe song"];
  }
  if (genre) {
    return [`${genre} hit song`, `${fallbackMood} ${genre} track`];
  }

  const def = MOODS.find((m) => m.key === fallbackMood) ?? MOODS[0];
  return [...def.queries];
}

export interface MoodAnalysis {
  mood: MoodKey;
  source: "huggingface" | "local" | "server";
  sentiment?: "POSITIVE" | "NEGATIVE" | null;
  emotion?: string;
  reply: string;
  tracks: Track[];
}

export async function analyseMood(text: string): Promise<MoodAnalysis> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Mood prompt cannot be empty");

  const localMood = detectLocalMood(trimmed);
  const server = await callServerAnalyse(trimmed);

  let mood = localMood;
  let source: MoodAnalysis["source"] = "local";
  let emotion: string | undefined;
  let reply = "";
  let tracks: Track[] = [];

  if (server) {
    source = server.source === "huggingface" ? "huggingface" : "server";
    emotion = server.emotion;
    reply = server.reply;
    tracks = server.tracks;

    if (localMood !== "calm" && server.mood === "calm") {
      mood = localMood;
    } else {
      mood = server.mood;
    }
  }

  if (!tracks.length) {
    const queries = buildLocalQueries(trimmed).slice(0, 3);
    for (const query of queries) {
      const next = await searchTracks(query, 8).catch(() => [] as Track[]);
      tracks = tracks.concat(next);
      if (tracks.length >= 10) break;
    }
  }

  const limited = tracks.slice(0, 12);
  if (!reply) {
    reply = limited.length
      ? `Here are ${limited.length} ${mood} tracks selected for how you feel.`
      : `I tuned into ${mood}, but couldn't find matching songs right now. Try another feeling or artist.`;
  }

  return {
    mood,
    source,
    sentiment: null,
    emotion,
    reply,
    tracks: limited,
  };
}

export function moodLabel(key: MoodKey) {
  return MOODS.find((m) => m.key === key)?.label ?? key;
}

