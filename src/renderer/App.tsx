import { useEffect, useState, useCallback} from "react";
import { SplashScreen } from "./components/SplashScreen";
import SetupScreen from "./screens/Setup";
import ProcessingScreen from "./screens/Processing";
import ResultsScreen from "./screens/Results";
import type { AppSettings } from "../shared/types";
import { defaultAppSettings } from "../shared/types";
import { useTheme } from "./hooks/useTheme";
import { Sun, Moon } from "lucide-react";

type Screen = "splash" | "setup" | "processing" | "results";

async function preloadResources(): Promise<void> {
  return Promise.resolve();
}

function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [preloadDone, setPreloadDone] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  // Holds the settings chosen in Setup so Processing + Results can read them.
  // Initialised with defaults so the type is always non-nullable downstream.
  const [currentSettings, setCurrentSettings] = useState<AppSettings>(defaultAppSettings());

  const { toggle, isDark } = useTheme();

  useEffect(() => {
    preloadResources().finally(() => setPreloadDone(true));
  }, []);

  useEffect(() => {
    if (preloadDone && splashDone && screen === "splash") {
      setTransitioning(true);
      setTimeout(() => {
        setScreen("setup");
        setTransitioning(false);
      }, 700);
    }
  }, [preloadDone, splashDone, screen]);

  // ── Screen transition handlers ─────────────────────────────────────────────

  /** Called by Setup's "Start Culling" button. */
  const handleStartCulling = useCallback((settings: AppSettings) => {
    setCurrentSettings(settings);
    setScreen("processing");
  }, []);

  const handleCancelProcessing = useCallback(() => {
    setScreen("setup");
  }, []);

  const handleProcessingComplete = useCallback(() => {
    setScreen("results");
  }, []);

  /** Results → back to Setup for another run. */
  const handleBackToSetup = () => {
    setScreen("setup");
  };

  // ── Theme toggle widget ────────────────────────────────────────────────────
  const ThemeToggle = () => (
    <button
      onClick={toggle}
      className="p-2 rounded-lg bg-gray-100 dark:bg-[#1a1f2e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#252b3b] transition border border-gray-200 dark:border-[#1e2535]"
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  //
  // All four layers live in the DOM simultaneously — only the active one is
  // visible.  This avoids remounting and gives smooth opacity + translate
  // transitions between screens.
  //
  // Transition matrix:
  //   splash  → setup       (fade + scale on splash exit, slide-up on setup enter)
  //   setup   → processing  (slide-up)
  //   processing → setup    (cancel;  slide-down)
  //   processing → results  (complete; slide-up)
  //   results → setup       (back;    slide-down)

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-50 dark:bg-[#0f1117]">

      {/* ── Splash ─────────────────────────────────────────────────────────── */}
      <div
        className={`absolute inset-0 transition-all duration-500 ease-in ${
          screen !== "splash" && !transitioning
            ? "opacity-0 scale-[1.04] blur-md pointer-events-none"
            : "opacity-100 scale-100"
        }`}
      >
        <SplashScreen onDismiss={() => setSplashDone(true)} />
      </div>

      {/* ── Setup ──────────────────────────────────────────────────────────── */}
      <div
        className={`absolute inset-0 overflow-y-auto transition-all duration-[600ms] [transition-timing-function:cubic-bezier(0.25,0.46,0.45,0.94)] ${
          screen === "setup" || transitioning
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8 pointer-events-none"
        }`}
      >
        <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors duration-300">
          <SetupScreen
            onStart={handleStartCulling}
            themeToggle={<ThemeToggle />}
          />
        </div>
      </div>

      {/* ── Processing ─────────────────────────────────────────────────────── */}
      <div
        className={`absolute inset-0 overflow-y-auto transition-all duration-[600ms] [transition-timing-function:cubic-bezier(0.25,0.46,0.45,0.94)] ${
          screen === "processing"
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8 pointer-events-none"
        }`}
      >
        <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors duration-300">
          <ProcessingScreen
            settings={currentSettings}
            onCancel={handleCancelProcessing}
            onComplete={handleProcessingComplete}
          />
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <div
        className={`absolute inset-0 overflow-y-auto transition-all duration-[600ms] [transition-timing-function:cubic-bezier(0.25,0.46,0.45,0.94)] ${
          screen === "results"
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8 pointer-events-none"
        }`}
      >
        <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors duration-300">
          <ResultsScreen
            settings={currentSettings}
            onBack={handleBackToSetup}
          />
        </div>
      </div>

    </div>
  );
}

export default App;