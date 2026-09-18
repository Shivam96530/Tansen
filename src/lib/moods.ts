import type { MoodInfo } from "../types";

export const MOODS: MoodInfo[] = [
  {
    key: "happy",
    label: "Happy",
    blurb: "Sunlit, buoyant, weightless",
    accent: "#f0a832",
    queries: ["feel good upbeat hit song", "sunshine happy pop song", "cheerful acoustic positive song"],
  },
  {
    key: "sad",
    label: "Melancholy",
    blurb: "Rain on glass, slow strings",
    accent: "#9b8cff",
    queries: ["heartbreak emotional acoustic song", "sad piano ballad song", "deep emotional tearjerker song"],
  },
  {
    key: "romantic",
    label: "Romantic",
    blurb: "Candlelight and slow dance",
    accent: "#ff6b8b",
    queries: ["romantic acoustic love song", "slow dance romantic ballad", "heartfelt timeless love song"],
  },
  {
    key: "energetic",
    label: "Energetic",
    blurb: "Adrenaline, tempo, strobe",
    accent: "#5fd9a4",
    queries: ["high energy workout pump song", "hype adrenaline dance song", "hard hitting rock anthem song"],
  },
  {
    key: "calm",
    label: "Calm",
    blurb: "Still water, soft focus",
    accent: "#6fc3df",
    queries: ["peaceful acoustic chill song", "calming ambient acoustic melody", "relaxing slow acoustic song"],
  },
  {
    key: "focus",
    label: "Focus",
    blurb: "Deep work frequencies",
    accent: "#e8e6dd",
    queries: ["deep focus chill lofi beat", "ambient concentration instrumental", "minimal relaxing piano study track"],
  },
];
