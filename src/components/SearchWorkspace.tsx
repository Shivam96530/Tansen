import { useEffect, useRef, useState } from "react";
import { ArrowLeft, AudioWaveform, Loader2, Search } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import TrackRow from "./TrackRow";

const QUICK_SEARCHES = [
  "Arijit Singh",
  "Diljit Dosanjh",
  "Coldplay",
  "Taylor Swift",
  "Lofi Chill Beats",
  "Coke Studio",
  "Bollywood Romance",
  "Gym Phonk",
];

export default function SearchWorkspace() {
  const { navigateBack, search, clearSearch, searching, results } = usePlayer();
  const [value, setValue] = useState("");
  const deb = useRef<number | null>(null);

  useEffect(() => {
    if (deb.current) window.clearTimeout(deb.current);
    if (!value.trim()) {
      clearSearch();
      return;
    }
    deb.current = window.setTimeout(() => search(value), 350);
    return () => {
      if (deb.current) window.clearTimeout(deb.current);
    };
  }, [value, search, clearSearch]);

  // Clean up search results when leaving search workspace
  useEffect(() => {
    return () => {
      clearSearch();
    };
  }, [clearSearch]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* top bar with back navigation */}
      <div className="flex items-center justify-between pb-6">
        <button
          onClick={navigateBack}
          className="group flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.2em] text-mist transition-colors hover:text-paper"
        >
          <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-1" />
          <div className="grid h-6 w-6 place-items-center rounded-lg bg-brass/15 text-brass ring-1 ring-brass/30 shadow-[0_0_12px_rgba(240,168,50,0.15)]">
            <AudioWaveform size={13} strokeWidth={2.2} />
          </div>
          <span className="font-display text-base tracking-normal normal-case text-paper">Tansen</span>
        </button>
        <span className="font-mono text-[10px] tracking-[0.2em] text-mist/60 uppercase">
          Search Workspace
        </span>
      </div>

      {/* search input */}
      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mist transition-colors"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search songs, artists, soundtracks…"
          autoFocus
          className="w-full rounded-2xl border border-seam bg-coal/80 py-3.5 pl-11 pr-11 text-sm text-paper placeholder-mist/60 backdrop-blur-md outline-none transition-all focus:border-brass/50 focus:ring-1 focus:ring-brass/30"
        />
        {searching && (
          <Loader2
            size={18}
            className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-brass"
          />
        )}
      </div>

      {/* quick search pill tags */}
      {!value && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-mist/50 mr-1">
            Try:
          </span>
          {QUICK_SEARCHES.map((tag) => (
            <button
              key={tag}
              onClick={() => {
                setValue(tag);
                search(tag);
              }}
              className="rounded-full border border-seam bg-coal/40 px-3 py-1 font-sans text-xs text-mist transition-colors hover:border-brass/30 hover:text-paper"
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* results list */}
      <div className="mt-8 space-y-1">
        {value.trim() && results.length > 0 ? (
          results.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} context={results} />
          ))
        ) : value.trim() && !searching ? (
          <div className="py-16 text-center text-sm text-mist">
            No tracks found for "{value}". Try searching by song title or singer name.
          </div>
        ) : null}
      </div>
    </div>
  );
}
