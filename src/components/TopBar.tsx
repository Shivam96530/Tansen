import { useEffect, useRef, useState } from "react";
import { AudioWaveform, Loader2, Search, Sparkles } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { cn } from "../utils/cn";

export default function TopBar() {
  const { search, searching, status, setAiOpen } = usePlayer();
  const [value, setValue] = useState("");
  const deb = useRef<number | null>(null);

  useEffect(() => {
    if (deb.current) window.clearTimeout(deb.current);
    deb.current = window.setTimeout(() => search(value), 420);
    return () => {
      if (deb.current) window.clearTimeout(deb.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const online =
    (status.api === "online" ? 1 : 0) + (status.stream === "online" ? 1 : 0);

  return (
    <header className="sticky top-0 z-40 border-b border-seam bg-ink/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-3.5 lg:px-8">
        {/* mobile brand */}
        <div className="flex items-center gap-2.5 lg:hidden">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brass text-ink">
            <AudioWaveform size={16} strokeWidth={2.4} />
          </div>
          <span className="font-display text-lg">Tansen</span>
        </div>

        {/* search */}
        <div className="mx-auto w-full max-w-xl">
          <div className="group relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mist transition-colors group-focus-within:text-brass"
            />
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Search songs, artists or a line of lyrics…"
              spellCheck={false}
              className="w-full rounded-full border border-seam bg-coal/80 py-2.5 pl-11 pr-11 text-sm text-paper placeholder:text-mist/60 outline-none transition-all focus:border-brass/50 focus:bg-coal focus:shadow-[0_0_0_4px_rgba(240,168,50,0.07)]"
            />
            {searching && (
              <Loader2 size={15} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-brass" />
            )}
          </div>
        </div>

        {/* right cluster */}
        <div className="hidden items-center gap-3 md:flex">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
              online === 2
                ? "border-sage/30 text-sage"
                : online === 1
                  ? "border-brass/30 text-brass"
                  : "border-seam text-mist"
            )}
            title="Local Express API (:5001) and Flask stream engine (:5002)"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                online === 2 ? "bg-sage" : online === 1 ? "bg-brass" : "bg-mist/50"
              )}
            />
            {online}/2 live
          </div>
          <button
            onClick={() => setAiOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-full border border-seam text-mist transition-all hover:border-iris/50 hover:text-iris"
            title="Open Mood Studio"
          >
            <Sparkles size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
