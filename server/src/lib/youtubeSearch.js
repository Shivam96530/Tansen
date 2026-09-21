import axios from "axios";

// In-memory cache for search results to avoid redundant external network requests
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const searchCache = new Map();

function getCached(key) {
  const item = searchCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    searchCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  if (searchCache.size > 250) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  searchCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

function parseDuration(durationStr = "0:00") {
  const parts = String(durationStr).split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Tier 1: YouTube InnerTube API
 * High-speed, lightweight endpoint used by YouTube web/mobile clients.
 */
async function searchWithInnertube(query, limit = 15) {
  try {
    const res = await axios.post(
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
            hl: "en",
            gl: "US",
          },
        },
        query,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 6000,
      }
    );

    const contents =
      res.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const items = [];
    for (const c of contents) {
      const v = c?.videoRenderer;
      if (!v || !v.videoId) continue;
      const title = v.title?.runs?.[0]?.text || "";
      const artist =
        v.ownerText?.runs?.[0]?.text ||
        v.shortBylineText?.runs?.[0]?.text ||
        "Unknown artist";
      const duration = parseDuration(v.lengthText?.simpleText || "0:00");
      const thumbnail =
        v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

      items.push({
        id: v.videoId,
        title,
        artist,
        channel: artist,
        thumbnail,
        duration,
        source: "youtube",
      });
      if (items.length >= limit) break;
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Tier 2: YouTube HTML scrape with ytInitialData
 * Parses the initial state embedded in youtube.com/results HTML.
 */
async function searchWithHtmlScrape(query, limit = 15) {
  try {
    const res = await axios.get(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 7000,
      }
    );

    const match =
      res.data.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
      res.data.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match) return [];

    const data = JSON.parse(match[1]);
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const items = [];
    for (const c of contents) {
      const v = c?.videoRenderer;
      if (!v || !v.videoId) continue;
      const title = v.title?.runs?.[0]?.text || "";
      const artist =
        v.ownerText?.runs?.[0]?.text ||
        v.shortBylineText?.runs?.[0]?.text ||
        "Unknown artist";
      const duration = parseDuration(v.lengthText?.simpleText || "0:00");
      const thumbnail =
        v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

      items.push({
        id: v.videoId,
        title,
        artist,
        channel: artist,
        thumbnail,
        duration,
        source: "youtube",
      });
      if (items.length >= limit) break;
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Tier 3: Invidious public instance fallback
 */
async function searchWithInvidious(query, limit = 15) {
  const instances = [
    "https://inv.tux.pizza",
    "https://invidious.nerdvpn.de",
    "https://invidious.private.coffee",
  ];
  for (const base of instances) {
    try {
      const res = await axios.get(`${base}/api/v1/search`, {
        params: { q: query, type: "video" },
        timeout: 4000,
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        return res.data
          .filter((v) => v.videoId && v.title)
          .slice(0, limit)
          .map((v) => ({
            id: v.videoId,
            title: v.title,
            artist: v.author || "Unknown artist",
            channel: v.author || "",
            thumbnail:
              v.videoThumbnails?.[0]?.url ||
              `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            duration: Number(v.lengthSeconds || 0),
            source: "youtube",
          }));
      }
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Tier 4: Python Flask stream engine fallback
 */
async function searchWithStreamEngine(query, limit = 15) {
  const streamBase = (process.env.STREAM_BASE_URL || "http://localhost:5002").replace(/\/+$/, "");
  try {
    const { data } = await axios.get(`${streamBase}/search`, {
      params: { q: query, limit },
      timeout: 5000,
    });
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    return results.map((raw) => ({
      id: String(raw?.id ?? raw?.videoId ?? "").trim(),
      title: String(raw?.title ?? "").trim(),
      artist: String(raw?.artist ?? raw?.uploader ?? raw?.channel ?? "Unknown artist").trim(),
      channel: String(raw?.channel ?? raw?.uploader ?? raw?.artist ?? "").trim(),
      thumbnail:
        raw?.thumbnail ??
        (raw?.id || raw?.videoId ? `https://i.ytimg.com/vi/${raw?.id ?? raw?.videoId}/hqdefault.jpg` : null),
      duration: Number(raw?.duration ?? 0),
      source: "youtube",
    })).filter((t) => t.id && t.title);
  } catch {
    return [];
  }
}

/**
 * Main search function with multi-tier fallbacks and in-memory cache.
 * Executes in ~500-900ms directly in Node.js without waiting on Python/yt-dlp.
 */
export async function directYoutubeSearch(query, limit = 15) {
  const q = String(query || "").trim();
  if (!q) return [];

  const cacheKey = `${q.toLowerCase()}|${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  // 1. Try InnerTube (fastest, most reliable)
  let results = await searchWithInnertube(q, limit);

  // 2. Try HTML scraping fallback
  if (!results || results.length === 0) {
    results = await searchWithHtmlScrape(q, limit);
  }

  // 3. Try Invidious public instance fallback
  if (!results || results.length === 0) {
    results = await searchWithInvidious(q, limit);
  }

  // 4. Try Python stream engine if available
  if (!results || results.length === 0) {
    results = await searchWithStreamEngine(q, limit);
  }

  if (results && results.length > 0) {
    setCached(cacheKey, results);
  }

  return results || [];
}
