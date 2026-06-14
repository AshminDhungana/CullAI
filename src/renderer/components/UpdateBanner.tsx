import { useState } from "react";
import { Download, X, RotateCcw, CheckCircle, AlertCircle, Settings } from "lucide-react";
import useUpdater from "../hooks/useUpdater";

type BannerState = "available" | "downloading" | "downloaded" | "error";

export default function UpdateBanner() {
  const { state, dismiss, checkForUpdates } = useUpdater();
  const [showSettings, setShowSettings] = useState(false);

  // Determine banner visibility and state
  const isVisible = !state.isDismissed && (
    state.updateAvailable !== null ||
    state.updateDownloaded !== null ||
    state.error !== null
  );

  if (!isVisible) return null;

  let bannerState: BannerState = "available";
  if (state.error) bannerState = "error";
  else if (state.updateDownloaded) bannerState = "downloaded";
  else if (state.downloadProgress) bannerState = "downloading";

  // ── Background/Accent colours per state ─────────────────────────────────
  const bgClass
    = bannerState === "error"    ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
    : bannerState === "downloaded" ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300"
    :                               "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300";

  const progressPercent = state.downloadProgress
    ? Math.round(state.downloadProgress.percent)
    : 0;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] border-b backdrop-blur-sm ${bgClass}`}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">

        {/* ── Icon ────────────────────────────────────────────────────────── */}
        {bannerState === "error" && <AlertCircle className="w-5 h-5 flex-shrink-0" />}
        {bannerState === "downloaded" && <CheckCircle className="w-5 h-5 flex-shrink-0" />}
        {bannerState === "available" && <Download className="w-5 h-5 flex-shrink-0 animate-bounce" />}
        {bannerState === "downloading" && (
          <div className="w-5 h-5 flex-shrink-0 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}

        {/* ── Message ───────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {bannerState === "error" && (
            <p className="text-sm font-medium">
              Update check failed: {state.error?.message}
            </p>
          )}

          {bannerState === "available" && (
            <p className="text-sm font-medium">
              A new version of CullAI is available
              {state.updateAvailable?.version && ` (${state.updateAvailable.version})`}.
              Downloading in the background…
            </p>
          )}

          {bannerState === "downloading" && (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Downloading update… {progressPercent}%
              </p>
              <div className="h-1.5 w-full bg-current/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-current rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs opacity-70">
                {((state.downloadProgress?.transferred ?? 0) / 1024 / 1024).toFixed(1)} MB /{" "}
                {((state.downloadProgress?.total ?? 0) / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
          )}

          {bannerState === "downloaded" && (
            <p className="text-sm font-medium">
              Update ready — CullAI {state.updateDownloaded?.version} has been downloaded.
              Restart the app to install.
            </p>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {bannerState === "error" && (
            <button
              onClick={checkForUpdates}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-current/10 hover:bg-current/20 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}

          {bannerState === "downloaded" && (
            <button
              onClick={() => {
                // electron-updater autoInstallOnAppQuit is true by default.
                // We just close the app and let the auto-installer do its job.
                if (window.electronAPI?.quitApp) {
                  window.electronAPI.quitApp();
                } else {
                  window.close();
                }
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition"
            >
              Restart Now
            </button>
          )}

          <button
            onClick={() => setShowSettings((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-current/10 transition"
            title="Update settings"
            aria-label="Update settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={dismiss}
            className="p-1.5 rounded-md hover:bg-current/10 transition"
            title="Dismiss"
            aria-label="Dismiss update notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Settings dropdown (inline, not overlay) ─────────────────────── */}
        {showSettings && (
          <div className="absolute top-full right-4 mt-1 w-64 bg-white dark:bg-[#1a1f2e] border border-gray-200 dark:border-[#2a3347] rounded-lg shadow-lg p-3">
            <h4 className="text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100">
              Auto-Updater Settings
            </h4>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                defaultChecked
                onChange={(e) => {
                  // Would wire to persistent store in full implementation
                  setShowSettings(false);
                }}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Check for updates on startup
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
