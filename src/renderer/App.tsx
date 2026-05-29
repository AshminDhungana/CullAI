import { useEffect, useState } from "react";
import { SplashScreen } from "./components/SplashScreen";

// All app screens — extend as features are built out
type Screen = "splash" | "setup" | "processing" | "results";

async function preloadResources(): Promise<void> {
  // TODO: await electronStore.init()
  // TODO: await decryptApiKey()
  // Runs in parallel with splash timer; setup won't render until both are done
}

function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [preloadDone, setPreloadDone] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  // Kick off preload immediately on mount, parallel to splash timer
  useEffect(() => {
    preloadResources().finally(() => setPreloadDone(true));
  }, []);

  // Transition to setup only when both splash and preload are complete
  useEffect(() => {
    if (preloadDone && splashDone) {
      setScreen("setup");
    }
  }, [preloadDone, splashDone]);

  if (screen === "splash") {
    return (
      <SplashScreen onDismiss={() => setSplashDone(true)} />
    );
  }

  if (screen === "setup") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <h1 className="text-4xl font-bold">CullAI 🎯</h1>
      </div>
    );
  }

  // TODO: render processing and results screens
  return null;
}

export default App;