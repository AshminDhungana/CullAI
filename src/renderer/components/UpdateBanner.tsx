import { useState, useEffect, useRef } from "react";
import { Download, X, RotateCcw, CheckCircle, AlertCircle, Sparkles } from "lucide-react";
import useUpdater from "../hooks/useUpdater";

type BannerState = "available" | "downloading" | "downloaded" | "error";

// How long to wait before showing the banner on first run (ms).
// Lets the welcome/setup wizard render first without an immediate interruption.
const FIRST_RUN_DELAY_MS = 8000;

// Auto-dismiss durations (ms). 0 = never auto-dismiss.
const AUTO_DISMISS_MS: Partial<Record<BannerState, number>> = {
  available:   0,     // on first run the user should dismiss manually; non-first-run handled below
  downloading: 0,     // never auto-dismiss while actively downloading
  downloaded:  8000,  // give user time to read + click Restart, then tidy up
  error:       10000, // a bit longer so they can read the message
};

// Non-first-run auto-dismiss for "available" (shorter, less disruptive).
const AVAILABLE_AUTO_DISMISS_MS = 5000;

interface UpdateBannerProps {
  /** Pass `true` while the user is going through first-run / setup wizard. */
  isFirstRun?: boolean;
}

export default function UpdateBanner({ isFirstRun = false }: UpdateBannerProps) {
  const { state, dismiss, checkForUpdates } = useUpdater();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  // Whether the first-run delay grace period has elapsed.
  const [graceElapsed, setGraceElapsed] = useState(!isFirstRun);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasContent =
    !state.isDismissed &&
    (state.updateAvailable !== null ||
      state.updateDownloaded !== null ||
      state.error !== null);

  // Start the grace-period timer when on first run.
  useEffect(() => {
    if (!isFirstRun) return;
    graceTimerRef.current = setTimeout(() => setGraceElapsed(true), FIRST_RUN_DELAY_MS);
    return () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  }, [isFirstRun]);

  // Slide in only once there is content AND the grace period has passed.
  useEffect(() => {
    if (hasContent && graceElapsed) {
      setExiting(false);
      setVisible(true);
    }
  }, [hasContent, graceElapsed]);

  const bannerState: BannerState = (() => {
    if (state.error) return "error";
    if (state.updateDownloaded) return "downloaded";
    if (state.downloadProgress) return "downloading";
    return "available";
  })();

  // Auto-dismiss logic — respects first-run context.
  useEffect(() => {
    if (!visible) return;
    const delay =
      bannerState === "available" && !isFirstRun
        ? AVAILABLE_AUTO_DISMISS_MS
        : AUTO_DISMISS_MS[bannerState];
    if (!delay) return;
    const t = setTimeout(handleDismiss, delay);
    return () => clearTimeout(t);
  }, [bannerState, visible, isFirstRun]);

  function handleDismiss() {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      dismiss();
    }, 320);
  }

  if (!hasContent || !visible) return null;

  // ── Position: bottom-right on first run (away from setup wizard nav),
  //    top-left otherwise (existing behaviour). ────────────────────────────────
  const positionClass = isFirstRun
    ? "fixed bottom-6 right-6 z-[100]"
    : "fixed top-4 left-4 z-[100]";

  // ── Entry/exit animation direction matches position. ─────────────────────────
  const exitTransform = isFirstRun ? "translateY(120%)" : "translateX(-110%)";
  const idleTransform = isFirstRun ? "translateY(0)" : "translateX(0)";

  // ── Colour tokens per state ──────────────────────────────────────────────────
  const colours = {
    error:       "bg-red-50   dark:bg-red-950/60   border-red-400/50   text-red-800   dark:text-red-200",
    downloaded:  "bg-green-50 dark:bg-green-950/60 border-green-400/50 text-green-800 dark:text-green-200",
    downloading: "bg-blue-50  dark:bg-blue-950/60  border-blue-400/50  text-blue-800  dark:text-blue-200",
    available:   isFirstRun
      ? "bg-amber-50 dark:bg-amber-950/60 border-amber-400/50 text-amber-800 dark:text-amber-200"
      : "bg-amber-50 dark:bg-amber-950/60 border-amber-400/50 text-amber-800 dark:text-amber-200",
  }[bannerState];

  const progressPercent = state.downloadProgress
    ? Math.round(state.downloadProgress.percent)
    : 0;

  // ── Friendly copy variants for first-run ────────────────────────────────────
  const copy = {
    available: {
      title: isFirstRun ? "You're all set — and getting better!" : "Update available",
      body: isFirstRun
        ? state.updateAvailable?.version
          ? `v${state.updateAvailable.version} is downloading quietly in the background. No action needed.`
          : "A new version is downloading quietly in the background. No action needed."
        : state.updateAvailable?.version
          ? `v${state.updateAvailable.version} — downloading in background`
          : "Downloading in background…",
    },
    downloading: {
      title: isFirstRun
        ? `Fetching the latest version… ${progressPercent}%`
        : `Downloading update… ${progressPercent}%`,
    },
    downloaded: {
      title: isFirstRun
        ? `You're on the latest version of CullAI ${state.updateDownloaded?.version ?? ""}!`
        : `CullAI ${state.updateDownloaded?.version ?? ""} ready`,
      body: isFirstRun
        ? "Restart whenever you're ready to apply it."
        : "Restart to install the update.",
    },
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        transform: exiting ? exitTransform : idleTransform,
        opacity: exiting ? 0 : 1,
        transition: "transform 320ms cubic-bezier(0.4,0,0.2,1), opacity 320ms ease",
      }}
      className={[
        positionClass,
        "w-72 rounded-xl border shadow-lg shadow-black/10",
        "backdrop-blur-md",
        colours,
      ].join(" ")}
    >
      <div className="flex items-start gap-3 p-3.5">

        {/* ── Icon ──────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 mt-0.5">
          {bannerState === "error"       && <AlertCircle className="w-4 h-4" />}
          {bannerState === "downloaded"  && (
            isFirstRun
              ? <Sparkles className="w-4 h-4" />
              : <CheckCircle className="w-4 h-4" />
          )}
          {bannerState === "available"   && (
            isFirstRun
              ? <Sparkles className="w-4 h-4 animate-pulse" />
              : <Download  className="w-4 h-4 animate-bounce" />
          )}
          {bannerState === "downloading" && (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* ── Body ──────────────────────────────────────────────────────────── */}
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
              <p className="text-xs font-semibold leading-tight">{copy.available.title}</p>
              <p className="text-xs opacity-75 leading-tight">{copy.available.body}</p>
            </>
          )}

          {bannerState === "downloading" && (
            <>
              <p className="text-xs font-semibold leading-tight">{copy.downloading.title}</p>
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
              <p className="text-xs font-semibold leading-tight">{copy.downloaded.title}</p>
              <p className="text-xs opacity-75 leading-tight">{copy.downloaded.body}</p>
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

        {/* ── Dismiss ───────────────────────────────────────────────────────── */}
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