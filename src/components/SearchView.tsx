import { SearchX } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import TrackRow from "./TrackRow";

function SkeletonRow({ i }: { i: number }) {
  return (
    <div className="grid grid-cols-[32px_48px_1fr_80px] items-center gap-4 px-3 py-2.5" style={{ opacity: 1 - i * 0.12 }}>
      <div className="shimmer h-3 w-4 rounded" />
      <div className="shimmer h-12 w-12 rounded-lg" />
      <div className="space-y-2">
        <div className="shimmer h-3.5 w-2/5 rounded" />
        <div className="shimmer h-3 w-1/4 rounded" />
      </div>
      <div className="shimmer h-3 w-9 justify-self-end rounded" />
    </div>
  );
}

export default function SearchView() {
  const { query, results, searching } = usePlayer();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 lg:px-8">
      <header className="flex items-end justify-between px-1 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mist">Search</p>
          <h1 className="mt-1.5 font-display text-3xl">
            {query ? (
              <>
                Results for <em className="text-brass">“{query}”</em>
              </>
            ) : (
              "Find a track"
            )}
          </h1>
        </div>
        {!searching && results.length > 0 && (
          <span className="font-mono text-xs text-mist">{results.length} tracks</span>
        )}
      </header>

      <div className="overflow-hidden rounded-2xl border border-seam bg-coal/40 p-2">
        {searching ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} i={i} />)
        ) : results.length ? (
          results.map((t, i) => <TrackRow key={t.id} track={t} index={i} context={results} />)
        ) : query ? (
          <div className="grid place-items-center gap-3 py-20 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full border border-seam text-mist">
              <SearchX size={18} />
            </div>
            <p className="text-sm text-mist">
              Nothing surfaced for “{query}”. Try another title, artist or lyric line.
            </p>
          </div>
        ) : (
          <div className="grid place-items-center gap-3 py-20 text-center">
            <p className="max-w-xs text-sm leading-relaxed text-mist">
              Type above to search the catalogue — results resolve through the
              local API bridge, or the demo library when offline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
