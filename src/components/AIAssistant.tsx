import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Play, SendHorizonal, Sparkles, X } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { MOODS } from "../data/demo";
import { analyseMood, moodLabel } from "../services/ai";
import { fmtTime } from "../lib/ui";
import { cn } from "../utils/cn";
import Artwork from "./Artwork";
import type { ChatMessage, MoodKey, Track } from "../types";

const uid = () => Math.random().toString(36).slice(2, 9);

export default function AIAssistant() {
  const { aiOpen, setAiOpen, playTrack, current } = usePlayer();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Tell me how you're feeling — a sentence, a word, whatever comes. I'll read the mood and queue something fitting.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = useCallback((m: ChatMessage) => setMessages((ms) => [...ms, m]), []);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || thinking) return;
      setInput("");
      push({ id: uid(), role: "user", text });
      setThinking(true);
      try {
        const a = await analyseMood(text);
        push({
          id: uid(),
          role: "assistant",
          text: a.reply,
          mood: a.mood,
          tracks: a.tracks,
        });
      } catch {
        push({
          id: uid(),
          role: "assistant",
          text: "The mood engine glitched for a second — try rephrasing how you feel.",
        });
      } finally {
        setThinking(false);
      }
    },
    [push, thinking]
  );

  /* external mood requests (sidebar / home cards) */
  useEffect(() => {
    const onMood = (e: Event) => {
      const key = (e as CustomEvent<MoodKey>).detail;
      setAiOpen(true);
      const label = moodLabel(key).toLowerCase();
      submit(`I'm feeling ${label}`);
    };
    window.addEventListener("tansen:mood", onMood);
    return () => window.removeEventListener("tansen:mood", onMood);
  }, [setAiOpen, submit]);

  /* autoscroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, aiOpen]);

  return (
    <motion.aside
      initial={false}
      animate={{ x: aiOpen ? 0 : "110%", opacity: aiOpen ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      className={`fixed right-0 top-0 z-[45] flex w-full max-w-[440px] flex-col border-l border-seam bg-coal/95 backdrop-blur-xl ${current ? "bottom-[92px]" : "bottom-0"}`}
      style={{ pointerEvents: aiOpen ? "auto" : "none" }}
      aria-hidden={!aiOpen}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-seam px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-iris/15 text-iris">
            <Sparkles size={15} />
          </div>
          <div>
            <p className="text-sm font-medium">Mood Studio</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist">
              distilbert · gpt2
            </p>
          </div>
        </div>
        <button
          onClick={() => setAiOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-full text-mist transition-colors hover:bg-seam hover:text-paper"
        >
          <X size={15} />
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[86%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed",
                  m.role === "user"
                    ? "rounded-br-md bg-brass text-ink"
                    : "rounded-bl-md border border-seam bg-ink/60 text-paper/90"
                )}
              >
                {m.role === "assistant" && m.mood && (
                  <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-iris/30 bg-iris/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-iris">
                    <Bot size={10} />
                    mood · {moodLabel(m.mood)}
                  </span>
                )}
                <p>{m.text}</p>
                {m.tracks && m.tracks.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {m.tracks.map((t) => (
                      <RecoRow key={t.id} track={t} onPlay={() => playTrack(t, m.tracks!)} />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {thinking && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-seam bg-ink/60 px-4 py-3.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-mist"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* quick moods */}
      <div className="flex gap-2 overflow-x-auto px-5 pb-3 [scrollbar-width:none]">
        {MOODS.map((m) => (
          <button
            key={m.key}
            onClick={() => submit(`I'm feeling ${m.label.toLowerCase()}`)}
            className="shrink-0 rounded-full border border-seam px-3 py-1.5 text-xs text-mist transition-colors hover:text-paper"
            style={{ borderColor: `${m.accent}33` }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="border-t border-seam p-4"
      >
        <div className="flex items-center gap-2 rounded-full border border-seam bg-ink/70 py-1.5 pl-5 pr-1.5 transition-colors focus-within:border-iris/50">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. I just finished a long run and feel unstoppable…"
            className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-mist/50"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="grid h-9 w-9 place-items-center rounded-full bg-iris text-ink transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
          >
            <SendHorizonal size={15} />
          </button>
        </div>
      </form>
    </motion.aside>
  );
}

function RecoRow({ track, onPlay }: { track: Track; onPlay: () => void }) {
  return (
    <button
      onClick={onPlay}
      className="group flex w-full items-center gap-2.5 rounded-lg border border-seam/70 bg-coal/60 p-1.5 text-left transition-colors hover:border-mist/30"
    >
      <Artwork track={track} size={34} rounding="rounded-md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{track.title}</span>
        <span className="block truncate text-[10px] text-mist">{track.artist}</span>
      </span>
      <span className="font-mono text-[9px] text-mist/70">{fmtTime(track.duration)}</span>
      <span className="grid h-6 w-6 place-items-center rounded-full bg-brass text-ink opacity-0 transition-opacity group-hover:opacity-100">
        <Play size={10} className="ml-px fill-current" />
      </span>
    </button>
  );
}
