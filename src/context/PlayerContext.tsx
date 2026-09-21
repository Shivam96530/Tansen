import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getLyrics, getRelatedTracks, getStreamSources, probeStream, searchTracks } from "../services/api";
import { dedupeTracks, songKey } from "../lib/dedupe";
import type { LyricsResult, Track, ViewKey } from "../types";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type RepeatMode = "off" | "all" | "one";
type Engine = "audio" | "youtube";
type StartResult = "playing" | "blocked" | "failed" | "stale";

/** How long we wait for the first audible frame from the stream proxy (yt-dlp can be slow on a cold start). */
const STREAM_START_TIMEOUT_MS = 25000;
/** After repeated stream failures, skip straight to the YouTube player for this long. */
const STREAM_COOLDOWN_MS = 5 * 60 * 1000;
/** Start fetching the next radio tracks this many seconds before the current one ends. */
const PREFETCH_WINDOW_SEC = 25;

interface PlayerState {
  // Navigation & View Mode
  mode: ViewKey;
  setMode: (m: ViewKey) => void;
  immersive: boolean;
  setImmersive: (b: boolean) => void;
  navigateBack: () => void;
  query: string;
  search: (q: string) => Promise<void>;
  clearSearch: () => void;
  results: Track[];
  searching: boolean;

  // Queue & Playback
  queue: Track[];
  queueIndex: number;
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  progress: number;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  radio: boolean;
  radioLoading: boolean;
  toggleRadio: () => void;

  playTrack: (track: Track, queue?: Track[], seedQuery?: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  enqueue: (t: Track) => void;
  dismissTrack: () => void;

  // Lyrics
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;
}

const Ctx = createContext<PlayerState | null>(null);

export const usePlayer = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
};

function parsePathToRoute(pathname: string): { mode: ViewKey; immersive: boolean } {
  const norm = (pathname || "/").toLowerCase();
  if (norm === "/player") {
    return { mode: "landing", immersive: false };
  }
  if (norm === "/search") {
    return { mode: "search", immersive: false };
  }
  if (norm === "/mood" || norm === "/studio") {
    return { mode: "studio", immersive: false };
  }
  return { mode: "landing", immersive: false };
}

function modeToPath(m: ViewKey): string {
  if (m === "search") return "/search";
  if (m === "studio") return "/mood";
  return "/";
}

/* ------------------------------------------------------------------
 * Media Session helpers (lock screen / notification shade / headset keys)
 * All calls are wrapped: browsers differ in which parts they support and
 * some throw on unsupported actions or invalid position values.
 * ------------------------------------------------------------------ */

const hasMediaSession = () => typeof navigator !== "undefined" && "mediaSession" in navigator;

function setMediaMetadata(track: Track | null) {
  if (!hasMediaSession()) return;
  try {
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const art = track.thumbnail || (track.id ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` : "");
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: "Tansen",
      artwork: art ? [{ src: art, sizes: "480x360", type: "image/jpeg" }] : [],
    });
  } catch {
    /* ignore */
  }
}

function setMediaPlaybackState(state: MediaSessionPlaybackState) {
  if (!hasMediaSession()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}

function setMediaPosition(duration: number, position: number) {
  if (!hasMediaSession() || typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const pos = Math.min(Math.max(Number.isFinite(position) ? position : 0, 0), duration);
  try {
    navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: pos });
  } catch {
    /* ignore */
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ViewKey>(() => {
    return parsePathToRoute(typeof window !== "undefined" ? window.location.pathname : "/").mode;
  });
  const [immersive, setImmersiveState] = useState<boolean>(() => {
    return parsePathToRoute(typeof window !== "undefined" ? window.location.pathname : "/").immersive;
  });

  const modeRef = useRef<ViewKey>(mode);
  modeRef.current = mode;
  const immersiveRef = useRef<boolean>(immersive);
  immersiveRef.current = immersive;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);

  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [current, setCurrent] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [radio, setRadio] = useState(true);
  const [radioLoading, setRadioLoading] = useState(false);

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  /* ---- Engines -------------------------------------------------------
   * "audio"   : ONE permanent <audio> element playing our same-origin stream proxy.
   *             This is what the phone OS treats as real media: it keeps playing
   *             with the screen locked and drives the lock-screen controls.
   * "youtube" : last-resort IFrame fallback. YouTube deliberately pauses embeds
   *             in background tabs, so this cannot play with the screen locked.
   * The engine lives in a ref (not state) so event handlers always see the
   * current value without waiting for a re-render.
   * ------------------------------------------------------------------ */
  const engineRef = useRef<Engine>("audio");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSrcRef = useRef("");
  const ytPlayerRef = useRef<any>(null);
  const pendingTrackIdRef = useRef<string | null>(null);
  const resumeOnVisibleRef = useRef(false);
  const startingRef = useRef(false);
  const retryRef = useRef({ id: "", n: 0 });

  const loadId = useRef(0);
  const lyricsCache = useRef(new Map<string, LyricsResult>());
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const queueRef = useRef(queue);
  const idxRef = useRef(queueIndex);
  const radioRef = useRef(radio);
  const volumeRef = useRef(volume);
  const durationRef = useRef(duration);
  const currentRef = useRef<Track | null>(null);
  const isPlayingRef = useRef(false);
  const heardRef = useRef<Set<string>>(new Set());
  const flowRef = useRef<"queue" | "autoplay">("autoplay");
  const seedQueryRef = useRef<string>("");

  const radioInflight = useRef<Promise<Track[]> | null>(null);
  const extendBusy = useRef(false);
  const prefetchedFor = useRef(-1);
  const streamHealthRef = useRef({ failures: 0, disabledUntil: 0 });
  const lastProbeRef = useRef(0);

  /* ---- Debug panel: open the site with ?debug=1 to see which engine plays and why ---- */
  const [debugEnabled] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1"
  );
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const note = useCallback(
    (line: string) => {
      console.info("[tansen]", line);
      if (debugEnabled) setDebugLines((l) => [...l.slice(-7), `${new Date().toLocaleTimeString()} ${line}`]);
    },
    [debugEnabled]
  );

  const handleEndedRef = useRef<() => void>(() => {});
  const maybePrefetchRef = useRef<(cur: number, dur: number) => void>(() => {});
  const actionsRef = useRef({
    resume: () => {},
    pause: () => {},
    next: () => {},
    prev: () => {},
    seek: (_sec: number) => {},
  });

  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  queueRef.current = queue;
  idxRef.current = queueIndex;
  radioRef.current = radio;
  volumeRef.current = volume;
  durationRef.current = duration;

  /* ---- Route & History synchronization ---- */
  const clearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setSearching(false);
  }, []);

  const setMode = useCallback((m: ViewKey) => {
    const targetPath = modeToPath(m);
    if (typeof window !== "undefined") {
      if (window.location.pathname.toLowerCase() !== targetPath) {
        window.history.pushState({ tansen: true, mode: m, immersive: false }, "", targetPath);
      }
    }
    if (m === "landing") {
      clearSearch();
    }
    setModeState(m);
    setImmersiveState(false);
  }, [clearSearch]);

  const setImmersive = useCallback((b: boolean) => {
    if (typeof window === "undefined") {
      setImmersiveState(b);
      return;
    }

    if (b) {
      if (window.location.pathname.toLowerCase() !== "/player") {
        window.history.pushState(
          { tansen: true, mode: modeRef.current, immersive: true },
          "",
          "/player"
        );
      }
      setImmersiveState(true);
    } else {
      if (window.location.pathname.toLowerCase() === "/player") {
        if (window.history.state && !window.history.state.isRoot && window.history.length > 1) {
          window.history.back();
          return;
        }
        const targetPath = modeToPath(modeRef.current);
        window.history.replaceState(
          { tansen: true, mode: modeRef.current, immersive: false },
          "",
          targetPath
        );
      }
      setImmersiveState(false);
    }
  }, []);

  const navigateBack = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.history.state && !window.history.state.isRoot && window.history.length > 1) {
      window.history.back();
    } else {
      setMode("landing");
    }
  }, [setMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Direct cold-load on /player redirects to / cleanly
    if (window.location.pathname.toLowerCase() === "/player") {
      window.history.replaceState(
        { tansen: true, mode: "landing", immersive: false, isRoot: true },
        "",
        "/"
      );
    } else if (!window.history.state || !window.history.state.tansen) {
      const init = parsePathToRoute(window.location.pathname);
      window.history.replaceState(
        { tansen: true, mode: init.mode, immersive: init.immersive, isRoot: true },
        "",
        window.location.pathname
      );
    }

    const handlePopState = (e: PopStateEvent) => {
      const path = window.location.pathname.toLowerCase();
      if (path === "/player") {
        setImmersiveState(true);
        if (e.state?.mode) {
          setModeState(e.state.mode);
        }
      } else if (path === "/search") {
        setImmersiveState(false);
        setModeState("search");
      } else if (path === "/mood" || path === "/studio") {
        setImmersiveState(false);
        setModeState("studio");
      } else {
        setImmersiveState(false);
        setModeState("landing");
        clearSearch();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearSearch]);

  /* ---- Single choke point for "is playing" (React state + OS media session) ---- */
  const applyPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
    setIsPlaying(playing);
    setMediaPlaybackState(playing ? "playing" : "paused");
  }, []);

  /* ---- Engine-agnostic clock helpers ---- */
  const getCurrentTime = useCallback((): number => {
    try {
      if (engineRef.current === "youtube") {
        const t = ytPlayerRef.current?.getCurrentTime?.();
        return Number.isFinite(t) ? t : 0;
      }
      const a = audioRef.current;
      return a && Number.isFinite(a.currentTime) ? a.currentTime : 0;
    } catch {
      return 0;
    }
  }, []);

  const getDuration = useCallback((): number => {
    try {
      if (engineRef.current === "youtube") {
        const d = ytPlayerRef.current?.getDuration?.();
        return Number.isFinite(d) && d > 0 ? d : durationRef.current;
      }
      const a = audioRef.current;
      return a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durationRef.current;
    } catch {
      return durationRef.current;
    }
  }, []);

  /** Tell the OS where we are so the lock-screen scrubber is accurate. */
  const syncPosition = useCallback(() => {
    setMediaPosition(getDuration(), getCurrentTime());
  }, [getCurrentTime, getDuration]);

  const seekTo = useCallback(
    (sec: number) => {
      const d = getDuration() || 0;
      const target = Number.isFinite(sec) ? Math.max(0, d > 0 ? Math.min(sec, d) : sec) : 0;
      setProgress(target);
      if (engineRef.current === "youtube") {
        try {
          ytPlayerRef.current?.seekTo?.(target, true);
        } catch {
          /* ignore */
        }
      } else if (audioRef.current) {
        audioRef.current.currentTime = target;
      }
      syncPosition();
    },
    [getDuration, syncPosition]
  );

  /* ---- YouTube player initialization (fallback engine) ---- */
  useEffect(() => {
    function initYT() {
      if (!window.YT?.Player || ytPlayerRef.current) return;
      try {
        ytPlayerRef.current = new window.YT.Player("tansen-yt-player", {
          height: "240",
          width: "240",
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
          },
          events: {
            onReady: () => {
              const p = ytPlayerRef.current;
              if (!p) return;
              try {
                p.unMute();
                p.setVolume(Math.round(volumeRef.current * 100));
              } catch {
                /* ignore */
              }
              const tid = pendingTrackIdRef.current;
              pendingTrackIdRef.current = null;
              // Only start the queued video if it is still the track the user wants.
              if (tid && engineRef.current === "youtube" && currentRef.current?.id === tid) {
                try {
                  p.loadVideoById(tid);
                  p.unMute();
                  p.setVolume(Math.round(volumeRef.current * 100));
                  p.playVideo();
                  setIsLoading(false);
                  applyPlaying(true);
                } catch {
                  /* ignore */
                }
              }
            },
            onStateChange: (event: any) => {
              // Ignore events caused by us stopping the iframe while the audio engine is active.
              if (engineRef.current !== "youtube") return;
              switch (event.data) {
                case 1: // playing
                  setIsLoading(false);
                  applyPlaying(true);
                  try {
                    ytPlayerRef.current?.unMute?.();
                    const dur = ytPlayerRef.current?.getDuration?.();
                    if (dur && Number.isFinite(dur) && dur > 0) setDuration(dur);
                  } catch {
                    /* ignore */
                  }
                  syncPosition();
                  break;
                case 2: // paused
                  applyPlaying(false);
                  syncPosition();
                  break;
                case 0: // ended
                  handleEndedRef.current();
                  break;
                case 3: // buffering
                  setIsLoading(true);
                  break;
              }
            },
            onError: () => {
              setIsLoading(false);
              applyPlaying(false);
            },
          },
        });
      } catch {
        /* ignore */
      }
    }

    if (window.YT?.Player) {
      initYT();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        initYT();
      };
    }
  }, [applyPlaying, syncPosition]);

  /* ---- Audio element: created ONCE and reused for every track ----------
   * Never recreate this element (e.g. on volume change). A phone only lets an
   * element keep playing in the background / auto-advance to the next song when
   * it is the same element the user originally started with a tap.
   * State is driven by the element's own events, so lock-screen pause/play,
   * headset buttons and phone-call interruptions keep the UI in sync.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = volumeRef.current;
    audioRef.current = audio;
    (window as any).__TANSEN_AUDIO__ = audio;

    // Safari 16.4+/iOS: declare this as media playback (plays through the silent switch, proper session).
    try {
      const session = (navigator as any).audioSession;
      if (session) session.type = "playback";
    } catch {
      /* ignore */
    }

    const isActive = () => engineRef.current === "audio";

    const onTime = () => {
      if (!isActive()) return;
      const cur = audio.currentTime || 0;
      setProgress(cur);
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
      maybePrefetchRef.current(cur, d);
    };
    const onMeta = () => {
      onTime();
      syncPosition();
    };
    const onPlay = () => {
      if (isActive()) applyPlaying(true);
    };
    const onPlaying = () => {
      if (!isActive()) return;
      setIsLoading(false);
      applyPlaying(true);
      syncPosition();
    };
    const onWaiting = () => {
      if (isActive() && !audio.paused) setIsLoading(true);
    };
    const onPause = () => {
      // "pause" also fires right before "ended"; that is handled by onEnded.
      if (!isActive() || audio.ended) return;
      setIsLoading(false);
      applyPlaying(false);
      syncPosition();
    };
    const onEnded = () => {
      if (isActive()) handleEndedRef.current();
    };
    const onSeeked = () => syncPosition();
    const onError = () => {
      // Errors while a track is still starting are handled by startAudio() (it moves on to the next source).
      if (!isActive() || startingRef.current) return;
      const track = currentRef.current;
      const src = audioSrcRef.current;
      const retry = retryRef.current;
      if (!track || !src || retry.id !== track.id || retry.n >= 1) {
        setIsLoading(false);
        applyPlaying(false);
        return;
      }
      // Mid-song failure (network drop, expired link): reload the same stream once and resume where we were.
      retry.n += 1;
      const resumeAt = audio.currentTime || 0;
      setIsLoading(true);
      audio.src = src;
      if (resumeAt > 0) {
        try {
          audio.currentTime = resumeAt;
        } catch {
          /* ignore */
        }
      }
      audio.play().catch(() => {});
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if ((window as any).__TANSEN_AUDIO__ === audio) {
        delete (window as any).__TANSEN_AUDIO__;
      }
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [applyPlaying, syncPosition]);

  /* ---- High-resolution playback ticker (50ms) for frame-accurate lyric sync ---- */
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const cur = getCurrentTime();
      const dur = getDuration();
      setProgress(cur);
      if (dur > 0) setDuration(dur);
      maybePrefetchRef.current(cur, dur);
    }, 50);
    return () => clearInterval(timer);
  }, [isPlaying, getCurrentTime, getDuration]);

  /* ---- Page visibility ------------------------------------------------
   * The audio engine needs nothing here: it keeps playing on its own.
   * The YouTube fallback is paused by YouTube when the tab hides, so we
   * resume it as soon as the user comes back instead of leaving it paused.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        resumeOnVisibleRef.current = engineRef.current === "youtube" && isPlayingRef.current;
        return;
      }
      if (resumeOnVisibleRef.current && engineRef.current === "youtube") {
        resumeOnVisibleRef.current = false;
        try {
          ytPlayerRef.current?.playVideo?.();
        } catch {
          /* ignore */
        }
      }
      syncPosition();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncPosition]);

  /* ---- Low-level engine controls ---- */
  const releaseAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.removeAttribute("src");
    a.load();
  }, []);

  const stopYouTube = useCallback(() => {
    const yt = ytPlayerRef.current;
    if (yt && typeof yt.stopVideo === "function") {
      try {
        yt.stopVideo();
      } catch {
        /* ignore */
      }
    }
  }, []);

  /**
   * Point the permanent audio element at `src` and resolve once we know the outcome.
   * IMPORTANT: src assignment and play() happen synchronously (no await before them)
   * so iOS/Safari still counts this as part of the user's tap.
   */
  const startAudio = useCallback(
    (src: string, id: number, timeoutMs: number): Promise<StartResult> =>
      new Promise<StartResult>((resolve) => {
        const audio = audioRef.current;
        if (!audio) {
          resolve("failed");
          return;
        }
        let done = false;
        const verdict = (ok: StartResult): StartResult => (loadId.current === id ? ok : "stale");
        const finish = (result: StartResult) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          audio.removeEventListener("playing", onPlaying);
          audio.removeEventListener("error", onError);
          resolve(result);
        };
        const onPlaying = () => finish(verdict("playing"));
        const onError = () => finish(verdict("failed"));
        const timer = setTimeout(() => finish(verdict("failed")), timeoutMs);
        audio.addEventListener("playing", onPlaying);
        audio.addEventListener("error", onError);

        audioSrcRef.current = src;
        audio.src = src;
        audio.volume = volumeRef.current;
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch((err: unknown) => {
            const name = (err as DOMException | undefined)?.name;
            if (loadId.current !== id) return finish("stale");
            if (name === "NotAllowedError") finish("blocked"); // autoplay policy: wait for a tap
            else if (name !== "AbortError") finish("failed");
            // AbortError = superseded by another load; the events/timeout above settle it.
          });
        }
      }),
    []
  );

  const loadAndPlay = useCallback(
    async (track: Track) => {
      const id = ++loadId.current;
      heardRef.current.add(songKey(track));
      currentRef.current = track;
      retryRef.current = { id: track.id, n: 0 };
      resumeOnVisibleRef.current = false;
      pendingTrackIdRef.current = null;
      startingRef.current = true;
      engineRef.current = "audio";

      setCurrent(track);
      setIsLoading(true);
      setLyrics(null);
      setProgress(0);
      setDuration(track.duration || 0);
      setMediaMetadata(track);
      stopYouTube();

      // Lyrics (parallel, cached)
      setLyricsLoading(true);
      const cached = lyricsCache.current.get(track.id);
      if (cached) {
        setLyrics(cached);
        setLyricsLoading(false);
      } else {
        getLyrics(track)
          .then((r) => {
            if (r.lyrics || r.syncedLyrics) lyricsCache.current.set(track.id, r);
            if (loadId.current === id) setLyrics(r);
          })
          .finally(() => loadId.current === id && setLyricsLoading(false));
      }

      // Strategy 1: real <audio> element on our own stream proxy (background / lock-screen safe).
      // The first startAudio() call below runs synchronously, before any await.
      const tryAudio = async (): Promise<StartResult> => {
        const health = streamHealthRef.current;
        if (Date.now() < health.disabledUntil) {
          note("stream skipped (failed recently) -> YouTube player");
          return "failed";
        }
        for (const src of getStreamSources(track.id)) {
          const result = await startAudio(src, id, STREAM_START_TIMEOUT_MS);
          if (result === "stale") return "stale";
          if (result === "playing" || result === "blocked") {
            health.failures = 0;
            health.disabledUntil = 0;
            note(`audio engine OK (${result}) via ${src.replace(/\/[^/]*$/, "/…")}`);
            return result;
          }
          note(`stream failed: ${src.replace(/\/[^/]*$/, "/…")}`);
          if (Date.now() - lastProbeRef.current > 60000) {
            lastProbeRef.current = Date.now();
            void probeStream(src).then((why) => note(`why: ${why}`));
          }
        }
        // Every source failed. After two strikes stop making the user wait for a server that can't deliver.
        health.failures += 1;
        if (health.failures >= 2) {
          health.disabledUntil = Date.now() + STREAM_COOLDOWN_MS;
          health.failures = 1; // one more failure after the cooldown re-triggers it immediately
          note("stream paused for 5 min");
        }
        return "failed";
      };

      let result: StartResult;
      try {
        result = await tryAudio();
      } finally {
        if (loadId.current === id) startingRef.current = false;
      }
      if (result === "stale" || loadId.current !== id) return;

      if (result === "playing") {
        setIsLoading(false);
        applyPlaying(true);
        return;
      }
      if (result === "blocked") {
        // Browser refused autoplay (no user gesture yet). The stream is loaded; the play button starts it.
        setIsLoading(false);
        applyPlaying(false);
        return;
      }

      // Strategy 2: YouTube IFrame player (foreground only — YouTube pauses embeds in background tabs).
      const isYT = Boolean(track.id && track.id.length >= 8);
      if (!isYT) {
        setIsLoading(false);
        applyPlaying(false);
        return;
      }
      engineRef.current = "youtube";
      releaseAudio();
      note("engine = YouTube iframe (Chrome pauses this when the screen locks)");

      const playYt = (): boolean => {
        const p = ytPlayerRef.current;
        if (p && typeof p.loadVideoById === "function") {
          try {
            p.loadVideoById(track.id);
            p.unMute();
            p.setVolume(Math.round(volumeRef.current * 100));
            p.playVideo();
            setIsLoading(false);
            applyPlaying(true);
            return true;
          } catch {
            /* fall through to pending */
          }
        }
        pendingTrackIdRef.current = track.id; // onReady will pick this up
        return false;
      };

      if (playYt()) return;
      setTimeout(() => {
        if (
          loadId.current === id &&
          engineRef.current === "youtube" &&
          pendingTrackIdRef.current === track.id &&
          playYt()
        ) {
          pendingTrackIdRef.current = null;
        }
      }, 600);
    },
    [applyPlaying, note, releaseAudio, startAudio, stopYouTube]
  );

  const dismissTrack = useCallback(() => {
    loadId.current++; // cancel any in-flight load so it can't start playing after dismissal
    startingRef.current = false;
    pendingTrackIdRef.current = null;
    releaseAudio();
    stopYouTube();
    currentRef.current = null;
    setCurrent(null);
    applyPlaying(false);
    setIsLoading(false);
    setProgress(0);
    setDuration(0);
    setLyrics(null);
    setMediaMetadata(null);
    setMediaPlaybackState("none");
    setImmersive(false);
  }, [applyPlaying, releaseAudio, stopYouTube, setImmersive]);

  const playTrack = useCallback(
    (track: Track, list?: Track[], seedQuery?: string) => {
      if (list && list.length > 1) {
        // Explicit list playback
        flowRef.current = "queue";
        seedQueryRef.current = "";
        const clean = dedupeTracks([track, ...list.filter((t) => t.id !== track.id)]);
        const ordered = [track, ...clean.filter((t) => t.id !== track.id)];
        setQueue(ordered);
        queueRef.current = ordered;
        setQueueIndex(0);
        idxRef.current = 0;
      } else {
        // Single click — YouTube-style autoplay session
        flowRef.current = "autoplay";
        seedQueryRef.current = (seedQuery ?? "").trim();
        setQueue([track]);
        queueRef.current = [track];
        setQueueIndex(0);
        idxRef.current = 0;
      }
      setImmersive(true);
      void loadAndPlay(track);
    },
    [loadAndPlay, setImmersive]
  );

  const stepTo = useCallback(
    (idx: number) => {
      const q = queueRef.current;
      if (idx < 0 || idx >= q.length) return;
      setQueueIndex(idx);
      idxRef.current = idx;
      void loadAndPlay(q[idx]);
    },
    [loadAndPlay]
  );

  const nextDistinctIndex = useCallback((fromIndex: number): number => {
    const q = queueRef.current;
    const cur = q[idxRef.current];
    for (let i = fromIndex; i < q.length; i++) {
      if (!cur || songKey(q[i]) !== songKey(cur)) return i;
    }
    return -1;
  }, []);

  /* ---- Radio (autoplay) ----------------------------------------------
   * Related tracks are fetched shortly BEFORE the current song ends and
   * appended silently to the queue. That way "next" is instant even when the
   * phone is locked; waiting until the song ends means several network
   * searches with no audio playing, which is exactly when mobile OSes
   * suspend a background page.
   * ------------------------------------------------------------------ */
  const fetchRadioPicks = useCallback((seed: Track): Promise<Track[]> => {
    if (!radioInflight.current) {
      radioInflight.current = getRelatedTracks(seed, heardRef.current, 4, seedQueryRef.current)
        .catch(() => [] as Track[])
        .finally(() => {
          radioInflight.current = null;
        });
    }
    return radioInflight.current;
  }, []);

  const prefetchRadio = useCallback(async () => {
    if (!(radioRef.current || flowRef.current === "autoplay")) return;
    if (repeatRef.current === "one") return;
    if (shuffleRef.current && queueRef.current.length > 2) return;
    if (nextDistinctIndex(idxRef.current + 1) !== -1) return; // already have a next song

    const q = queueRef.current;
    const seed = q[idxRef.current] ?? q[q.length - 1];
    if (!seed) return;

    const picks = await fetchRadioPicks(seed);
    if (!picks.length) return;
    const existing = new Set(queueRef.current.map(songKey));
    const fresh = picks.filter((p) => !existing.has(songKey(p)));
    if (!fresh.length) return;
    // Append only — never touch the index or the playing track.
    const merged = [...queueRef.current, ...fresh];
    queueRef.current = merged;
    setQueue(merged);
  }, [fetchRadioPicks, nextDistinctIndex]);

  const maybePrefetch = useCallback(
    (cur: number, dur: number) => {
      if (!Number.isFinite(dur) || dur < 30 || dur - cur > PREFETCH_WINDOW_SEC) return;
      if (prefetchedFor.current === loadId.current) return; // once per loaded track
      prefetchedFor.current = loadId.current;
      void prefetchRadio();
    },
    [prefetchRadio]
  );
  maybePrefetchRef.current = maybePrefetch;

  const extendWithRadio = useCallback(async (): Promise<boolean> => {
    if (extendBusy.current) return true; // another extension is already handling it
    const q0 = queueRef.current;
    const seed = q0[idxRef.current] ?? q0[q0.length - 1];
    if (!seed) return false;

    extendBusy.current = true;
    setRadioLoading(true);
    try {
      const picks = await fetchRadioPicks(seed);

      // The prefetch may already have queued the next song.
      const ahead = nextDistinctIndex(idxRef.current + 1);
      if (ahead !== -1) {
        setQueueIndex(ahead);
        idxRef.current = ahead;
        flowRef.current = "autoplay";
        void loadAndPlay(queueRef.current[ahead]);
        return true;
      }

      if (!picks.length) return false;
      const merged = [...queueRef.current, ...picks];
      queueRef.current = merged;
      setQueue(merged);
      const target = merged.length - picks.length;
      setQueueIndex(target);
      idxRef.current = target;
      flowRef.current = "autoplay";
      void loadAndPlay(picks[0]);
      return true;
    } catch {
      return false;
    } finally {
      extendBusy.current = false;
      setRadioLoading(false);
    }
  }, [fetchRadioPicks, loadAndPlay, nextDistinctIndex]);

  const next = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return;

    if (shuffleRef.current && q.length > 2) {
      const remaining = q
        .map((t, i) => ({ t, i }))
        .filter((x) => x.i !== idxRef.current && songKey(x.t) !== songKey(q[idxRef.current]));
      if (remaining.length) {
        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        stepTo(pick.i);
        return;
      }
    }

    const n = nextDistinctIndex(idxRef.current + 1);
    if (n !== -1) {
      stepTo(n);
      return;
    }
    if (repeatRef.current === "all" && flowRef.current === "queue") {
      stepTo(0);
      return;
    }
    if (radioRef.current || flowRef.current === "autoplay") void extendWithRadio();
  }, [stepTo, nextDistinctIndex, extendWithRadio]);

  const prev = useCallback(() => {
    if (getCurrentTime() > 3) {
      seekTo(0);
      return;
    }
    const q = queueRef.current;
    const cur = q[idxRef.current];
    for (let i = idxRef.current - 1; i >= 0; i--) {
      if (!cur || songKey(q[i]) !== songKey(cur)) {
        stepTo(i);
        return;
      }
    }
    seekTo(0);
  }, [getCurrentTime, seekTo, stepTo]);

  const handleEnded = useCallback(() => {
    if (repeatRef.current === "one") {
      seekTo(0);
      if (engineRef.current === "youtube") {
        try {
          ytPlayerRef.current?.playVideo?.();
        } catch {
          /* ignore */
        }
      } else if (audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
      return;
    }

    const q = queueRef.current;
    const hasNext = shuffleRef.current
      ? q.length > 1
      : nextDistinctIndex(idxRef.current + 1) !== -1;
    if (hasNext) {
      next();
    } else if (repeatRef.current === "all" && q.length > 1 && flowRef.current === "queue") {
      stepTo(0);
    } else if (radioRef.current || flowRef.current === "autoplay") {
      void extendWithRadio().then((ok) => {
        if (!ok) {
          applyPlaying(false);
          setProgress(0);
        }
      });
    } else {
      applyPlaying(false);
      setProgress(0);
    }
  }, [next, stepTo, seekTo, nextDistinctIndex, extendWithRadio, applyPlaying]);
  handleEndedRef.current = handleEnded;

  const resume = useCallback(() => {
    const track = currentRef.current;
    if (!track) return;
    if (engineRef.current === "youtube") {
      try {
        ytPlayerRef.current?.playVideo?.();
      } catch {
        /* ignore */
      }
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    // No usable source (blocked autoplay before metadata, or a stream that died): start the track over.
    if (a.error || !a.currentSrc) {
      void loadAndPlay(track);
      return;
    }
    a.play().catch(() => {});
  }, [loadAndPlay]);

  const pauseNow = useCallback(() => {
    if (engineRef.current === "youtube") {
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        /* ignore */
      }
      return;
    }
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (!currentRef.current) return;
    if (isPlayingRef.current) pauseNow();
    else resume();
  }, [pauseNow, resume]);

  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(1, v));
    volumeRef.current = c;
    setVolumeState(c);
    if (audioRef.current) audioRef.current.volume = c;
    try {
      ytPlayerRef.current?.setVolume?.(Math.round(c * 100));
    } catch {
      /* ignore */
    }
  }, []);

  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    []
  );
  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const toggleRadio = useCallback(() => setRadio((r) => !r), []);

  const enqueue = useCallback((t: Track) => {
    setQueue((q) => (q.some((x) => x.id === t.id) ? q : [...q, t]));
    setQueueIndex((i) => (i === -1 ? 0 : i));
  }, []);

  actionsRef.current = { resume, pause: pauseNow, next, prev, seek: seekTo };

  /* ---- Native MediaSession: lock screen, notification shade, headset & car controls ----
   * Handlers are registered once and always call the latest actions through a ref.
   * Metadata and playbackState are pushed imperatively (loadAndPlay / applyPlaying)
   * so they stay correct even while the page is backgrounded and React is throttled.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (!hasMediaSession()) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported by this browser */
      }
    };
    set("play", () => actionsRef.current.resume());
    set("pause", () => actionsRef.current.pause());
    set("previoustrack", () => actionsRef.current.prev());
    set("nexttrack", () => actionsRef.current.next());
    set("seekto", (d) => {
      if (typeof d.seekTime === "number") actionsRef.current.seek(d.seekTime);
    });
    set("seekbackward", (d) => actionsRef.current.seek(getCurrentTime() - (d.seekOffset || 10)));
    set("seekforward", (d) => actionsRef.current.seek(getCurrentTime() + (d.seekOffset || 10)));
    return () => {
      (["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as const).forEach(
        (a) => set(a, null)
      );
    };
  }, [getCurrentTime]);

  /* ---- Search ---- */
  const search = useCallback(async (q: string) => {
    setQuery(q);
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const found = await searchTracks(trimmed);
      setResults(found);
    } finally {
      setSearching(false);
    }
  }, []);

  const value = useMemo<PlayerState>(
    () => ({
      mode,
      setMode,
      immersive,
      setImmersive,
      navigateBack,
      query,
      search,
      clearSearch,
      results,
      searching,
      queue,
      queueIndex,
      current,
      isPlaying,
      isLoading,
      progress,
      duration,
      volume,
      repeat,
      shuffle,
      radio,
      radioLoading,
      toggleRadio,
      playTrack,
      toggle,
      next,
      prev,
      seekTo,
      setVolume,
      cycleRepeat,
      toggleShuffle,
      enqueue,
      dismissTrack,
      lyrics,
      lyricsLoading,
    }),
    [
      mode,
      setMode,
      immersive,
      setImmersive,
      navigateBack,
      query,
      search,
      clearSearch,
      results,
      searching,
      queue,
      queueIndex,
      current,
      isPlaying,
      isLoading,
      progress,
      duration,
      volume,
      repeat,
      shuffle,
      radio,
      radioLoading,
      toggleRadio,
      playTrack,
      toggle,
      next,
      prev,
      seekTo,
      setVolume,
      cycleRepeat,
      toggleShuffle,
      enqueue,
      dismissTrack,
      lyrics,
      lyricsLoading,
    ]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {debugEnabled && (
        <pre
          style={{
            position: "fixed",
            left: 4,
            right: 4,
            bottom: 4,
            zIndex: 99999,
            margin: 0,
            padding: 8,
            maxHeight: "40vh",
            overflow: "auto",
            background: "rgba(0,0,0,0.88)",
            color: "#9f9",
            font: "11px/1.4 monospace",
            whiteSpace: "pre-wrap",
            pointerEvents: "none",
          }}
        >
          {debugLines.join("\n") || "debug on - play a song"}
        </pre>
      )}
    </Ctx.Provider>
  );
}
