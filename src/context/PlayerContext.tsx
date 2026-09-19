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
import { getAudioUrl, getLyrics, getRelatedTracks, searchTracks } from "../services/api";
import { dedupeTracks, songKey } from "../lib/dedupe";
import type { LyricsResult, Track, ViewKey } from "../types";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type RepeatMode = "off" | "all" | "one";

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

  const [engine, setEngine] = useState<"audio" | "youtube">("audio");
  const engineRef = useRef<"audio" | "youtube">("audio");
  engineRef.current = engine;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const pendingTrackIdRef = useRef<string | null>(null);

  const loadId = useRef(0);
  const lyricsCache = useRef(new Map<string, LyricsResult>());
  const keepPlaying = useRef(false);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const queueRef = useRef(queue);
  const idxRef = useRef(queueIndex);
  const radioRef = useRef(radio);
  const heardRef = useRef<Set<string>>(new Set());
  const radioBusy = useRef(false);
  const flowRef = useRef<"queue" | "autoplay">("autoplay");
  const seedQueryRef = useRef<string>("");
  const wasPlayingBeforeHideRef = useRef(false);

  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  queueRef.current = queue;
  idxRef.current = queueIndex;
  radioRef.current = radio;
  keepPlaying.current = isPlaying;

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

  /* ---- YouTube player initialization ---- */
  useEffect(() => {
    function initYT() {
      if (window.YT && window.YT.Player && !ytPlayerRef.current) {
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
                ytReadyRef.current = true;
                const p = ytPlayerRef.current;
                if (p) {
                  try {
                    p.unMute();
                    p.setVolume(Math.round(volume * 100));
                  } catch {
                    /* ignore */
                  }
                  if (pendingTrackIdRef.current) {
                    const tid = pendingTrackIdRef.current;
                    pendingTrackIdRef.current = null;
                    try {
                      p.loadVideoById(tid);
                      p.unMute();
                      p.setVolume(Math.round(volume * 100));
                      p.playVideo();
                      setIsLoading(false);
                      setIsPlaying(true);
                    } catch {
                      /* ignore */
                    }
                  }
                }
              },
              onStateChange: (event: any) => {
                if (event.data === 1) {
                  setIsPlaying(true);
                  setIsLoading(false);
                  wasPlayingBeforeHideRef.current = true;
                  try {
                    ytPlayerRef.current?.unMute?.();
                    const dur = ytPlayerRef.current?.getDuration?.();
                    if (dur && isFinite(dur) && dur > 0) setDuration(dur);
                  } catch {
                    /* ignore */
                  }
                } else if (event.data === 2) {
                  // If pause was caused by document being hidden on mobile, retain session so Chrome keeps notification pinned
                  if (typeof document !== "undefined" && document.hidden && wasPlayingBeforeHideRef.current) {
                    // Do not tear down session; Chrome keeps Android notification alive via audio anchor
                  } else {
                    wasPlayingBeforeHideRef.current = false;
                    setIsPlaying(false);
                  }
                } else if (event.data === 0) {
                  wasPlayingBeforeHideRef.current = false;
                  handleEndedRef.current();
                } else if (event.data === 3) {
                  setIsLoading(true);
                }
              },
              onError: () => {
                setIsLoading(false);
              },
            },
          });
        } catch {
          /* ignore */
        }
      }
    }

    if (window.YT && window.YT.Player) {
      initYT();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        initYT();
      };
    }
  }, [volume]);

  /* ---- Mobile & Background Tab Persistence ---- */
  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        if (wasPlayingBeforeHideRef.current) {
          if (engineRef.current === "youtube") {
            const p = ytPlayerRef.current;
            if (p && typeof p.playVideo === "function") {
              try {
                p.playVideo();
                setIsPlaying(true);
              } catch {
                /* ignore */
              }
            }
          } else if (engineRef.current === "audio" && audioRef.current) {
            if (audioRef.current.paused) {
              audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
            }
          }
        }
      } else {
        wasPlayingBeforeHideRef.current = keepPlaying.current;
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, []);

  /* ---- Background audio anchor to keep Chrome Android notification active ---- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    const active = isPlaying || wasPlayingBeforeHideRef.current;
    if (engine === "youtube" && active) {
      if (a.src !== SILENT_WAV) {
        a.src = SILENT_WAV;
        a.loop = true;
        a.volume = 0.001;
      }
      a.play().catch(() => {});
    } else if (engine === "youtube" && !active) {
      a.pause();
    }
  }, [engine, isPlaying]);

  /* ---- High-resolution playback ticker (50ms / 20Hz) for frame-accurate sync ---- */
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      if (engineRef.current === "youtube") {
        const p = ytPlayerRef.current;
        if (!p || typeof p.getCurrentTime !== "function") return;
        try {
          const cur = p.getCurrentTime() || 0;
          const dur = p.getDuration() || 0;
          if (isFinite(cur)) setProgress(cur);
          if (dur && isFinite(dur) && dur > 0) {
            setDuration(dur);
          }
        } catch {
          /* ignore */
        }
      } else if (engineRef.current === "audio") {
        const a = audioRef.current;
        if (!a) return;
        const cur = a.currentTime || 0;
        if (isFinite(cur)) setProgress(cur);
        if (a.duration && isFinite(a.duration) && a.duration > 0) {
          setDuration(a.duration);
        }
      }
    }, 50);
    return () => clearInterval(interval);
  }, [isPlaying]);

  /* ---- Audio element lifecycle ---- */
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = volume;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    (audio as any).playsInline = true;
    audioRef.current = audio;
    if (typeof window !== "undefined") {
      (window as any).__TANSEN_AUDIO__ = audio;
    }

    const onTime = () => {
      if (engineRef.current !== "audio") return;
      setProgress(audio.currentTime || 0);
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const onEnd = () => {
      if (engineRef.current !== "audio") return;
      handleEndedRef.current();
    };
    const onErr = () => {
      if (engineRef.current !== "audio") return;
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onErr);
    return () => {
      if (typeof window !== "undefined" && (window as any).__TANSEN_AUDIO__ === audio) {
        delete (window as any).__TANSEN_AUDIO__;
      }
      audio.pause();
      audio.src = "";
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onErr);
    };
  }, [volume]);

  const durationRef = useRef(0);
  durationRef.current = duration;

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    const yt = ytPlayerRef.current;
    if (yt && typeof yt.stopVideo === "function") {
      try {
        yt.stopVideo();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const loadAndPlay = useCallback(
    async (track: Track) => {
      const id = ++loadId.current;
      heardRef.current.add(songKey(track));
      setCurrent(track);
      setIsLoading(true);
      setLyrics(null);
      setProgress(0);
      setDuration(track.duration || 0);
      stopAudio();

      // Lyrics (parallel, cached)
      setLyricsLoading(true);
      const cached = lyricsCache.current.get(track.id);
      if (cached) {
        setLyrics(cached);
        setLyricsLoading(false);
      } else {
        getLyrics(track)
          .then((r) => {
            if (r.lyrics) lyricsCache.current.set(track.id, r);
            if (loadId.current === id) setLyrics(r);
          })
          .finally(() => loadId.current === id && setLyricsLoading(false));
      }

      // Strategy 1: Direct stream URL (.m4a)
      const url = await getAudioUrl(track.id);
      if (loadId.current !== id) return; // Stale request

      if (url && audioRef.current) {
        setEngine("audio");
        setIsLoading(false);
        const a = audioRef.current;
        a.src = url;
        a.volume = volume;
        try {
          await a.play();
          setIsPlaying(true);
          return;
        } catch {
          /* Fall through to YouTube client-side player */
        }
      }

      // Strategy 2: YouTube Client-side IFrame Player
      const isYT = Boolean(track.id && track.id.length >= 8);
      if (isYT) {
        setEngine("youtube");
        const playYt = () => {
          const p = ytPlayerRef.current;
          if (p && typeof p.loadVideoById === "function") {
            try {
              p.loadVideoById(track.id);
              p.unMute();
              p.setVolume(Math.round(volume * 100));
              p.playVideo();
              setIsLoading(false);
              setIsPlaying(true);
              return true;
            } catch {
              return false;
            }
          }
          pendingTrackIdRef.current = track.id;
          return false;
        };

        if (playYt()) return;

        // If YT player is still initializing, wait briefly and retry
        setTimeout(() => {
          if (loadId.current === id && playYt()) {
            setIsPlaying(true);
          }
        }, 600);
        return;
      }

      if (loadId.current !== id) return;
      setIsLoading(false);
      setIsPlaying(false);
    },
    [stopAudio, volume]
  );

  const dismissTrack = useCallback(() => {
    wasPlayingBeforeHideRef.current = false;
    stopAudio();
    setCurrent(null);
    setIsPlaying(false);
    setIsLoading(false);
    setProgress(0);
    setDuration(0);
    setLyrics(null);
    setImmersive(false);

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => {
          reg.active?.postMessage({ type: "STOP_PLAYING" });
        })
        .catch(() => {});
    }
  }, [stopAudio, setImmersive]);

  const playTrack = useCallback(
    (track: Track, list?: Track[], seedQuery?: string) => {
      wasPlayingBeforeHideRef.current = true;

      // Pre-arm HTML5 audio element within synchronous user gesture to unlock mobile background audio
      if (audioRef.current) {
        try {
          audioRef.current.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
          audioRef.current.play().catch(() => {});
        } catch {
          /* ignore */
        }
      }

      if (list && list.length > 1) {
        // Explicit list playback
        flowRef.current = "queue";
        seedQueryRef.current = "";
        const clean = dedupeTracks([track, ...list.filter((t) => t.id !== track.id)]);
        const ordered = [track, ...clean.filter((t) => t.id !== track.id)];
        setQueue(ordered);
        queueRef.current = ordered;
        setQueueIndex(0);
      } else {
        // Single click — YouTube-style autoplay session
        flowRef.current = "autoplay";
        seedQueryRef.current = (seedQuery ?? "").trim();
        setQueue([track]);
        queueRef.current = [track];
        setQueueIndex(0);
      }
      setImmersive(true);
      loadAndPlay(track);
    },
    [loadAndPlay]
  );

  const stepTo = useCallback(
    (idx: number) => {
      // Pre-arm HTML5 audio element within user gesture
      if (audioRef.current) {
        try {
          audioRef.current.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
          audioRef.current.play().catch(() => {});
        } catch {
          /* ignore */
        }
      }
      const q = queueRef.current;
      if (idx < 0 || idx >= q.length) return;
      setQueueIndex(idx);
      idxRef.current = idx;
      loadAndPlay(q[idx]);
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

  const extendWithRadio = useCallback(async (): Promise<boolean> => {
    if (radioBusy.current) return false;
    const q = queueRef.current;
    const seed = q[idxRef.current] ?? q[q.length - 1];
    if (!seed) return false;

    radioBusy.current = true;
    setRadioLoading(true);
    try {
      const picks = await getRelatedTracks(seed, heardRef.current, 4, seedQueryRef.current);
      if (!picks.length) return false;
      const merged = [...queueRef.current, ...picks];
      queueRef.current = merged;
      setQueue(merged);
      const target = merged.length - picks.length;
      setQueueIndex(target);
      idxRef.current = target;
      flowRef.current = "autoplay";
      loadAndPlay(picks[0]);
      return true;
    } catch {
      return false;
    } finally {
      radioBusy.current = false;
      setRadioLoading(false);
    }
  }, [loadAndPlay]);

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
    if (progress > 3) {
      seekToRef.current(0);
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
    seekToRef.current(0);
  }, [progress, stepTo]);

  const handleEnded = useCallback(() => {
    if (repeatRef.current === "one") {
      seekToRef.current(0);
      if (engineRef.current === "youtube") {
        try {
          ytPlayerRef.current?.seekTo?.(0, true);
          ytPlayerRef.current?.playVideo?.();
        } catch {
          /* ignore */
        }
      } else if (engineRef.current === "audio" && audioRef.current) {
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
          setIsPlaying(false);
          setProgress(0);
        }
      });
    } else {
      setIsPlaying(false);
      setProgress(0);
    }
  }, [next, stepTo, nextDistinctIndex, extendWithRadio]);

  const seekTo = useCallback((sec: number) => {
    const d = durationRef.current || 0;
    const target = isFinite(sec) ? Math.max(0, Math.min(sec, d > 0 ? d : sec)) : 0;
    setProgress(target);
    if (engineRef.current === "youtube") {
      try {
        ytPlayerRef.current?.seekTo?.(target, true);
      } catch {
        /* ignore */
      }
    } else if (engineRef.current === "audio" && audioRef.current) {
      audioRef.current.currentTime = target;
    }
  }, []);

  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;
  const handleEndedRef = useRef(handleEnded);
  handleEndedRef.current = handleEnded;

  const toggle = useCallback(() => {
    if (!current) return;
    if (engineRef.current === "youtube") {
      const yt = ytPlayerRef.current;
      if (!yt) return;
      if (isPlaying) {
        wasPlayingBeforeHideRef.current = false;
        try {
          yt.pauseVideo?.();
        } catch {
          /* ignore */
        }
        setIsPlaying(false);
      } else {
        wasPlayingBeforeHideRef.current = true;
        try {
          yt.playVideo?.();
        } catch {
          /* ignore */
        }
        setIsPlaying(true);
      }
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      wasPlayingBeforeHideRef.current = false;
      a.pause();
      setIsPlaying(false);
    } else {
      wasPlayingBeforeHideRef.current = true;
      a.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [current, isPlaying]);

  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(1, v));
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

  const nextRef = useRef(next);
  nextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;
  const dismissTrackRef = useRef(dismissTrack);
  dismissTrackRef.current = dismissTrack;

  /* ---- Native MediaSession Metadata (set once per track) ---- */
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    if (!current) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    const artworkSrc =
      current.thumbnail ||
      (current.id ? `https://i.ytimg.com/vi/${current.id}/hqdefault.jpg` : "");

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: "Tansen",
        artwork: artworkSrc
          ? [
              { src: artworkSrc, sizes: "96x96", type: "image/jpeg" },
              { src: artworkSrc, sizes: "128x128", type: "image/jpeg" },
              { src: artworkSrc, sizes: "192x192", type: "image/jpeg" },
              { src: artworkSrc, sizes: "256x256", type: "image/jpeg" },
              { src: artworkSrc, sizes: "384x384", type: "image/jpeg" },
              { src: artworkSrc, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      /* ignore */
    }
  }, [current]);

  /* ---- Native MediaSession Playback State & Position (throttled) ---- */
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator) || !current) return;

    const effectivePlaying = isPlaying || Boolean(typeof document !== "undefined" && document.hidden && wasPlayingBeforeHideRef.current);
    navigator.mediaSession.playbackState = effectivePlaying ? "playing" : "paused";

    if ("setPositionState" in navigator.mediaSession && duration > 0 && isFinite(duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(duration, 1),
          playbackRate: 1,
          position: Math.min(Math.max(progress, 0), duration),
        });
      } catch {
        /* ignore */
      }
    }
  }, [isPlaying, duration, Math.floor(progress)]);

  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    const actionHandlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        "play",
        () => {
          wasPlayingBeforeHideRef.current = true;
          if (engineRef.current === "youtube") {
            try {
              ytPlayerRef.current?.playVideo?.();
            } catch {
              /* ignore */
            }
          } else if (audioRef.current) {
            audioRef.current.play().catch(() => {});
          }
          setIsPlaying(true);
          if (typeof window !== "undefined" && "mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
          }
        },
      ],
      [
        "pause",
        () => {
          wasPlayingBeforeHideRef.current = false;
          if (engineRef.current === "youtube") {
            try {
              ytPlayerRef.current?.pauseVideo?.();
            } catch {
              /* ignore */
            }
          } else if (audioRef.current) {
            audioRef.current.pause();
          }
          setIsPlaying(false);
          if (typeof window !== "undefined" && "mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
        },
      ],
      ["previoustrack", () => prevRef.current()],
      ["nexttrack", () => nextRef.current()],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") {
            seekToRef.current(details.seekTime);
          }
        },
      ],
      [
        "seekbackward",
        (details) => {
          const offset = details.seekOffset || 10;
          seekToRef.current(Math.max(0, (progress || 0) - offset));
        },
      ],
      [
        "seekforward",
        (details) => {
          const offset = details.seekOffset || 10;
          seekToRef.current(Math.min(durationRef.current, (progress || 0) + offset));
        },
      ],
      ["stop", () => dismissTrackRef.current()],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* ignore unsupported actions */
      }
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [progress]);

  /* ---- Service Worker Background Media Notification Sync ---- */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    navigator.serviceWorker.ready
      .then((reg) => {
        reg.active?.postMessage({
          type: "UPDATE_PLAYING",
          track: current,
          isPlaying,
        });
      })
      .catch(() => {});
  }, [current, isPlaying]);

  /* ---- Service Worker Remote Notification Action Listener ---- */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "SW_ACTION") return;

      if (data.action === "play") {
        wasPlayingBeforeHideRef.current = true;
        if (engineRef.current === "youtube") {
          try {
            ytPlayerRef.current?.playVideo?.();
          } catch {
            /* ignore */
          }
        } else if (audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
        setIsPlaying(true);
      } else if (data.action === "pause") {
        wasPlayingBeforeHideRef.current = false;
        if (engineRef.current === "youtube") {
          try {
            ytPlayerRef.current?.pauseVideo?.();
          } catch {
            /* ignore */
          }
        } else if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
      } else if (data.action === "next") {
        nextRef.current();
      } else if (data.action === "prev") {
        prevRef.current();
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
