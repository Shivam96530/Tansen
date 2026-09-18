import { motion } from "framer-motion";
import { Ghost, ScanText, X } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import Artwork from "./Artwork";
import Equalizer from "./Equalizer";

export default function LyricsPanel() {
  const { lyricsOpen, setLyricsOpen, current, lyrics, lyricsLoading, isPlaying } = usePlayer();

  return (
    <motion.aside
      initial={false}
      animate={{ x: lyricsOpen ? 0 : "110%", opacity: lyricsOpen ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      className={`fixed right-0 top-0 z-40 flex w-full max-w-[440px] flex-col border-l border-seam bg-coal/95 backdrop-blur-xl ${current ? "bottom-[var(--player-h)]" : "bottom-0"}`}
      style={{ pointerEvents: lyricsOpen ? "auto" : "none" }}
      aria-hidden={!lyricsOpen}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-seam px-6 pb-4 pt-[calc(16px+env(safe-area-inset-top,0px))] lg:py-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-mist">
          <ScanText size={13} className="text-brass" />
          Lyrics
        </div>
        <button
          onClick={() => setLyricsOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-full text-mist transition-colors hover:bg-seam hover:text-paper"
        >
          <X size={15} />
        </button>
      </div>

      {/* track */}
      {current && (
        <div className="flex items-center gap-4 border-b border-seam px-6 py-5">
          <Artwork track={current} size={56} spinning={isPlaying} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg leading-tight">{current.title}</p>
            <p className="mt-0.5 truncate text-xs text-mist">{current.artist}</p>
          </div>
          <Equalizer playing={isPlaying} className="h-4" />
        </div>
      )}

      {/* body */}
      <div className="mask-fade-b flex-1 overflow-y-auto px-6 py-6">
        {!current ? (
          <Empty text="Play a track and its lyrics will appear here." />
        ) : lyricsLoading ? (
          <div className="space-y-3.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="shimmer h-4 rounded"
                style={{ width: `${88 - (i % 4) * 17}%`, animationDelay: `${i * 0.08}s` }}
              />
            ))}
            <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist">
              Scanning Genius…
            </p>
          </div>
        ) : lyrics?.lyrics ? (
          <div className="space-y-5 pb-8">
            {lyrics.lyrics.split(/\n\s*\n/).map((block, bi) => (
              <p key={bi} className="font-display text-[19px] leading-[1.75] text-paper/90">
                {block.split("\n").map((line, li) => (
                  <span key={li} className="block">
                    {line}
                  </span>
                ))}
              </p>
            ))}
          </div>
        ) : (
          <Empty text="No lyrics resolved for this track. Lyrics are served by the local API bridge when the services are running." />
        )}
      </div>

      <div className="border-t border-seam px-6 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-mist/60">
        genius · [data-lyrics-container] · :5001
      </div>
    </motion.aside>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="max-w-[240px] text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-seam text-mist">
          <Ghost size={18} />
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-mist">{text}</p>
      </div>
    </div>
  );
}
