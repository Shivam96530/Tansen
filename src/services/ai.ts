import { MOODS, MOOD_DEMO_MAP, findsDemo, DEMO_TRACKS } from "../data/demo";
import { searchTracks } from "./api";
import type { MoodKey, Track } from "../types";

/* ------------------------------------------------------------------
 * Hugging Face Inference API — the same models as the original app:
 *   sentiment : distilbert-base-uncased-finetuned-sst-2-english
 *   generation: gpt2
 * A local keyword engine provides the same behaviour offline.
 * ------------------------------------------------------------------ */

const HF_KEY = import.meta.env.VITE_HUGGING_FACE_API_KEY ?? "";
/* Use the HF Inference API with task-specific endpoints.
   The /models/<name> path returns 400 on the router — use provider=hf-inference. */
const HF_INFERENCE_BASE = "https://api-inference.huggingface.co/models";
const SENTIMENT_MODEL = "distilbert-base-uncased-finetuned-sst-2-english";
const GEN_MODEL = "openai-community/gpt2";

/** POST to HF Inference API; retries once if the model is cold-starting (503 loading). */
async function hfPost(model: string, payload: unknown): Promise<Response | null> {
  if (!HF_KEY) return null;
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
        const wait = Math.min((body?.estimated_time ?? 10) * 1000, 20000);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }
  return null;
}

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

async function hfSentiment(text: string): Promise<"POSITIVE" | "NEGATIVE" | null> {
  if (!HF_KEY) return null;
  const res = await hfPost(SENTIMENT_MODEL, { inputs: text });
  if (!res) return null;
  try {
    const data = await res.json();
    const scores = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : [];
    const top = scores.sort((a: any, b: any) => b.score - a.score)[0];
    return top?.label ?? null;
  } catch {
    return null;
  }
}

async function hfGenerateLine(prompt: string): Promise<string | null> {
  if (!HF_KEY) return null;
  const res = await hfPost(GEN_MODEL, {
    inputs: prompt,
    parameters: { max_new_tokens: 24, temperature: 0.9, top_p: 0.92, return_full_text: false },
  });
  if (!res) return null;
  try {
    const data = await res.json();
    const text = data?.[0]?.generated_text?.trim();
    return text ? text.split("\n")[0].slice(0, 140) : null;
  } catch {
    return null;
  }
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
  const sentiment = await hfSentiment(text);
  let mood: MoodKey;
  let source: "huggingface" | "local" = "local";

  if (sentiment) {
    source = "huggingface";
    // DistilBERT gives polarity; blend with keyword scan for nuance.
    const local = localMoodDetect(text);
    if (local !== "calm") {
      mood = local; // specific keyword beats polarity
    } else {
      mood = sentiment === "POSITIVE" ? "happy" : "sad";
    }
  } else {
    mood = localMoodDetect(text);
  }

  const gptLine = await hfGenerateLine(`A ${mood} playlist makes you feel`);

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

  const reply = `${REPLY_OPENERS[mood]}${gptLine ? ` — “${gptLine}”` : ""} Here are a few picks tuned to your mood:`;

  return { mood, source, sentiment, reply, tracks: tracks.slice(0, 5) };
}

export function moodLabel(key: MoodKey) {
  return MOODS.find((m) => m.key === key)?.label ?? key;
}
