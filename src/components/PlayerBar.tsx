import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, MicVocal, Pause, Play, Repeat, Repeat1, Shuffle,
  SkipBack, SkipForward, Sparkles, Volume2, VolumeX,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { fmtTime } from "../lib/ui";
import { cn } from "../utils/cn";
import Artwork from "./Artwork";
import Equalizer from "./Equalizer";

export default function PlayerBar() {
  const {
    current, isPlaying, isLoading, simulated, progress, duration,
    toggle, next, prev, seekTo, volume, setVolume,
    repeat, cycleRepeat, shuffle, toggleShuffle,
    lyricsOpen, setLyricsOpen, aiOpen, setAiOpen,
  } = usePlayer();

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const seek = (v: number) => seekTo((v / 100) * duration);

  return (
    <AnimatePresence>
      {current && (
        <motion.footer
          initial={{ y: 110 }}
          animate={{ y: 0 }}
          exit={{ y: 110 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-seam bg-ink/85 backdrop-blur-2xl"
        >
          {/* hairline progress (mirrors seek) */}
          <div className="absolute -top-px left-0 h-px w-full bg-seam">
            <motion.div
              className="h-full bg-brass"
              style={{ width: `${pct}%` }}
              transition={{ ease: "linear" }}
            />
          </div>

          <div className="mx-auto grid h-[92px] max-w-[1600px] grid-cols-[1fr_auto] items-center gap-3 px-3 sm:px-5 lg:grid-cols-[1fr_1.4fr_1fr]">
            {/* left: track meta */}
            <div className="flex min-w-0 items-center gap-3">
              <Artwork track={current} size={54} spinning={isPlaying} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-paper">{current.title}</p>
                <p className="truncate text-xs text-mist">{current.artist}</p>
                <p className="mt-0.5 hidden font-mono text-[9px] uppercase tracking-[0.2em] text-mist/60 sm:block">
                  {simulated ? "demo · simulated" : "live stream · m4a"}
                </p>
              </div>
              <Equalizer playing={isPlaying} className="ml-1 hidden h-4 sm:flex" />
            </div>

            {/* center: transport + seek */}
            <div className="hidden flex-col items-center gap-1.5 lg:flex">
              <div className="flex items-center gap-5">
                <button
                  onClick={toggleShuffle}
                  className={cn("transition-colors", shuffle ? "text-brass" : "text-mist hover:text-paper")}
                  title="Shuffle"
                >
                  <Shuffle size={15} />
                </button>
                <button onClick={prev} className="text-mist transition-colors hover:text-paper" title="Previous">
                  <SkipBack size={18} className="fill-current" />
                </button>
                <button
                  onClick={toggle}
                  className="grid h-10 w-10 place-items-center rounded-full bg-brass text-ink shadow-[0_0_24px_rgba(240,168,50,0.35)] transition-transform hover:scale-105 active:scale-95"
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isLoading ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : isPlaying ? (
                    <Pause size={17} className="fill-current" />
                  ) : (
                    <Play size={17} className="ml-0.5 fill-current" />
                  )}
                </button>
                <button onClick={next} className="text-mist transition-colors hover:text-paper" title="Next">
                  <SkipForward size={18} className="fill-current" />
                </button>
                <button
                  onClick={cycleRepeat}
                  className={cn("relative transition-colors", repeat !== "off" ? "text-brass" : "text-mist hover:text-paper")}
                  title={`Repeat: ${repeat}`}
                >
                  {repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
                </button>
              </div>
              <div className="fader-wrap flex w-full max-w-md items-center gap-3">
                <span className="w-9 text-right font-mono text-[10px] text-mist">{fmtTime(progress)}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={pct}
                  onChange={(e) => seek(Number(e.target.value))}
                  className="fader flex-1"
                  style={{ ["--fill" as any]: `${pct}%` }}
                  aria-label="Seek"
                />
                <span className="w-9 font-mono text-[10px] text-mist">{fmtTime(duration)}</span>
              </div>
            </div>

            {/* mobile transport */}
            <div className="flex items-center justify-end gap-2 lg:hidden">
              <button
                onClick={toggle}
                className="grid h-10 w-10 place-items-center rounded-full bg-brass text-ink"
              >
                {isLoading ? <Loader2 size={17} className="animate-spin" /> : isPlaying ? <Pause size={17} className="fill-current" /> : <Play size={17} className="ml-0.5 fill-current" />}
              </button>
              <button onClick={next} className="grid h-9 w-9 place-items-center text-mist">
                <SkipForward size={18} className="fill-current" />
              </button>
            </div>

            {/* right: panels + volume */}
            <div className="hidden items-center justify-end gap-1.5 lg:flex">
              <button
                onClick={() => setLyricsOpen(!lyricsOpen)}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full transition-colors",
                  lyricsOpen ? "bg-brass/15 text-brass" : "text-mist hover:text-paper"
                )}
                title="Lyrics"
              >
                <MicVocal size={16} />
              </button>
              <button
                onClick={() => setAiOpen(!aiOpen)}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full transition-colors",
                  aiOpen ? "bg-iris/15 text-iris" : "text-mist hover:text-paper"
                )}
                title="Mood Studio"
              >
                <Sparkles size={16} />
              </button>
              <div className="fader-wrap ml-2 flex items-center gap-2">
                <button
                  onClick={() => setVolume(volume === 0 ? 0.85 : 0)}
                  className="text-mist transition-colors hover:text-paper"
                  title="Mute"
                >
                  {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume * 100}
                  onChange={(e) => setVolume(Number(e.target.value) / 100)}
                  className="fader w-24"
                  style={{ ["--fill" as any]: `${volume * 100}%` }}
                  aria-label="Volume"
                />
              </div>
            </div>
          </div>
        </motion.footer>
      )}
    </AnimatePresence>
  );
}
