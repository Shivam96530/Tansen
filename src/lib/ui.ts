import type { MoodKey } from "../types";

export const fmtTime = (sec: number) => {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** Broadcast a mood request — the AI studio listens and auto-analyses. */
export const requestMood = (mood: MoodKey) => {
  window.dispatchEvent(new CustomEvent<MoodKey>("tansen:mood", { detail: mood }));
};
