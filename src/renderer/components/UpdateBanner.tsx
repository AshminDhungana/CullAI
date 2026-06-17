import { useState, useEffect } from "react";
import { Download, X, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";
import useUpdater from "../hooks/useUpdater";

type BannerState = "available" | "downloading" | "downloaded" | "error";

// Auto-dismiss durations (ms).
const AUTO_DISMISS_MS: Partial<Record<BannerState, number>> = {
  available:   5000,
  downloading: 0,    // never auto-dismiss while actively downloading
  downloaded:  6000, // give user time to read + click Restart, then dismiss
  error:       8000, // a bit longer so they can read the message
};

export default function UpdateBanner() {
  const { state, dismiss, checkForUpdates } = useUpdater();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  const hasContent =
    !state.isDismissed &&
    (state.updateAvailable !== null ||
      state.updateDownloaded !== null ||
      state.error !== null);

  // Slide in when content appears
  useEffect(() => {
    if (hasContent) {
      setExiting(false);
      setVisible(true);
    }
  }, [hasContent]);

  // Auto-dismiss for transient states
  const bannerState: BannerState = (() => {
    if (state.error) return "error";
    if (state.updateDownloaded) return "downloaded";
    if (state.downloadProgress) return "downloading";
    return "available";
  })();

  useEffect(() => {
    const delay = AUTO_DISMISS_MS[bannerState];
    if (!delay) return; // 0 or undefined → no auto-dismiss for this state
    const t = setTimeout(handleDismiss, delay);
    return () => clearTimeout(t);
  }, [bannerState]);

  function handleDismiss() {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      dismiss();
    }, 300); // matches transition duration
  }

  if (!hasContent || !visible) return null;

  // ── Colour tokens per state ──────────────────────────────────────────────
  const colours = {
    error:      "bg-red-50   dark:bg-red-950/60   border-red-400/50   text-red-800   dark:text-red-200",
    downloaded: "bg-green-50 dark:bg-green-950/60 border-green-400/50 text-green-800 dark:text-green-200",
    downloading:"bg-blue-50  dark:bg-blue-950/60  border-blue-400/50  text-blue-800  dark:text-blue-200",
    available:  "bg-amber-50 dark:bg-amber-950/60 border-amber-400/50 text-amber-800 dark:text-amber-200",
  }[bannerState];

  const progressPercent = state.downloadProgress
    ? Math.round(state.downloadProgress.percent)
    : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        // Slide in from left, fade out on exit
        transform: exiting ? "translateX(-110%)" : "translateX(0)",
        opacity: exiting ? 0 : 1,
        transition: "transform 300ms cubic-bezier(0.4,0,0.2,1), opacity 300ms ease",
      }}
      className={[
        "fixed top-4 left-4 z-[100]",
        "w-72 rounded-xl border shadow-lg shadow-black/10",
        "backdrop-blur-md",
        colours,
      ].join(" ")}
    >
      <div className="flex items-start gap-3 p-3.5">

        {/* ── Icon ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 mt-0.5">
          {bannerState === "error"       && <AlertCircle  className="w-4 h-4" />}
          {bannerState === "downloaded"  && <CheckCircle  className="w-4 h-4" />}
          {bannerState === "available"   && <Download     className="w-4 h-4 animate-bounce" />}
          {bannerState === "downloading" && (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {bannerState === "error" && (
            <>
              <p className="text-xs font-semibold leading-tight">Update check failed</p>
              <p className="text-xs opacity-75 leading-tight truncate">
                {state.error?.message ?? "Unknown error"}
              </p>
              <button
                onClick={checkForUpdates}
                className="inline-flex items-center gap-1 mt-0.5 px-2 py-1 rounded-md text-xs font-medium bg-current/10 hover:bg-current/20 transition"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            </>
          )}

          {bannerState === "available" && (
            <>
              <p className="text-xs font-semibold leading-tight">Update available</p>
              <p className="text-xs opacity-75 leading-tight">
                {state.updateAvailable?.version
                  ? `v${state.updateAvailable.version} — downloading in background`
                  : "Downloading in background…"}
              </p>
            </>
          )}

          {bannerState === "downloading" && (
            <>
              <p className="text-xs font-semibold leading-tight">
                Downloading update… {progressPercent}%
              </p>
              <div className="h-1 w-full bg-current/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-current rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs opacity-60">
                {((state.downloadProgress?.transferred ?? 0) / 1024 / 1024).toFixed(1)} /{" "}
                {((state.downloadProgress?.total ?? 0) / 1024 / 1024).toFixed(1)} MB
              </p>
            </>
          )}

          {bannerState === "downloaded" && (
            <>
              <p className="text-xs font-semibold leading-tight">
                CullAI {state.updateDownloaded?.version} ready
              </p>
              <p className="text-xs opacity-75 leading-tight">
                Restart to install the update.
              </p>
              <button
                onClick={() => {
                  if (window.electronAPI?.quitApp) {
                    window.electronAPI.quitApp();
                  } else {
                    window.close();
                  }
                }}
                className="inline-flex items-center gap-1 mt-0.5 px-2 py-1 rounded-md text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition"
              >
                Restart Now
              </button>
            </>
          )}
        </div>

        {/* ── Dismiss ──────────────────────────────────────────────────── */}
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 -mt-0.5 -mr-0.5 rounded-md hover:bg-current/10 transition"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}