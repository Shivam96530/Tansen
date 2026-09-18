export interface Track {
  id: string;
  title: string;
  artist: string;
  channel?: string;
  canonicalTitle?: string;
  canonicalArtist?: string;
  canonicalDuration?: number;
  thumbnail: string | null;
  duration: number; // seconds
  source: "youtube" | "genius";
}

export interface LyricsResult {
  lyrics: string;
  title?: string;
  artist?: string;
  syncedLyrics?: string | null;
  source?: string;
  confidence?: number;
}

export type MoodKey =
  | "happy"
  | "sad"
  | "romantic"
  | "energetic"
  | "calm"
  | "focus";

export interface MoodInfo {
  key: MoodKey;
  label: string;
  blurb: string;
  accent: string; // tailwind-friendly hex
  queries: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  mood?: MoodKey;
  emotion?: string;
  tracks?: Track[];
}

export type ViewKey = "landing" | "search" | "studio";

