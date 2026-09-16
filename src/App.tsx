import { AnimatePresence, motion } from "framer-motion";
import { Home, Search, Sparkles } from "lucide-react";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import HomeView from "./components/HomeView";
import SearchView from "./components/SearchView";
import PlayerBar from "./components/PlayerBar";
import LyricsPanel from "./components/LyricsPanel";
import AIAssistant from "./components/AIAssistant";
import { cn } from "./utils/cn";

function MobileNav() {
  const { view, setView, search, aiOpen, setAiOpen } = usePlayer();
  const items = [
    { key: "home" as const, icon: Home, label: "Home", action: () => { setView("home"); search(""); } },
    { key: "search" as const, icon: Search, label: "Search", action: () => setView("search") },
    { key: "ai" as const, icon: Sparkles, label: "Mood", action: () => setAiOpen(!aiOpen) },
  ];
  return (
    <div className="flex border-b border-seam bg-ink/80 lg:hidden">
      {items.map((it) => {
        const active = it.key === "ai" ? aiOpen : view === it.key;
        return (
          <button
            key={it.key}
            onClick={it.action}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 py-2.5 text-xs transition-colors",
              active ? "text-brass" : "text-mist"
            )}
          >
            <it.icon size={14} />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function Shell() {
  const { view } = usePlayer();
  return (
    <div className="grain flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MobileNav />
        <main className="relative flex-1 overflow-y-auto pb-[130px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="py-4 lg:py-6"
            >
              {view === "home" ? <HomeView /> : <SearchView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <PlayerBar />
      <LyricsPanel />
      <AIAssistant />
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
