import { motion } from "framer-motion";
import { AudioWaveform, Search, Sparkles } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { cn } from "../utils/cn";

export default function ModeLanding() {
  const { mode, setMode } = usePlayer();

  const options = [
    {
      key: "search" as const,
      label: "Search Music",
      sub: "Explore songs, artists, and live streams",
      icon: Search,
      accent: "text-brass",
      border: "hover:border-brass/40",
      bg: "hover:bg-brass/5",
    },
    {
      key: "studio" as const,
      label: "Mood Studio",
      sub: "Language-model recommendations & feeling matches",
      icon: Sparkles,
      accent: "text-iris",
      border: "hover:border-iris/40",
      bg: "hover:bg-iris/5",
    },
  ];

  return (
    <div className="relative flex min-h-[calc(100dvh-120px)] flex-col items-center justify-center px-4 text-center">
      {/* subtle radial gradient glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[420px] w-[420px] rounded-full bg-brass/5 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center">
        {/* brand icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="grid h-16 w-16 place-items-center rounded-2xl bg-brass/15 text-brass shadow-[0_0_35px_rgba(240,168,50,0.25)] ring-1 ring-brass/30"
        >
          <AudioWaveform size={32} strokeWidth={2.2} />
        </motion.div>

        {/* title */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 font-display text-[clamp(2.4rem,6vw,4rem)] leading-none tracking-tight text-paper"
        >
          Tansen
        </motion.h1>

        {/* tagline */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="mt-3 font-sans text-sm tracking-[0.24em] text-mist uppercase"
        >
          Stream · Read · Feel
        </motion.p>

        {/* mode selector */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 grid w-full max-w-md grid-cols-1 gap-3.5 sm:grid-cols-2"
        >
          {options.map((opt) => {
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
                className={cn(
                  "group relative flex flex-col items-start rounded-2xl border border-seam bg-coal/80 p-5 text-left backdrop-blur-md transition-all duration-200",
                  opt.border,
                  opt.bg,
                  active && "border-paper/40 ring-1 ring-paper/20"
                )}
              >
                <div
                  className={cn(
                    "mb-3 grid h-9 w-9 place-items-center rounded-xl bg-seam/80 transition-colors group-hover:scale-105",
                    opt.accent
                  )}
                >
                  <opt.icon size={18} />
                </div>
                <h2 className="text-base font-medium text-paper">{opt.label}</h2>
                <p className="mt-1 text-xs leading-relaxed text-mist">{opt.sub}</p>
              </button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
