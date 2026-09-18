import { motion } from "framer-motion";
import { MicVocal, Play, Plus } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { fmtTime } from "../lib/ui";
import { cn } from "../utils/cn";
import Artwork from "./Artwork";
import Equalizer from "./Equalizer";
import type { Track } from "../types";

export default function TrackRow({
  track,
  index,
  context,
}: {
  track: Track;
  index: number;
  context: Track[];
}) {
  const { current, isPlaying, playTrack, toggle, enqueue, setImmersive } = usePlayer();
  const active = current?.id === track.id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.045, 0.4), duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      onDoubleClick={() => playTrack(track, context)}
      className={cn(
        "group grid grid-cols-[28px_48px_1fr_auto] items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors sm:grid-cols-[32px_48px_1.6fr_1fr_auto_auto] sm:gap-4 sm:px-3",
        active ? "bg-seam/70" : "hover:bg-coal"
      )}
    >
      {/* index / eq */}
      <div className="grid h-5 place-items-center">
        {active ? (
          <Equalizer playing={isPlaying} className="h-4" />
        ) : (
          <span className="font-mono text-xs text-mist/70">{String(index + 1).padStart(2, "0")}</span>
        )}
      </div>

      {/* artwork */}
      <button
        onClick={() => {
          if (active) {
            toggle();
          } else {
            playTrack(track, context);
            setImmersive(true);
          }
        }}
        className="relative overflow-hidden rounded-lg"
        title={active ? (isPlaying ? "Pause" : "Play") : "Play"}
      >
        <Artwork track={track} size={48} />
        <span
          className={cn(
            "absolute inset-0 grid place-items-center bg-ink/60 opacity-0 transition-opacity",
            active ? (isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-0") : "group-hover:opacity-100"
          )}
        >
          <Play size={16} className="fill-paper text-paper" />
        </span>
      </button>

      {/* title */}
      <div
        className="min-w-0 cursor-pointer"
        onClick={() => {
          if (active) {
            setImmersive(true);
          } else {
            playTrack(track, context);
            setImmersive(true);
          }
        }}
      >
        <p className={cn("truncate text-sm font-medium", active ? "text-brass" : "text-paper")}>
          {track.title}
        </p>
        <p className="truncate text-xs text-mist sm:hidden">{track.artist}</p>
      </div>

      {/* artist */}
      <p className="hidden truncate text-[13px] text-mist sm:block">{track.artist}</p>

      {/* actions — always visible on touch, hover-reveal on desktop */}
      <div className="flex items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        <button
          onClick={() => enqueue(track)}
          className="grid h-9 w-9 place-items-center rounded-full text-mist transition-colors hover:bg-seam hover:text-paper sm:h-8 sm:w-8"
          title="Add to queue"
        >
          <Plus size={15} />
        </button>
        <button
          onClick={() => {
            if (!active) playTrack(track, context);
            setImmersive(true);
          }}
          className="grid h-9 w-9 place-items-center rounded-full text-mist transition-colors hover:bg-seam hover:text-paper sm:h-8 sm:w-8"
          title="Play with lyrics"
        >
          <MicVocal size={15} />
        </button>
      </div>

      {/* duration (hidden on mobile, where actions take the column) */}
      <span className="hidden text-right font-mono text-xs text-mist/80 sm:inline">
        {fmtTime(track.duration)}
      </span>
    </motion.div>
  );
}
