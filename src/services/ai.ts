import { MOODS, MOOD_DEMO_MAP, findsDemo, DEMO_TRACKS } from "../data/demo";
import { searchTracks } from "./api";
import type { MoodKey, Track } from "../types";

/* ------------------------------------------------------------------
 * Hugging Face Inference API
 * Uses the modern router endpoint with Llama 3.1 8B Instruct.
 * Falls back to local keyword engine if key is absent or offline.
 * ------------------------------------------------------------------ */

const HF_KEY = (import.meta.env.VITE_HUGGING_FACE_API_KEY ?? "").trim();

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct";

const MOOD_KEYWORDS: Record<MoodKey, string[]> = {
  happy: ["happy", "joy", "great", "awesome", "excited", "good", "amazing", "wonderful", "glad", "cheerful", "delighted", "grateful", "love", "sunny"],
  sad: ["sad", "down", "depressed", "heartbroken", "lonely", "cry", "upset", "miserable", "grief", "blue", "miss", "hurt", "tired", "empty"],
  romantic: ["love", "romantic", "crush", "date", "valentine", "beloved", "heart", "adore", "anniversary", "wedding", "beautiful", "someone"],
  energetic: ["energy", "workout", "gym", "party", "dance", "pump", "run", "hype", "power", "adrenaline", "fast", "epic", "extreme"],
  calm: ["calm", "relax", "peace", "sleep", "chill", "quiet", "meditate", "soft", "gentle", "breathe", "evening", "rain", "slow"],
  focus: ["focus", "study", "work", "concentrate", "code", "read", "exam", "deep", "productive", "flow", "writing", "deadline"],
};

function localMoodDetect(text: string): MoodKey {
  const lower = text.toLowerCase();
  let best: MoodKey = "calm";
  let bestScore = 0;
  (Object.keys(MOOD_KEYWORDS) as MoodKey[]).forEach((k) => {
    const score = MOOD_KEYWORDS[k].reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  });
  return bestScore === 0 ? "calm" : best;
}

const VALID_MOODS: Set<string> = new Set(["happy", "sad", "romantic", "energetic", "calm", "focus"]);

/**
 * Call Hugging Face modern chat completions to analyze mood & get personalized insight.
 */
async function hfAnalyze(text: string): Promise<{ mood: MoodKey; sentiment: "POSITIVE" | "NEGATIVE"; vibe: string } | null> {
  if (!HF_KEY || HF_KEY.length < 8) return null;

  try {
    const payload = {
      model: HF_MODEL,
      messages: [
        {
          role: "system",
          content:
            'You are a music mood detector. Analyze the user text and reply ONLY valid JSON with keys: {"mood": "happy"|"sad"|"romantic"|"energetic"|"calm"|"focus", "sentiment": "POSITIVE"|"NEGATIVE", "vibe": "one short engaging sentence"}',
        },
        { role: "user", content: text },
      ],
      max_tokens: 80,
      temperature: 0.7,
    };

    const res = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const rawContent = data?.choices?.[0]?.message?.content?.trim();
    if (!rawContent) return null;

    // Parse JSON from output
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const m = String(parsed.mood || "").toLowerCase();
      const mood: MoodKey = VALID_MOODS.has(m) ? (m as MoodKey) : localMoodDetect(text);
      const sentiment: "POSITIVE" | "NEGATIVE" =
        parsed.sentiment === "NEGATIVE" ? "NEGATIVE" : "POSITIVE";
      const vibe = typeof parsed.vibe === "string" ? parsed.vibe.trim() : "";
      return { mood, sentiment, vibe };
    }
  } catch {
    /* fallback to local */
  }

  return null;
}

export interface MoodAnalysis {
  mood: MoodKey;
  source: "huggingface" | "local";
  sentiment: "POSITIVE" | "NEGATIVE" | null;
  reply: string;
  tracks: Track[];
}

const REPLY_OPENERS: Record<MoodKey, string> = {
  happy: "Love that energy — keeping it bright.",
  sad: "Something gentle coming up. Take it slow.",
  romantic: "Lean into it — candlelight frequencies ahead.",
  energetic: "Strap in. Tempo up, volume up.",
  calm: "Let the noise settle for a while.",
  focus: "Phones down. Deep-focus session curated.",
};

export async function analyseMood(text: string): Promise<MoodAnalysis> {
  const hfRes = await hfAnalyze(text);

  let mood: MoodKey;
  let source: "huggingface" | "local" = "local";
  let sentiment: "POSITIVE" | "NEGATIVE" | null = null;
  let customVibe = "";

  if (hfRes) {
    source = "huggingface";
    mood = hfRes.mood;
    sentiment = hfRes.sentiment;
    customVibe = hfRes.vibe;
  } else {
    mood = localMoodDetect(text);
    sentiment = ["happy", "romantic", "energetic"].includes(mood) ? "POSITIVE" : "NEGATIVE";
  }

  // Recommendations: live search when services are up, demo catalogue otherwise.
  const moodDef = MOODS.find((m) => m.key === mood) ?? MOODS[0];
  let tracks: Track[] = [];
  for (const q of moodDef.queries.slice(0, 2)) {
    try {
      const found = await searchTracks(`${q}`);
      tracks = tracks.concat(found.filter((t) => !tracks.some((x) => x.id === t.id)).slice(0, 3));
    } catch {
      /* offline */
    }
    if (tracks.length >= 4) break;
  }
  if (!tracks.length) {
    const ids = MOOD_DEMO_MAP[mood] ?? [];
    tracks = ids.map((id) => findsDemo(id)).filter(Boolean) as Track[];
    if (!tracks.length) tracks = DEMO_TRACKS.slice(0, 3);
  }

  const reply = customVibe
    ? `${REPLY_OPENERS[mood]} — “${customVibe}” Here are a few picks tuned to your mood:`
    : `${REPLY_OPENERS[mood]} Here are a few picks tuned to your mood:`;

  return { mood, source, sentiment, reply, tracks: tracks.slice(0, 5) };
}

export function moodLabel(key: MoodKey) {
  return MOODS.find((m) => m.key === key)?.label ?? key;
}
