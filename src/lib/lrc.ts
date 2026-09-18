export interface LrcLine {
  t: number; // seconds
  text: string;
}

/**
 * Parse an LRC formatted string ([mm:ss.xx] lyrics) into a sorted array of lines.
 * Supports [offset:+-ms], instrumental empty timestamps, and dedupes identical timestamps.
 */
export function parseLrc(lrc: string): LrcLine[] {
  if (!lrc) return [];
  const out: LrcLine[] = [];
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const offsetMatch = lrc.match(/\[offset:([+-]?\d+)\]/i);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

  for (const row of lrc.split("\n")) {
    re.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(row)) !== null) {
      const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) : 0;
      stamps.push(
        Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac / 1000 + offsetSeconds)
      );
    }
    const text = row.replace(re, "").trim();
    if (stamps.length) {
      // Empty timestamp rows represent instrumental gaps. Preserve them so
      // an old lyric does not remain on screen while nobody is singing.
      stamps.forEach((t) => out.push({ t, text }));
    }
  }

  return out
    .sort((a, b) => a.t - b.t)
    .filter((line, index, all) => {
      const prev = all[index - 1];
      return !prev || prev.t !== line.t || prev.text !== line.text;
    });
}

/**
 * Given sorted LRC lines and current playback time, find the index of the active line.
 * Frame-accurate binary search: returns the line whose timestamp is <= currentTime + leadSeconds.
 * leadSeconds compensates for audio output and perceptual vocal onset latency.
 */
export function activeIndex(lines: LrcLine[], currentTime: number, leadSeconds: number = 0): number {
  const effectiveTime = currentTime + leadSeconds;
  if (!lines.length || effectiveTime < lines[0].t) return -1;
  let low = 0;
  let high = lines.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].t <= effectiveTime) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate;
}

/** Backward compatibility alias for findActiveLine */
export function findActiveLine(lines: LrcLine[], currentTime: number, leadSeconds: number = 0): number {
  return activeIndex(lines, currentTime, leadSeconds);
}
