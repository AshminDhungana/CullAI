import { useEffect, useState } from "react";
import { SplashScreen } from "./components/SplashScreen";
import SetupScreen from "./screens/Setup";
import type { AppSettings } from "../shared/types";
import { useTheme } from "./hooks/useTheme";
import { Sun, Moon } from "lucide-react";

type Screen = "splash" | "setup" | "processing" | "results";

async function preloadResources(): Promise<void> {
  // TODO: await electronStore.init()
  // TODO: await decryptApiKey()
  return Promise.resolve();
}

function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [preloadDone, setPreloadDone] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const { toggle, isDark } = useTheme();

  useEffect(() => {
    preloadResources().finally(() => setPreloadDone(true));
  }, []);

  useEffect(() => {
    if (preloadDone && splashDone) {
      setScreen("setup");
    }
  }, [preloadDone, splashDone]);

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

  if (screen === "splash") {
    return <SplashScreen onDismiss={() => setSplashDone(true)} />;
  }

  if (screen === "setup") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors duration-300">
        <SetupScreen onStart={handleStartCulling} themeToggle={<ThemeToggle />} />
      </div>
    );
  }

  if (screen === "processing") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors duration-300">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-8 shadow-xl text-center max-w-md">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Processing…</h1>
          <p className="text-gray-500 dark:text-gray-400">The full pipeline is coming in Phase 10</p>
        </div>
      </div>
    );
  }

  if (screen === "results") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors duration-300">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-8 shadow-xl text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Results</h1>
          <p className="text-gray-500 dark:text-gray-400">The results screen will be implemented in Phase 12</p>
        </div>
      </div>
    );
  }

  return null;
}

export default App;