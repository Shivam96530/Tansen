import { cn } from "../utils/cn";

export default function Equalizer({
  playing,
  className,
  barClass = "bg-brass",
}: {
  playing: boolean;
  className?: string;
  barClass?: string;
}) {
  const bars = ["animate-eq-1", "animate-eq-2", "animate-eq-3", "animate-eq-4"];
  return (
    <div className={cn("flex items-end gap-[3px]", className)} aria-hidden>
      {bars.map((b, i) => (
        <span
          key={i}
          className={cn("w-[3px] origin-bottom rounded-full", b, barClass)}
          style={{
            height: "100%",
            animationPlayState: playing ? "running" : "paused",
            transform: playing ? undefined : "scaleY(0.25)",
          }}
        />
      ))}
    </div>
  );
}
