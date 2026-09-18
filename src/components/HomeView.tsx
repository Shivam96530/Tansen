import { motion } from "framer-motion";
import { ArrowRight, AudioLines, BrainCircuit, ScanText, TrendingUp } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { DEMO_TRACKS, MOODS } from "../data/demo";
import { requestMood } from "../lib/ui";
import TrackRow from "./TrackRow";

const ease = [0.22, 1, 0.36, 1] as const;

const PIPELINE = [
  {
    icon: AudioLines,
    title: "Audio streaming",
    body: "Search resolves via YouTube; the stream engine extracts a direct .m4a URL — nothing is ever downloaded.",
    meta: "yt-dlp · flask · :5002",
  },
  {
    icon: ScanText,
    title: "Lyrics resolution",
    body: "The API bridge queries Genius search and scrapes lyric containers into clean, readable text.",
    meta: "genius api + cheerio · :5001",
  },
  {
    icon: BrainCircuit,
    title: "Mood intelligence",
    body: "A server-side language model reads how you feel and composes targeted recommendations — keys never touch the browser.",
    meta: "chat completions · server-side hugging face",
  },
];

export default function HomeView() {
  const { playTrack, search } = usePlayer();
  const trending = DEMO_TRACKS.slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 lg:px-8">
      {/* ---------- hero ---------- */}
      <section className="relative overflow-hidden rounded-3xl border border-seam bg-coal/60 px-6 pb-14 pt-14 lg:px-12 lg:pt-20">
        {/* ambient glows */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(240,168,50,0.16), transparent 65%)" }}
          animate={{ y: [0, 22, 0], x: [0, -14, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(155,140,255,0.12), transparent 65%)" }}
          animate={{ y: [0, -18, 0], x: [0, 16, 0] }}
          transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="font-mono text-[10px] uppercase tracking-[0.3em] text-brass"
        >
          Stream · Read · Feel
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease }}
          className="mt-5 font-display text-[clamp(2.6rem,7vw,5rem)] leading-[1.02] tracking-tight text-balance"
        >
          Music you can
          <br />
          <em className="text-brass">read between</em> the lines.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16, ease }}
          className="mt-6 max-w-md text-[15px] leading-relaxed text-mist"
        >
          Search any song, stream it live, follow the lyrics — then tell the
          studio how you feel and let mood intelligence queue the next track.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24, ease }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <button
            onClick={() => playTrack(trending[0], trending)}
            className="group flex items-center gap-2.5 rounded-full bg-brass px-5 py-2.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.03] active:scale-95"
          >
            Start listening
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={() => search("weekend lofi")}
            className="rounded-full border border-seam px-5 py-2.5 text-sm text-mist transition-colors hover:border-mist/40 hover:text-paper"
          >
            Try a search
          </button>
        </motion.div>
      </section>

      {/* ---------- moods ---------- */}
      <section className="mt-10">
        <div className="flex items-end justify-between px-1">
          <h2 className="font-display text-2xl">How do you feel right now?</h2>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-mist sm:block">
            analysed live
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MOODS.map((m, i) => (
            <motion.button
              key={m.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.5, ease }}
              onClick={() => requestMood(m.key)}
              className="group relative overflow-hidden rounded-2xl border border-seam bg-coal/70 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-mist/30"
            >
              <span
                className="absolute inset-x-0 top-0 h-[3px] opacity-70 transition-opacity group-hover:opacity-100"
                style={{ background: m.accent }}
              />
              <span
                className="pointer-events-none absolute -bottom-10 -right-10 h-28 w-28 rounded-full opacity-[0.13] blur-2xl transition-opacity group-hover:opacity-25"
                style={{ background: m.accent }}
              />
              <p className="font-display text-xl">{m.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-mist">{m.blurb}</p>
            </motion.button>
          ))}
        </div>
      </section>

      {/* ---------- trending ---------- */}
      <section className="mt-12">
        <div className="flex items-center gap-2 px-1">
          <TrendingUp size={15} className="text-brass" />
          <h2 className="font-display text-2xl">In rotation</h2>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-seam bg-coal/40 p-2">
          {trending.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} context={trending} />
          ))}
        </div>
      </section>

      {/* ---------- pipeline ---------- */}
      <section className="mt-12">
        <div className="px-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-mist">Signal chain</p>
          <h2 className="mt-2 font-display text-2xl">How the studio works</h2>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.08, duration: 0.5, ease }}
              className="rounded-2xl border border-seam bg-coal/50 p-5"
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-seam bg-ink text-brass">
                <p.icon size={16} />
              </div>
              <p className="mt-4 text-[15px] font-medium">{p.title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-mist">{p.body}</p>
              <p className="mt-4 border-t border-seam pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-mist/70">
                {p.meta}
              </p>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
