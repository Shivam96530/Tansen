import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, ChevronUp, ShieldCheck, Smartphone, X, Volume2 } from "lucide-react";

export default function BackgroundPermissionPrompt() {
  const [isOpen, setIsOpen] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported">("default");
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobile =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (window.matchMedia && window.matchMedia("(max-width: 768px)").matches);

    if (!("Notification" in window)) {
      setPermissionState("unsupported");
      return;
    }

    setPermissionState(Notification.permission);

    // Check if dismissed in this session
    const isDismissed = sessionStorage.getItem("tansen_bg_perm_dismissed") === "1";

    // Auto-show prompt on mobile if notification permission is not yet granted
    if (isMobile && Notification.permission === "default" && !isDismissed) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const requestPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setStatusMessage("Notifications are not supported by this browser.");
      return;
    }

    try {
      // 1. Request notification permission (must be triggered from user tap)
      const perm = await Notification.requestPermission();
      setPermissionState(perm);

      // 2. Pre-arm audio context / silent unlock
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          if (ctx.state === "suspended") {
            await ctx.resume();
          }
        }
      } catch {
        /* ignore */
      }

      // 3. Request screen wake lock if available
      try {
        if ("wakeLock" in navigator && (navigator as any).wakeLock) {
          await (navigator as any).wakeLock.request("screen");
        }
      } catch {
        /* ignore */
      }

      if (perm === "granted") {
        setStatusMessage("✓ Background & lock screen controls activated!");
        sessionStorage.setItem("tansen_bg_perm_dismissed", "1");
        setTimeout(() => {
          setIsOpen(false);
        }, 2200);
      } else if (perm === "denied") {
        setStatusMessage("Notifications blocked. Use Chrome's 'Desktop site' setting below.");
        setShowManualGuide(true);
      }
    } catch (err) {
      setShowManualGuide(true);
    }
  };

  const handleDismiss = () => {
    setIsOpen(false);
    sessionStorage.setItem("tansen_bg_perm_dismissed", "1");
  };

  return (
    <>
      {/* Discreet floating trigger badge visible on mobile so user can open settings anytime */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-seam/80 bg-ink/80 px-2.5 py-1 text-[11px] font-medium text-mist backdrop-blur-md transition-colors hover:border-brass/50 hover:text-paper active:scale-95 sm:hidden"
        title="Mobile Background Audio Settings"
      >
        <Smartphone size={13} className="text-brass" />
        <span>{permissionState === "granted" ? "BG Audio Active" : "BG Audio Setup"}</span>
      </button>

      {/* Permission modal / bottom sheet */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleDismiss}
              className="absolute inset-0 bg-ink/75 backdrop-blur-sm"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ y: 80, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 80, opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-seam/90 bg-coal/95 p-5 shadow-2xl backdrop-blur-2xl text-paper"
            >
              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full text-mist transition-colors hover:bg-seam hover:text-paper"
                title="Close"
              >
                <X size={16} />
              </button>

              <div className="flex items-start gap-3.5 pr-8">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brass/15 text-brass ring-1 ring-brass/30">
                  <Volume2 size={22} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight text-paper">
                    Mobile Chrome Background Audio
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-mist">
                    Google Chrome automatically suspends media when you lock your screen or switch tabs. Enable permission to pin persistent lock screen and notification controls.
                  </p>
                </div>
              </div>

              {/* Status or action banner */}
              {statusMessage && (
                <div className="mt-3.5 rounded-xl border border-brass/30 bg-brass/10 px-3.5 py-2 text-xs font-medium text-paper">
                  {statusMessage}
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-4 flex flex-col gap-2">
                {permissionState !== "granted" ? (
                  <button
                    onClick={requestPermission}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brass py-3 text-xs font-semibold text-ink shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <ShieldCheck size={16} />
                    <span>Enable Lock Screen & Background Controls</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-medium text-emerald-300">
                    <Check size={15} />
                    <span>Background controls active on this device</span>
                  </div>
                )}

                {/* Manual Chrome Bypass Accordion */}
                <button
                  type="button"
                  onClick={() => setShowManualGuide((v) => !v)}
                  className="flex items-center justify-between rounded-xl border border-seam/60 bg-ink/40 px-3 py-2 text-left text-xs text-mist transition-colors hover:text-paper"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    💡 Bypass Chrome pausing completely (Guide)
                  </span>
                  {showManualGuide ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>

                {showManualGuide && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden rounded-xl border border-seam/80 bg-ink/70 p-3.5 text-xs text-mist"
                  >
                    <p className="font-semibold text-paper mb-1.5">2 Ways to bypass Chrome on Android:</p>
                    <ol className="list-decimal space-y-1.5 pl-4 leading-relaxed">
                      <li>
                        <strong className="text-paper">Chrome Desktop Site (Recommended):</strong> Tap Chrome&apos;s menu (<span className="text-brass">⋮</span> in top right corner) &rarr; Check <strong className="text-paper">&quot;Desktop site&quot;</strong>. In desktop mode, Chrome never silences background media!
                      </li>
                      <li>
                        <strong className="text-paper">Install as App (PWA):</strong> Tap Chrome&apos;s menu (<span className="text-brass">⋮</span>) &rarr; Tap <strong className="text-paper">&quot;Add to Home screen&quot;</strong>. Installed apps get full background audio priority from Android.
                      </li>
                    </ol>
                  </motion.div>
                )}

                <button
                  onClick={handleDismiss}
                  className="mt-1 py-1.5 text-center text-xs text-mist/80 transition-colors hover:text-paper"
                >
                  Dismiss for now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
