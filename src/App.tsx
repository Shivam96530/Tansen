import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, Loader2, Pause, Play, SkipForward, X } from "lucide-react";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import ModeLanding from "./components/ModeLanding";
import SearchWorkspace from "./components/SearchWorkspace";
import StudioWorkspace from "./components/StudioWorkspace";
import ImmersivePlayer from "./components/ImmersivePlayer";
import Artwork from "./components/Artwork";
import BackgroundPermissionPrompt from "./components/BackgroundPermissionPrompt";

function MiniPill() {
  const { current, isPlaying, isLoading, toggle, next, setImmersive, immersive, progress, duration, dismissTrack } = usePlayer();

  if (!current || immersive) return null;

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="fixed bottom-5 inset-x-0 z-50 mx-auto w-[calc(100%-2rem)] max-w-md"
    >
      <div
        onClick={() => setImmersive(true)}
        className="group relative flex cursor-pointer items-center justify-between overflow-hidden rounded-2xl border border-seam/80 bg-ink/90 p-2 pl-2.5 shadow-2xl backdrop-blur-xl transition-all duration-200 hover:border-brass/40"
      >
        {/* hairline progress along top edge */}
        <div className="absolute top-0 inset-x-0 h-0.5 bg-seam">
          <div className="h-full bg-brass" style={{ width: `${pct}%` }} />
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <Artwork track={current} size={42} className="rounded-xl shadow-md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-paper group-hover:text-brass transition-colors">
              {current.title}
            </p>
            <p className="truncate text-[11px] text-mist">{current.artist}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 pl-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={toggle}
            className="grid h-9 w-9 place-items-center rounded-xl bg-brass text-ink transition-transform hover:scale-105 active:scale-95"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={15} className="fill-current" />
            ) : (
              <Play size={15} className="ml-0.5 fill-current" />
            )}
          </button>
          <button
            onClick={next}
            className="grid h-9 w-9 place-items-center rounded-xl text-mist transition-colors hover:bg-coal hover:text-paper"
            title="Next song"
          >
            <SkipForward size={16} />
          </button>
          <button
            onClick={() => setImmersive(true)}
            className="grid h-9 w-9 place-items-center rounded-xl text-mist transition-colors hover:bg-coal hover:text-paper"
            title="Expand player"
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={dismissTrack}
            className="grid h-9 w-9 place-items-center rounded-xl text-mist transition-colors hover:bg-coal hover:text-rose-400"
            title="Close player"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Shell() {
  const { mode } = usePlayer();

  return (
    <div className="grain relative flex h-full flex-col overflow-hidden bg-ink text-paper">
      <main className="touch-scroll relative flex-1 overflow-y-auto pb-24">
        <AnimatePresence mode="wait">
          {mode === "search" ? (
            <motion.div
              key="search"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <SearchWorkspace />
            </motion.div>
          ) : mode === "studio" ? (
            <motion.div
              key="studio"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <StudioWorkspace />
            </motion.div>
          ) : (
            <motion.div
              key="landing"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <ModeLanding />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* MiniPill continuity player bar */}
      <MiniPill />

      {/* Full-screen synced-lyrics bloom player */}
      <AnimatePresence>
        <ImmersivePlayer />
      </AnimatePresence>

      {/* Mobile background audio permission & lockscreen controls prompt */}
      <BackgroundPermissionPrompt />
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}
