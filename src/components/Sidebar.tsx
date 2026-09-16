import { AudioWaveform, Home, Search, Sparkles, CircleDashed } from "lucide-react";
import { motion } from "framer-motion";
import { usePlayer } from "../context/PlayerContext";
import { MOODS } from "../data/demo";
import { requestMood } from "../lib/ui";
import { cn } from "../utils/cn";

function StatusDot({ state }: { state: "online" | "offline" | "checking" }) {
  return (
    <span className="relative flex h-2 w-2">
      {state === "online" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage opacity-60" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          state === "online" ? "bg-sage" : state === "checking" ? "bg-brass animate-pulse-soft" : "bg-mist/40"
        )}
      />
    </span>
  );
}

export default function Sidebar() {
  const { view, setView, search, setAiOpen, aiOpen, status } = usePlayer();

  const nav = [
    { key: "home" as const, label: "Home", icon: Home, action: () => setView("home") },
    { key: "search" as const, label: "Search", icon: Search, action: () => setView("search") },
    { key: "ai" as const, label: "Mood Studio", icon: Sparkles, action: () => setAiOpen(!aiOpen) },
  ];

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-seam bg-coal/60 lg:flex">
      {/* brand */}
      <div className="flex items-center gap-3 px-6 pt-7">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-brass text-ink">
          <AudioWaveform size={20} strokeWidth={2.4} />
        </div>
        <div>
          <p className="font-display text-[22px] leading-none tracking-wide">Tansen</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-mist">
            v2 · studio
          </p>
        </div>
      </div>

      {/* nav */}
      <nav className="mt-9 space-y-1 px-3">
        {nav.map((item) => {
          const active = item.key === "ai" ? aiOpen : view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                item.action();
                if (item.key === "home") search("");
              }}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium tracking-wide transition-colors",
                active ? "text-paper" : "text-mist hover:text-paper"
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-lg bg-seam"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <item.icon size={17} className="relative z-10" />
              <span className="relative z-10">{item.label}</span>
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brass" />
              )}
            </button>
          );
        })}
      </nav>

      {/* moods */}
      <div className="mt-10 px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-mist">Play by mood</p>
        <div className="mt-4 space-y-1.5">
          {MOODS.map((m) => (
            <button
              key={m.key}
              onClick={() => requestMood(m.key)}
              className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-seam/70"
            >
              <span
                className="h-2 w-2 rounded-full transition-transform group-hover:scale-125"
                style={{ background: m.accent }}
              />
              <span className="text-[13px] text-mist transition-colors group-hover:text-paper">
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1" />

      {/* service status */}
      <div className="mx-4 mb-5 rounded-xl border border-seam bg-ink/60 p-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist">
          <CircleDashed size={12} className={status.api === "checking" ? "animate-spin" : ""} />
          Local services
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12px] text-mist">
              <StatusDot state={status.api} /> API bridge
            </span>
            <span className="font-mono text-[10px] text-mist/70">:5001</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12px] text-mist">
              <StatusDot state={status.stream} /> Stream engine
            </span>
            <span className="font-mono text-[10px] text-mist/70">:5002</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-mist/70">
          Offline? App runs a demo catalogue until the services start.
        </p>
      </div>
    </aside>
  );
}
