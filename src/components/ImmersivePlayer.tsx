import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { activeIndex, parseLrc, type LrcLine } from "../lib/lrc";
import { extractPalette, type Palette } from "../lib/palette";
import { romanizeLyrics } from "../lib/romanize";
import { fmtTime } from "../lib/ui";
import Artwork from "./Artwork";
import Equalizer from "./Equalizer";
import { cn } from "../utils/cn";

export default function ImmersivePlayer() {
  const {
    current,
    isPlaying,
    isLoading,
    progress,
    duration,
    toggle,
    next,
    prev,
    seekTo,
    volume,
    setVolume,
    repeat,
    cycleRepeat,
    shuffle,
    toggleShuffle,
    radio,
    radioLoading,
    toggleRadio,
    lyrics,
    lyricsLoading,
    immersive,
    setImmersive,
  } = usePlayer();

  const [palette, setPalette] = useState<Palette>({
    primary: "rgba(240, 168, 50, 0.25)",
    secondary: "rgba(155, 140, 255, 0.2)",
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lyricsFocused, setLyricsFocused] = useState(false);

  // Extract ambient palette when current track changes
  useEffect(() => {
    if (current) {
      extractPalette(current.thumbnail, `${current.title} ${current.artist}`).then(setPalette);
    }
  }, [current]);

  // Reset lyrics focus when track changes
  useEffect(() => {
    setLyricsFocused(false);
  }, [current?.id]);

  const lines: LrcLine[] = useMemo(
    () => (lyrics?.syncedLyrics ? parseLrc(lyrics.syncedLyrics, duration, lyrics?.refDuration) : []),
    [lyrics?.syncedLyrics, duration, lyrics?.refDuration]
  );

  // High-frequency audio clock tracking: syncs directly with HTML5 Audio at 60fps
  // Eliminates the 250ms latency of the browser's timeupdate event for rap & fast lyrics
  const [activeIdx, setActiveIdx] = useState<number>(() => activeIndex(lines, progress));

  useEffect(() => {
    if (!lines.length) {
      setActiveIdx(-1);
      return;
    }

    const initialIdx = activeIndex(lines, progress);
    setActiveIdx(initialIdx);

    if (!immersive || !isPlaying) return;

    let rafId: number;
    let lastIdx = initialIdx;

    const tick = () => {
      const audio = (window as any).__TANSEN_AUDIO__ as HTMLAudioElement | undefined;
      const cur = audio && !audio.paused ? audio.currentTime : progress;
      const newIdx = activeIndex(lines, cur);
      if (newIdx !== lastIdx) {
        lastIdx = newIdx;
        setActiveIdx(newIdx);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [immersive, isPlaying, lines, progress]);

  const romanizedPlainLyrics = useMemo(
    () => (lyrics?.lyrics ? romanizeLyrics(lyrics.lyrics) : ""),
    [lyrics?.lyrics]
  );

  // Only permit vanishing/focus mode when lyrics are actually available
  const hasLyrics = Boolean(!lyricsLoading && (lines.length > 0 || Boolean(romanizedPlainLyrics)));
  const isFocused = lyricsFocused && hasLyrics;
  const controlsVisible = !isFocused;

  const handleLyricsClick = (e: React.MouseEvent) => {
    if (!hasLyrics) return;
    e.stopPropagation();
    setLyricsFocused((prev) => !prev);
  };

  // Keyboard navigation & Shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!immersive) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekTo(Math.min(duration, progress + 5));
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekTo(Math.max(0, progress - 5));
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "Escape") {
        if (isFocused) {
          setLyricsFocused(false);
        } else if (isFullscreen) {
          document.exitFullscreen?.().catch(() => {});
        } else {
          setImmersive(false);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersive, isFullscreen, isFocused, toggle, seekTo, progress, duration, setImmersive]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  if (!immersive || !current) return null;

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const seek = (v: number) => seekTo((v / 100) * duration);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => {
        if (isFocused) setLyricsFocused(false);
      }}
      className="fixed inset-0 z-[100] flex flex-col justify-between overflow-hidden bg-ink text-paper select-none transition-all"
    >
      {/* 2-Color Ambient Audio Bloom */}
      <div
        className="pointer-events-none absolute -top-1/4 -left-1/4 h-[90vh] w-[90vw] rounded-full blur-[140px] transition-colors duration-1000 ease-out"
        style={{ backgroundColor: palette.primary }}
      />
      <div
        className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[90vh] w-[90vw] rounded-full blur-[160px] transition-colors duration-1000 ease-out"
        style={{ backgroundColor: palette.secondary }}
      />

      {/* Top Header */}
      <div
        className={cn(
          "relative z-10 flex items-center justify-between px-6 py-6 transition-opacity duration-300",
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <button
          onClick={() => setImmersive(false)}
          className="grid h-10 w-10 place-items-center rounded-full bg-coal/60 text-mist backdrop-blur-md transition-transform hover:scale-105 hover:text-paper"
          title="Minimize player"
        >
          <ChevronDown size={20} />
        </button>

        <div className="flex flex-col items-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-mist/70">
            Now Playing
          </span>
          <p className="mt-0.5 max-w-[280px] truncate text-center text-xs text-mist sm:max-w-md">
            {current.title} — {current.artist}
          </p>
        </div>

        <button
          onClick={toggleFullscreen}
          className="grid h-10 w-10 place-items-center rounded-full bg-coal/60 text-mist backdrop-blur-md transition-transform hover:scale-105 hover:text-paper"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      {/* Center Display: Artwork + Synced Lyrics */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-hidden px-6 max-w-4xl mx-auto w-full text-center">
        {/* Artwork & Song Info (compact placeholder image + song title + artist) */}
        <AnimatePresence>
          {controlsVisible && (
            <motion.div
              key="player-artwork-block"
              initial={{ opacity: 0, scale: 0.9, y: -14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -14 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center justify-center text-center mb-6 shrink-0"
            >
              <div className="relative group">
                <Artwork
                  track={current}
                  size={isFullscreen ? 130 : 145}
                  className="rounded-2xl shadow-[0_12px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/10 w-28 h-28 sm:w-36 sm:h-36"
                />
                {isPlaying && (
                  <div className="absolute bottom-2 right-2 rounded-lg bg-ink/80 px-2 py-0.5 backdrop-blur-md">
                    <Equalizer playing={isPlaying} className="h-3" />
                  </div>
                )}
              </div>

              <div className="mt-3 max-w-xs sm:max-w-sm text-center">
                <h1 className="font-display text-base font-medium tracking-tight text-paper sm:text-lg line-clamp-1">
                  {current.title}
                </h1>
                <p className="mt-0.5 text-xs text-mist line-clamp-1">
                  {current.artist}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center Lyrics / Song Stage with smooth positional animation */}
        <motion.div
          layout="position"
          transition={{ type: "spring", stiffness: 160, damping: 24, mass: 0.8 }}
          onClick={handleLyricsClick}
          className={cn(
            "flex min-h-[160px] sm:min-h-[220px] w-full max-w-3xl flex-col items-center justify-center px-4 text-center select-none transition-transform duration-200",
            hasLyrics ? "cursor-pointer group" : "cursor-default"
          )}
          title={hasLyrics ? (isFocused ? "Click lyrics to restore controls" : "Click lyrics to focus") : undefined}
        >
          {lyricsLoading ? (
            <div className="flex flex-col items-center justify-center space-y-3 text-mist">
              <Loader2 size={24} className="animate-spin text-brass" />
              <span className="font-mono text-xs uppercase tracking-widest">
                Resolving lyrics…
              </span>
            </div>
          ) : lines.length > 0 ? (
            <div className="flex w-full flex-col items-center justify-center text-center">
              {(() => {
                const activeLine = activeIdx >= 0 && activeIdx < lines.length ? lines[activeIdx] : null;
                if (!activeLine) {
                  return (
                    <motion.div
                      key="intro"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.4 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center justify-center gap-2 font-display text-3xl text-mist"
                    >
                      <span>♪</span>
                    </motion.div>
                  );
                }
                const raw = activeLine.text.trim();
                const romanized = raw ? romanizeLyrics(raw) : "";
                if (!romanized) {
                  // Empty timestamp row represents instrumental gap
                  return (
                    <motion.div
                      key={`gap-${activeIdx}`}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 0.6, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.02 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center justify-center gap-2.5 font-display text-3xl text-mist/60"
                    >
                      <span>♪</span>
                      <span className="font-mono text-xs uppercase tracking-[0.25em] text-mist/40">
                        Instrumental
                      </span>
                    </motion.div>
                  );
                }

                // Neighboring lines for vocal and rap cadence context
                const prevLine = activeIdx > 0 ? lines[activeIdx - 1] : null;
                const nextLine = activeIdx + 1 < lines.length ? lines[activeIdx + 1] : null;
                const prevRomanized = prevLine?.text?.trim() ? romanizeLyrics(prevLine.text.trim()) : "";
                const nextRomanized = nextLine?.text?.trim() ? romanizeLyrics(nextLine.text.trim()) : "";

                return (
                  <div className="flex flex-col items-center justify-center space-y-1.5 sm:space-y-2.5 w-full">
                    {prevRomanized && (
                      <p className="font-display text-xs sm:text-sm font-normal text-mist/35 line-clamp-1 select-none transition-opacity duration-200">
                        {prevRomanized}
                      </p>
                    )}
                    <AnimatePresence mode="popLayout">
                      <motion.p
                        key={`line-${activeIdx}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        className="font-display text-[clamp(1.75rem,4.5vw,3rem)] font-semibold leading-tight text-paper select-none text-center mx-auto transition-transform duration-200 group-hover:scale-[1.01]"
                        style={{ textShadow: `0 0 35px ${palette.primary}` }}
                      >
                        {romanized}
                      </motion.p>
                    </AnimatePresence>
                    {nextRomanized && (
                      <p className="font-display text-xs sm:text-sm font-normal text-mist/45 line-clamp-1 select-none transition-opacity duration-200">
                        {nextRomanized}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : romanizedPlainLyrics ? (
            <div className="touch-scroll flex max-h-[340px] w-full max-w-2xl flex-col overflow-y-auto space-y-5 py-4 text-center mx-auto sm:max-h-[440px]">
              <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-mist/50">
                timing unavailable · reading mode
              </p>
              {romanizedPlainLyrics.split(/\n\s*\n/).map((block, i) => (
                <p
                  key={i}
                  className="whitespace-pre-line font-display text-[clamp(1rem,2.4vw,1.35rem)] leading-[1.85] text-paper/80"
                >
                  {block}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center text-mist/60">
              <p className="font-display text-xl text-paper/70">No lyrics available for this song</p>
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-mist/40">
                Audio playing live
              </p>
            </div>
          )}

          {/* Subtly inform user that clicking lyrics focuses them */}
          {hasLyrics && controlsVisible && (
            <div className="mt-4 flex items-center justify-center pointer-events-none">
              <span className="rounded-full bg-coal/60 px-3 py-1 font-mono text-[10px] tracking-wider text-mist/60 border border-white/5 backdrop-blur-md transition-all group-hover:text-mist group-hover:bg-coal/90">
                Click lyrics to focus
              </span>
            </div>
          )}
        </motion.div>
      </div>

      {/* Bottom Floating Control Bar */}
      <div
        className={cn(
          "relative z-10 mx-auto w-full max-w-2xl px-6 pb-8 transition-opacity duration-300",
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Seek Bar */}
        <div className="fader-wrap flex items-center gap-3">
          <span className="w-10 text-right font-mono text-[11px] text-mist">
            {fmtTime(progress)}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={pct}
            onChange={(e) => seek(Number(e.target.value))}
            className="fader flex-1"
            style={{ ["--fill" as any]: `${pct}%` }}
            aria-label="Seek slider"
          />
          <span className="w-10 font-mono text-[11px] text-mist">
            {fmtTime(duration)}
          </span>
        </div>

        {/* Transport buttons */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleShuffle}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-full transition-colors",
                shuffle ? "text-brass bg-brass/10" : "text-mist hover:text-paper"
              )}
              title="Shuffle"
            >
              <Shuffle size={17} />
            </button>
            <button
              onClick={cycleRepeat}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-full transition-colors",
                repeat !== "off" ? "text-brass bg-brass/10" : "text-mist hover:text-paper"
              )}
              title={`Repeat: ${repeat}`}
            >
              {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
            </button>
          </div>

          <div className="flex items-center gap-5">
            <button
              onClick={prev}
              className="text-mist transition-transform hover:scale-110 hover:text-paper"
              title="Previous song"
            >
              <SkipBack size={24} className="fill-current" />
            </button>
            <button
              onClick={toggle}
              className="grid h-14 w-14 place-items-center rounded-full bg-brass text-ink shadow-[0_0_35px_rgba(240,168,50,0.45)] transition-transform hover:scale-105 active:scale-95"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isLoading ? (
                <Loader2 size={24} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={24} className="fill-current" />
              ) : (
                <Play size={24} className="ml-1 fill-current" />
              )}
            </button>
            <button
              onClick={next}
              className="text-mist transition-transform hover:scale-110 hover:text-paper"
              title="Next song"
            >
              {radioLoading ? (
                <Loader2 size={24} className="animate-spin text-brass" />
              ) : (
                <SkipForward size={24} className="fill-current" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleRadio}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-full transition-colors",
                radio ? "text-sage bg-sage/10" : "text-mist hover:text-paper"
              )}
              title={radio ? "Autoplay Radio ON" : "Autoplay Radio OFF"}
            >
              {radioLoading ? <Loader2 size={17} className="animate-spin" /> : <Radio size={17} />}
            </button>
            <div className="fader-wrap ml-1 hidden items-center gap-2 sm:flex">
              <button
                onClick={() => setVolume(volume === 0 ? 0.85 : 0)}
                className="text-mist transition-colors hover:text-paper"
              >
                {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={volume * 100}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                className="fader w-20"
                style={{ ["--fill" as any]: `${volume * 100}%` }}
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
