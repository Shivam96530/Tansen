import { useEffect, useMemo, useState } from "react";
import { Music2 } from "lucide-react";
import { cn } from "../utils/cn";
import type { Track } from "../types";

const PALETTES: [string, string][] = [
  ["#f0a832", "#5a2d82"],
  ["#9b8cff", "#14342b"],
  ["#ff6b8b", "#40220e"],
  ["#5fd9a4", "#1b2a4a"],
  ["#6fc3df", "#3a1f3d"],
  ["#e8e6dd", "#412a14"],
  ["#f0a832", "#123c3c"],
  ["#c07f14", "#2d1e4f"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export default function Artwork({
  track,
  size = 48,
  className,
  rounding = "rounded-lg",
  spinning = false,
}: {
  track: Track | null;
  size?: number;
  className?: string;
  rounding?: string;
  spinning?: boolean;
}) {
  const seed = track?.id ?? "empty";
  const h = useMemo(() => hash(seed), [seed]);
  const [c1, c2] = PALETTES[h % PALETTES.length];
  const angle = (h % 360) + "deg";

  /* YouTube thumbnails can 404 (deleted/private videos) — swap to the
     generative gradient cover when the image fails to load. */
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [track?.id, track?.thumbnail]);

  const showImage = !!track?.thumbnail && !broken;

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden bg-seam", rounding, className)}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={track!.thumbnail!}
          alt={track!.title}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: `conic-gradient(from ${angle} at 50% 50%, ${c1}, ${c2} 45%, #0a0a0c 75%, ${c1})`,
            }}
          />
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background:
                "repeating-radial-gradient(circle at 50% 50%, transparent 0px, transparent 5px, rgba(0,0,0,0.35) 6px)",
            }}
          />
          <div className="absolute inset-0 grid place-items-center">
            <div
              className={cn(
                "grid place-items-center rounded-full bg-ink/70",
                spinning && "animate-spin-slow"
              )}
              style={{ width: size * 0.42, height: size * 0.42 }}
            >
              <Music2 size={size * 0.18} className="text-paper/80" />
            </div>
          </div>
        </>
      )}
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10" style={{ borderRadius: "inherit" }} />
    </div>
  );
}
