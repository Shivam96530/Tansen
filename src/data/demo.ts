import type { MoodInfo, Track } from "../types";

/* Curated offline catalogue — used as a graceful fallback when the
   local Express (5001) / Flask (5002) services are not running. */

const D = (m: number, s: number) => m * 60 + s;

export const DEMO_TRACKS: Track[] = [
  { id: "demo-01", title: "Raag Yaman — Alaap", artist: "Prism Ensemble", thumbnail: null, duration: D(7, 24), source: "demo" },
  { id: "demo-02", title: "Monsoon Reverie", artist: "Kaveri", thumbnail: null, duration: D(4, 12), source: "demo" },
  { id: "demo-03", title: "Midnight in Jaipur", artist: "Analog Sufi", thumbnail: null, duration: D(5, 41), source: "demo" },
  { id: "demo-04", title: "Golden Hour (Reprise)", artist: "Neral & Co.", thumbnail: null, duration: D(3, 56), source: "demo" },
  { id: "demo-05", title: "Paper Boats", artist: "Warm Static", thumbnail: null, duration: D(4, 33), source: "demo" },
  { id: "demo-06", title: "Chandni", artist: "Aria Vale", thumbnail: null, duration: D(5, 7), source: "demo" },
  { id: "demo-07", title: "Voltage", artist: "Kileva", thumbnail: null, duration: D(3, 21), source: "demo" },
  { id: "demo-08", title: "Slow Rivers", artist: "Fernway", thumbnail: null, duration: D(6, 2), source: "demo" },
];

export const DEMO_LYRICS: Record<string, string> = {
  default: `There is a hush between the verses,
a light that leans against the door.
The river hums in minor cadence,
the evening asks for nothing more.

And if the night should come uninvited,
we'll let it stay — we'll let it sing.
For every word we left unspoken
finds its voice in how the strings.

Slow, the brass of sunset fading,
slow, the current of the song.
Wherever you have been, you're welcome —
this is where the lost things belong.`,

  "demo-01": `Alaap — slow, unfurling.
The drone holds the room
like breath held before a prayer.

Sa… re… ga… ma… pa…
each note a step
on a staircase lit by lamps.

No words. Only ascent.
Dusk folded into sound,
sound folded into dusk.`,

  "demo-07": `Wires humming in the wall light,
city shaking off the day.
Every window is a circuit,
every heartbeat finds its way.

Turn it, turn it, let it run now —
current doesn't ask your name.
Voltage in your open hands,
you were never built the same.`,
};

export const MOODS: MoodInfo[] = [
  {
    key: "happy",
    label: "Happy",
    blurb: "Sunlit, buoyant, weightless",
    accent: "#f0a832",
    queries: ["feel good hits", "upbeat pop", "pharrell happy"],
  },
  {
    key: "sad",
    label: "Melancholy",
    blurb: "Rain on glass, slow strings",
    accent: "#9b8cff",
    queries: ["sad songs playlist", "adele piano ballads", "heartbreak acoustic"],
  },
  {
    key: "romantic",
    label: "Romantic",
    blurb: "Candlelight and slow dance",
    accent: "#ff6b8b",
    queries: ["romantic love songs", "olden hindi romantic", "bossa love"],
  },
  {
    key: "energetic",
    label: "Energetic",
    blurb: "Adrenaline, tempo, strobe",
    accent: "#5fd9a4",
    queries: ["edm workout mix", "high energy dance", "rock anthems"],
  },
  {
    key: "calm",
    label: "Calm",
    blurb: "Still water, soft focus",
    accent: "#6fc3df",
    queries: ["ambient sleep music", "meditation flute", "lofi calm"],
  },
  {
    key: "focus",
    label: "Focus",
    blurb: "Deep work frequencies",
    accent: "#e8e6dd",
    queries: ["study lofi beats", "focus ambient", "minimal piano concentration"],
  },
];

export const MOOD_DEMO_MAP: Record<string, string[]> = {
  happy: ["demo-04", "demo-02", "demo-07"],
  sad: ["demo-08", "demo-05", "demo-06"],
  romantic: ["demo-06", "demo-03", "demo-01"],
  energetic: ["demo-07", "demo-04", "demo-02"],
  calm: ["demo-01", "demo-08", "demo-03"],
  focus: ["demo-08", "demo-01", "demo-05"],
};

export const findsDemo = (id: string) => DEMO_TRACKS.find((t) => t.id === id);
