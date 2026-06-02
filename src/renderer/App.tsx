import { useEffect, useState } from "react";
import { SplashScreen } from "./components/SplashScreen";
import SetupScreen from "./screens/Setup";
import type { AppSettings } from "../shared/types";
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

  const handleStartCulling = (settings: AppSettings) => {
    console.log("Starting culling with settings:", settings);
    setScreen("processing");
  };

  const ThemeToggle = () => (
    <button
      onClick={toggle}
      className="p-2 rounded-lg bg-gray-100 dark:bg-[#1a1f2e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#252b3b] transition border border-gray-200 dark:border-[#1e2535]"
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );

  // Always use the two‑layer layout, no remounting
  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Splash Layer */}
      <div
        className={`absolute inset-0 transition-all duration-500 ease-in ${
          screen !== "splash" && !transitioning
            ? "opacity-0 scale-[1.04] blur-md pointer-events-none"
            : "opacity-100 scale-100"
        }`}
      >
        <SplashScreen onDismiss={() => setSplashDone(true)} />
      </div>

      {/* Setup Layer */}
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

      {/* Optional Processing Layer – add later if needed */}
    </div>
  );
}

export default App;