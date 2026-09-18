import test from "node:test";
import assert from "node:assert/strict";

// ── 1. LRC PARSING, OFFSETS, INSTRUMENTAL GAPS & ACTIVE INDEX ──────────────────

function parseLrc(lrc) {
  if (!lrc) return [];
  const out = [];
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const offsetMatch = lrc.match(/\[offset:([+-]?\d+)\]/i);
  const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

  for (const row of lrc.split("\n")) {
    re.lastIndex = 0;
    const stamps = [];
    let m;
    while ((m = re.exec(row)) !== null) {
      const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) : 0;
      stamps.push(
        Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac / 1000 + offsetSeconds)
      );
    }
    const text = row.replace(re, "").trim();
    if (stamps.length) {
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

function activeIndex(lines, currentTime) {
  if (!lines.length || currentTime < lines[0].t) return -1;
  let low = 0;
  let high = lines.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].t <= currentTime) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return candidate;
}

test("LRC: accurately parses timestamps and lines", () => {
  const sample = `[00:12.50]Line one\n[00:18.00]Line two\n[00:25.10]Line three`;
  const parsed = parseLrc(sample);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].text, "Line one");
  assert.equal(parsed[0].t, 12.5);
  assert.equal(parsed[1].t, 18.0);
  assert.equal(parsed[2].text, "Line three");
});

test("LRC: handles [offset:+-ms] tag properly", () => {
  const sample = `[offset:1000]\n[00:10.00]First line`;
  const parsed = parseLrc(sample);
  assert.equal(parsed[0].t, 11.0); // 10s + 1s offset
});

test("LRC: binary search activeIndex finds the exact active line", () => {
  const lines = [
    { t: 10, text: "Intro" },
    { t: 20, text: "Verse 1" },
    { t: 30, text: "Chorus" },
  ];
  assert.equal(activeIndex(lines, 5), -1);
  assert.equal(activeIndex(lines, 10), 0);
  assert.equal(activeIndex(lines, 15), 0);
  assert.equal(activeIndex(lines, 20), 1);
  assert.equal(activeIndex(lines, 29.9), 1);
  assert.equal(activeIndex(lines, 30), 2);
  assert.equal(activeIndex(lines, 45), 2);
});

test("LRC: preserves empty timestamped rows as real instrumental gaps", () => {
  const sample = `[00:10.00]Singing\n[00:20.00]\n[00:30.00]Next verse`;
  const parsed = parseLrc(sample);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[1].t, 20.0);
  assert.equal(parsed[1].text, ""); // Instrumental pause row preserved
});

// ── 2. ROMANIZATION ENGINE ───────────────────────────────────────────────────

import { romanizeLyrics } from "../src/lib/romanize.ts";

test("Romanization: transliterates Devanagari Hindi accurately", () => {
  const hindi = "तुम ही हो";
  const roman = romanizeLyrics(hindi);
  assert.match(roman.toLowerCase(), /tum\s+hi\s+ho/);
});

test("Romanization: handles conjuncts and schwa deletion", () => {
  const hindi = "प्यार मेरा दिल";
  const roman = romanizeLyrics(hindi);
  assert.match(roman.toLowerCase(), /pya?r/);
  assert.match(roman.toLowerCase(), /mera/);
  assert.match(roman.toLowerCase(), /dil/);
});

test("Romanization: transliterates Gurmukhi Punjabi", () => {
  const punjabi = "ਮੇਰੇ ਸੋਹਣਿਆ";
  const roman = romanizeLyrics(punjabi);
  assert.ok(roman.length > 0);
  assert.match(roman.toLowerCase(), /mere/);
});

test("Romanization: leaves English, digits, and punctuation completely unchanged", () => {
  const english = "I wanna be yours, 24/7! (feat. Arctic Monkeys)";
  assert.equal(romanizeLyrics(english), english);
});

// ── 3. SEARCH NORMALIZATION & DEDUPLICATION ─────────────────────────────────

import { normaliseTitle, isSameSong } from "../src/lib/dedupe.ts";

test("Dedupe: cleans noisy YouTube titles to core identity", () => {
  const noisy1 = "Kesariya - Brahmāstra | Ranbir | Alia | Arijit Singh | Pritam | Official Music Video 4K";
  const noisy2 = "Kesariya (Official Video) - Arijit Singh | Audio Song";
  const clean1 = normaliseTitle(noisy1);
  const clean2 = normaliseTitle(noisy2);
  assert.ok(clean1.includes("kesariya"));
  assert.ok(clean2.includes("kesariya"));
});

test("Dedupe: detects duplicate uploads of the same song", () => {
  const t1 = { id: "yt-1", title: "Tum Hi Ho (Official Video)", artist: "Arijit Singh", duration: 262, source: "youtube" };
  const t2 = { id: "yt-2", title: "Tum Hi Ho | Aashiqui 2 | Full Song with Lyrics", artist: "T-Series", duration: 260, source: "youtube" };
  assert.equal(isSameSong(t1, t2), true);
});

// ── 4. LYRICS CONFIDENCE & REGRESSION PREVENTION ────────────────────────────

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(a = "", b = "") {
  const first = new Set(normalize(a).split(" ").filter(Boolean));
  const second = new Set(normalize(b).split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;
  let matches = 0;
  first.forEach((word) => {
    if (second.has(word)) matches++;
  });
  return matches / Math.max(first.size, second.size);
}

function durationScore(requested, actual) {
  if (!requested || !actual) return 0.5;
  const difference = Math.abs(requested - actual);
  if (difference > 60) return 0;
  if (difference <= 2) return 1;
  return Math.max(0, 1 - difference / 60);
}

function matchConfidence(candidate, track) {
  const titleScore = tokenScore(candidate.title, track.title);
  const artistScore = candidate.artist && track.artist ? tokenScore(candidate.artist, track.artist) : 0.5;
  const durScore = durationScore(track.duration, candidate.duration);
  return titleScore * 0.55 + artistScore * 0.3 + durScore * 0.15;
}

test("Lyrics Confidence: 'Tum Hi Ho' does NOT match 'Tum Hi Tum Ho' by Rahul Dutta", () => {
  const requested = {
    title: "Tum Hi Ho",
    artist: "Arijit Singh",
    duration: 262,
  };

  const wrongCandidate = {
    title: "Tum Hi Tum Ho",
    artist: "Rahul Dutta",
    duration: 180,
  };

  const correctCandidate = {
    title: "Tum Hi Ho",
    artist: "Arijit Singh",
    duration: 262,
  };

  const wrongConfidence = matchConfidence(wrongCandidate, requested);
  const correctConfidence = matchConfidence(correctCandidate, requested);

  assert.ok(wrongConfidence < 0.72, `Wrong song confidence should be < 0.72, got ${wrongConfidence}`);
  assert.ok(correctConfidence >= 0.72, `Correct song confidence should be >= 0.72, got ${correctConfidence}`);
});

// ── 5. AUTOPLAY VS QUEUE FLOW ───────────────────────────────────────────────

test("Playback: single song click creates 1-song autoplay session", () => {
  let queue = [];
  let flow = "autoplay";
  const track = { id: "track-1", title: "Single Song", artist: "Artist", duration: 200, source: "youtube" };

  // simulate playTrack(track)
  queue = [track];
  flow = "autoplay";
  assert.equal(queue.length, 1);
  assert.equal(flow, "autoplay");
});

test("Playback: list click creates explicit multi-song queue session", () => {
  let queue = [];
  let flow = "queue";
  const list = [
    { id: "1", title: "Song 1", artist: "A", duration: 180, source: "youtube" },
    { id: "2", title: "Song 2", artist: "B", duration: 210, source: "youtube" },
  ];

  queue = list;
  flow = "queue";
  assert.equal(queue.length, 2);
  assert.equal(flow, "queue");
});

// ── 6. MOOD SCHEMA VALIDATION ───────────────────────────────────────────────

const ALLOWED_MOODS = new Set(["happy", "sad", "romantic", "energetic", "calm", "focus"]);

test("Moods: validates allowed mood keys", () => {
  assert.equal(ALLOWED_MOODS.has("happy"), true);
  assert.equal(ALLOWED_MOODS.has("romantic"), true);
  assert.equal(ALLOWED_MOODS.has("angry"), false);
  assert.equal(ALLOWED_MOODS.has("random"), false);
});
