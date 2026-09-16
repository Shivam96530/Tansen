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
import { checkHealth, getAudioUrl, getLyrics, getRelatedTracks, searchTracks } from "../services/api";
import { dedupeTracks, isSameSong, songKey } from "../lib/dedupe";
import type { LyricsResult, ServiceStatus, Track, ViewKey } from "../types";

type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  // library
  view: ViewKey;
  setView: (v: ViewKey) => void;
  query: string;
  search: (q: string) => Promise<void>;
  results: Track[];
  searching: boolean;

  // queue & playback
  queue: Track[];
  queueIndex: number;
  current: Track | null;
  isPlaying: boolean;
  isLoading: boolean; // resolving stream url
  simulated: boolean; // offline demo playback
  progress: number;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  radio: boolean;
  radioLoading: boolean;
  toggleRadio: () => void;

  playTrack: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  enqueue: (t: Track) => void;

  // panels
  lyricsOpen: boolean;
  setLyricsOpen: (b: boolean) => void;
  aiOpen: boolean;
  setAiOpen: (b: boolean) => void;

  // lyrics
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;

  // services
  status: ServiceStatus;
}

const Ctx = createContext<PlayerState | null>(null);

export const usePlayer = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
};

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewKey>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);

  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [current, setCurrent] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [radio, setRadio] = useState(true);
  const [radioLoading, setRadioLoading] = useState(false);

  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const [status, setStatus] = useState<ServiceStatus>({ api: "checking", stream: "checking" });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadId = useRef(0);
  const lyricsCache = useRef(new Map<string, LyricsResult>());
  const keepPlaying = useRef(false);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const queueRef = useRef(queue);
  const idxRef = useRef(queueIndex);
  const radioRef = useRef(radio);
  const heardRef = useRef<Set<string>>(new Set()); // song identities played this session
  const radioBusy = useRef(false);
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  queueRef.current = queue;
  idxRef.current = queueIndex;
  radioRef.current = radio;
  keepPlaying.current = isPlaying;

  /* ---- audio element ---- */
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = volume;
    audioRef.current = audio;

    const onTime = () => {
      setProgress(audio.currentTime || 0);
      setDuration(audio.duration && isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnd = () => handleEndedRef.current();
    const onErr = () => setIsLoading(false);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onErr);
    return () => {
      audio.pause();
      audio.src = "";
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- simulated engine (demo tracks / offline) ---- */
  useEffect(() => {
    if (!simulated || !isPlaying) return;
    const iv = setInterval(() => {
      setProgress((p) => {
        const d = durationRef.current;
        if (p + 0.25 >= d) {
          clearInterval(iv);
          setTimeout(() => handleEndedRef.current(), 320);
          return d;
        }
        return p + 0.25;
      });
    }, 250);
    return () => clearInterval(iv);
  }, [simulated, isPlaying]);

  const durationRef = useRef(0);
  durationRef.current = duration;

  const startSim = useCallback((len: number) => {
    setSimulated(true);
    setDuration(len || 210);
    setProgress(0);
    setIsPlaying(true);
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
  }, []);

  const loadAndPlay = useCallback(
    async (track: Track) => {
      const id = ++loadId.current;
      heardRef.current.add(songKey(track)); // remember the song, not the upload
      setCurrent(track);
      setIsLoading(true);
      setLyrics(null);
      setProgress(0);
      setDuration(track.duration || 0);
      stopAudio();
      setSimulated(false);

      // lyrics (parallel, cached)
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

      if (track.source !== "demo") {
        const url = await getAudioUrl(track.id);
        if (loadId.current !== id) return; // stale
        if (url && audioRef.current) {
          setIsLoading(false);
          const a = audioRef.current;
          a.src = url;
          a.volume = volume;
          try {
            await a.play();
            setIsPlaying(true);
            return;
          } catch {
            /* fall back to sim below */
          }
        }
      }
      if (loadId.current !== id) return;
      setIsLoading(false);
      startSim(track.duration || 210);
    },
    [stopAudio, startSim, volume]
  );

  const playTrack = useCallback(
    (track: Track, list?: Track[]) => {
      if (list && list.length) {
        // Collapse duplicate uploads so "next" is never the same song again,
        // but always keep the track the listener actually clicked.
        const clean = dedupeTracks([track, ...list.filter((t) => t.id !== track.id)]);
        const ordered = [track, ...clean.filter((t) => t.id !== track.id)];
        setQueue(ordered);
        queueRef.current = ordered;
        setQueueIndex(0);
      } else {
        setQueue((q) => {
          if (q.some((t) => t.id === track.id)) return q;
          const next = [...q, track];
          setQueueIndex(next.length - 1);
          return next;
        });
      }
      loadAndPlay(track);
    },
    [loadAndPlay]
  );

  const stepTo = useCallback(
    (idx: number) => {
      const q = queueRef.current;
      const t = q[idx];
      if (!t) return;
      setQueueIndex(idx);
      loadAndPlay(t);
    },
    [loadAndPlay]
  );

  /** Next index whose song differs from what is playing (skips re-uploads). */
  const nextDistinctIndex = useCallback((from: number) => {
    const q = queueRef.current;
    const now = q[idxRef.current] ?? null;
    for (let i = from; i < q.length; i++) {
      if (!isSameSong(q[i], now)) return i;
    }
    return -1;
  }, []);

  /** Extend the queue with related songs, Spotify-style autoplay radio. */
  const extendWithRadio = useCallback(async () => {
    const seed = queueRef.current[idxRef.current] ?? null;
    if (!seed || radioBusy.current) return false;
    radioBusy.current = true;
    setRadioLoading(true);
    try {
      const picks = await getRelatedTracks(seed, heardRef.current, 4);
      if (!picks.length) return false;
      const merged = [...queueRef.current, ...picks];
      queueRef.current = merged;
      setQueue(merged);
      const target = merged.length - picks.length;
      setQueueIndex(target);
      idxRef.current = target;
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
    if (shuffleRef.current && q.length > 1) {
      const options = q
        .map((_, i) => i)
        .filter((i) => i !== idxRef.current && !isSameSong(q[i], q[idxRef.current]));
      if (options.length) {
        stepTo(options[Math.floor(Math.random() * options.length)]);
        return;
      }
    }
    const n = nextDistinctIndex(idxRef.current + 1);
    if (n !== -1) {
      stepTo(n);
      return;
    }
    if (repeatRef.current === "all") {
      stepTo(0);
      return;
    }
    // Queue exhausted → radio takes over with fresh songs.
    if (radioRef.current) void extendWithRadio();
  }, [stepTo, nextDistinctIndex, extendWithRadio]);

  const prev = useCallback(() => {
    if (progress > 4) {
      seekToRef.current(0);
      return;
    }
    const q = queueRef.current;
    if (!q.length) return;
    const p = idxRef.current - 1;
    if (p >= 0) stepTo(p);
    else if (repeatRef.current === "all") stepTo(q.length - 1);
    else seekToRef.current(0);
  }, [progress]);

  const handleEnded = useCallback(() => {
    if (repeatRef.current === "one") {
      seekToRef.current(0);
      setIsPlaying(true);
      if (audioRef.current && !simulated) audioRef.current.play().catch(() => {});
      return;
    }
    const q = queueRef.current;
    const hasNext = shuffleRef.current
      ? q.length > 1
      : nextDistinctIndex(idxRef.current + 1) !== -1;
    if (hasNext) {
      next();
    } else if (repeatRef.current === "all" && q.length) {
      stepTo(0);
    } else if (radioRef.current) {
      // Nothing distinct left — pull related songs and keep the music going.
      void extendWithRadio().then((ok) => {
        if (!ok) {
          setIsPlaying(false);
          setProgress(durationRef.current);
        }
      });
    } else {
      setIsPlaying(false);
      setProgress(durationRef.current);
    }
  }, [next, simulated, stepTo, nextDistinctIndex, extendWithRadio]);

  const seekTo = useCallback(
    (sec: number) => {
      const d = durationRef.current || 0;
      const v = Math.max(0, Math.min(sec, d));
      setProgress(v);
      if (!simulated && audioRef.current) audioRef.current.currentTime = v;
    },
    [simulated]
  );

  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;
  const handleEndedRef = useRef(handleEnded);
  handleEndedRef.current = handleEnded;

  const toggle = useCallback(() => {
    if (!current) return;
    if (simulated) {
      setIsPlaying((p) => !p);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
    } else {
      a.play().then(() => setIsPlaying(true)).catch(() => simulated && setIsPlaying(true));
    }
  }, [current, isPlaying, simulated]);

  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(1, v));
    setVolumeState(c);
    if (audioRef.current) audioRef.current.volume = c;
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

  /* ---- search ---- */
  const search = useCallback(async (q: string) => {
    setQuery(q);
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setView("home");
      return;
    }
    setView("search");
    setSearching(true);
    try {
      const found = await searchTracks(trimmed);
      setResults(found);
    } finally {
      setSearching(false);
    }
  }, []);

  /* ---- health ---- */
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const s = await checkHealth();
      if (mounted) setStatus(s);
    };
    run();
    const iv = setInterval(run, 30000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  const value = useMemo<PlayerState>(
    () => ({
      view, setView, query, search, results, searching,
      queue, queueIndex, current, isPlaying, isLoading, simulated,
      progress, duration, volume, repeat, shuffle, radio, radioLoading, toggleRadio,
      playTrack, toggle, next, prev, seekTo, setVolume, cycleRepeat, toggleShuffle, enqueue,
      lyricsOpen, setLyricsOpen, aiOpen, setAiOpen,
      lyrics, lyricsLoading, status,
    }),
    [
      view, query, search, results, searching,
      queue, queueIndex, current, isPlaying, isLoading, simulated,
      progress, duration, volume, repeat, shuffle, radio, radioLoading, toggleRadio,
      playTrack, toggle, next, prev, seekTo, setVolume, cycleRepeat, toggleShuffle, enqueue,
      lyricsOpen, aiOpen, lyrics, lyricsLoading, status,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
