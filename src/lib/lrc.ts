export interface LrcLine {
  t: number; // seconds
  text: string;
}

/**
 * Parse an LRC formatted string ([mm:ss.xx] lyrics) into a sorted array of lines.
 * Supports:
 * - [offset:+-ms] tags
 * - Automatic intro-shift alignment when YouTube audio has pre-roll logos/intros
 * - Automatic linear tempo-scaling when YouTube audio is sped up or slowed down
 * - Instrumental gap preservation and deduplication
 */
export function parseLrc(
  lrc: string,
  audioDuration: number = 0,
  refDuration: number = 0
): LrcLine[] {
  if (!lrc) return [];
  const rawLines: LrcLine[] = [];
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?(?:-\d+)?\]/g;
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
    const text = row.replace(/\[\d{1,2}:\d{2}[^\]]*\]/g, "").trim();
    if (stamps.length) {
      // Empty timestamp rows represent instrumental gaps. Preserve them so
      // an old lyric does not remain on screen while nobody is singing.
      stamps.forEach((t) => rawLines.push({ t, text }));
    }
  }

  if (!rawLines.length) return [];

  rawLines.sort((a, b) => a.t - b.t);

  // Deduplicate identical timestamps
  const unique = rawLines.filter((line, index, all) => {
    const prev = all[index - 1];
    return !prev || prev.t !== line.t || prev.text !== line.text;
  });

  if (!unique.length) return [];

  // --- Intelligent Automatic Alignment ---
  // When both the YouTube audio duration and reference track duration are available:
  let timeShift = 0;
  let timeScale = 1.0;

  if (audioDuration > 20 && refDuration > 20) {
    const durationDelta = audioDuration - refDuration;
    const ratio = audioDuration / refDuration;

    // Case 1: Video Intro / Logo padding (e.g. 1.2s to 9.0s extra length at the start)
    // Common in YouTube music videos from T-Series, Coke Studio, YRF, Zee Music, etc.
    if (durationDelta >= 1.2 && durationDelta <= 9.0) {
      const lastT = unique[unique.length - 1].t;
      if (lastT + durationDelta <= audioDuration + 2.0) {
        timeShift = durationDelta;
      }
    }
    // Case 2: Slight tempo / speed variation (between 0.93x and 1.07x) without massive intro
    else if (Math.abs(durationDelta) > 1.0 && ratio >= 0.93 && ratio <= 1.07) {
      timeScale = ratio;
    }
  }

  // Apply calibration if needed
  if (timeShift !== 0 || timeScale !== 1.0) {
    return unique.map((line) => ({
      t: Math.max(0, Number((line.t * timeScale + timeShift).toFixed(3))),
      text: line.text,
    }));
  }

  return unique;
}

/**
 * Calculates adaptive acoustic lead based on song lyric density and tempo.
 * Fast-paced songs get a tight lead (0.12s - 0.20s) to prevent lyrics flashing too early.
 * Slow-paced ballads get a relaxed lead (0.28s - 0.36s) to allow natural articulation.
 */
export function calculateAdaptiveLead(lines: LrcLine[]): number {
  if (!lines || lines.length < 4) return 0.26;
  const first = lines[0].t;
  const last = lines[lines.length - 1].t;
  const span = last - first;
  if (span <= 0) return 0.26;

  const avgGap = span / lines.length;
  // Fast song / rap: lines change rapidly (< 2.8s per line, e.g. rap, drill, fast pop)
  // Rapid vocal delivery requires a prompt 0.30s visual lead so lyrics appear right as the bar drops
  if (avgGap <= 2.8) {
    return 0.30;
  }
  // Slow song: lines change slowly (> 4.5s per line, e.g. slow ballad, ghazal)
  if (avgGap >= 4.5) {
    return Math.min(0.36, 0.28 + Math.min(avgGap - 4.5, 3.0) * 0.025); // 0.28s to 0.36s
  }
  // Normal song (2.8s to 4.5s average line duration)
  return 0.26;
}

/**
 * Given sorted LRC lines and current playback time, find the index of the active line.
 * Frame-accurate binary search using adaptive tempo-aware lead compensation.
 */
export function activeIndex(
  lines: LrcLine[],
  currentTime: number,
  leadSeconds?: number
): number {
  const effectiveLead =
    typeof leadSeconds === "number" ? leadSeconds : calculateAdaptiveLead(lines);
  const effectiveTime = currentTime + effectiveLead;

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
export function findActiveLine(
  lines: LrcLine[],
  currentTime: number,
  leadSeconds?: number
): number {
  return activeIndex(lines, currentTime, leadSeconds);
}
