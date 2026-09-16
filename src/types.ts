export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  duration: number; // seconds
  source: "youtube" | "genius" | "demo";
}

export interface LyricsResult {
  lyrics: string;
  title?: string;
  artist?: string;
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
  tracks?: Track[];
}

export type ViewKey = "home" | "search";

export interface ServiceStatus {
  api: "online" | "offline" | "checking";
  stream: "online" | "offline" | "checking";
}
