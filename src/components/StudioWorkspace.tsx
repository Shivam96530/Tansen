import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, AudioWaveform, Bot, Play, SendHorizonal, Sparkles } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { MOODS } from "../lib/moods";
import { analyseMood } from "../services/ai";
import { fmtTime } from "../lib/ui";
import Artwork from "./Artwork";
import type { ChatMessage } from "../types";

const uid = () => Math.random().toString(36).slice(2, 9);

export default function StudioWorkspace() {
  const { navigateBack, playTrack, current } = usePlayer();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Tell me how you're feeling — a sentence, a situation, or a vibe. I'll read the emotion and curate a tracklist tuned to you.",
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
          emotion: a.emotion,
          tracks: a.tracks,
        });
      } catch {
        push({
          id: uid(),
          role: "assistant",
          text: "The mood engine encountered a brief hiccup — try describing your vibe again.",
        });
      } finally {
        setThinking(false);
      }
    },
    [push, thinking]
  );

  /* autoscroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="mx-auto flex h-[calc(100dvh-130px)] max-w-4xl flex-col px-4 py-6 sm:px-6">
      {/* top bar with back navigation */}
      <div className="flex items-center justify-between pb-4 border-b border-seam/60">
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
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-iris uppercase">
          <Sparkles size={12} />
          Mood Studio
        </span>
      </div>

      {/* mood shortcuts */}
      <div className="flex flex-wrap items-center gap-1.5 py-3 border-b border-seam/40">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-mist/50">
          Presets:
        </span>
        {MOODS.map((m) => (
          <button
            key={m.key}
            onClick={() => submit(`I want some ${m.label.toLowerCase()} songs`)}
            className="rounded-full border border-seam bg-coal/50 px-3 py-1 text-xs text-mist transition-colors hover:border-iris/40 hover:text-paper"
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* chat feed */}
      <div ref={scrollRef} className="touch-scroll flex-1 overflow-y-auto space-y-4 py-4 pr-1">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-iris/20 text-paper border border-iris/30"
                  : "bg-coal/90 text-paper/90 border border-seam"
              }`}
            >
              {m.role === "assistant" && (
                <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-iris">
                  <Bot size={12} />
                  <span>Studio AI</span>
                  {m.emotion && <span className="text-mist">• {m.emotion}</span>}
                </div>
              )}
              <p>{m.text}</p>
            </div>

            {/* recommendations attached to assistant reply */}
            {m.tracks && m.tracks.length > 0 && (
              <div className="mt-3 w-full space-y-1.5 pl-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-mist">
                  Recommended Tracks ({m.tracks.length}):
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {m.tracks.map((track) => {
                    const active = current?.id === track.id;
                    return (
                      <button
                        key={track.id}
                        onClick={() => playTrack(track, m.tracks)}
                        className={`group flex items-center gap-3 rounded-xl border border-seam bg-coal/60 p-2 text-left transition-colors hover:bg-coal ${
                          active ? "border-brass/50 bg-seam/60" : ""
                        }`}
                      >
                        <Artwork track={track} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-paper">{track.title}</p>
                          <p className="truncate text-[11px] text-mist">{track.artist}</p>
                        </div>
                        <span className="font-mono text-[10px] text-mist/60 mr-1">
                          {fmtTime(track.duration)}
                        </span>
                        <div className="grid h-7 w-7 place-items-center rounded-full bg-brass/15 text-brass opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={12} className="ml-0.5 fill-current" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-xs text-mist font-mono py-2">
            <Sparkles size={14} className="animate-spin text-iris" />
            <span>Analyzing emotions and curating tracks…</span>
          </div>
        )}
      </div>

      {/* input bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="relative mt-2 pt-2 border-t border-seam/60"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your mood, activity, or what kind of vibe you want…"
          className="w-full rounded-2xl border border-seam bg-coal/90 py-3.5 pl-4 pr-12 text-sm text-paper placeholder-mist/60 outline-none backdrop-blur-md transition-all focus:border-iris/50 focus:ring-1 focus:ring-iris/30"
        />
        <button
          type="submit"
          disabled={!input.trim() || thinking}
          className="absolute right-2.5 top-[18px] grid h-8 w-8 place-items-center rounded-xl bg-iris text-ink transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          <SendHorizonal size={15} />
        </button>
      </form>
    </div>
  );
}
