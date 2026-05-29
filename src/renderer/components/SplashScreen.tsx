import { useEffect, useState } from "react";
import { SPLASH_DURATION_MS } from "../../shared/constants";

interface SplashScreenProps {
  onDismiss: () => void;
}

export function SplashScreen({ onDismiss }: SplashScreenProps) {
  const [dismissing, setDismissing] = useState(false);

  const handleDismiss = () => {
    if (dismissing) return;
    setDismissing(true);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDismissing(true);
    }, SPLASH_DURATION_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!dismissing) return;
    // Wait for fade-out animation to complete before calling onDismiss
    const timer = setTimeout(() => {
      onDismiss();
    }, 350);
    return () => clearTimeout(timer);
  }, [dismissing, onDismiss]);

  return (
    <div
      onClick={handleDismiss}
      className={`
        fixed inset-0 z-50
        flex items-center justify-center
        bg-zinc-950 cursor-pointer
        transition-opacity duration-300 ease-in
        ${dismissing ? "animate-fade-out" : ""}
      `}
    >
      {/* Subtle radial glow behind logo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      {/* Main content */}
      <div className="relative flex flex-col items-center gap-5 animate-fade-slide-up">
        {/* Logo mark */}
        <div className="flex items-center gap-3">
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-indigo-400"
          >
            {/* Aperture-style icon representing photo culling */}
            <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
            <circle cx="24" cy="24" r="8" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
            <line x1="24" y1="2" x2="24" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="24" y1="32" x2="24" y2="46" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="2" y1="24" x2="16" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="32" y1="24" x2="46" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="6.1" y1="6.1" x2="15.4" y2="15.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="32.6" y1="32.6" x2="41.9" y2="41.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="41.9" y1="6.1" x2="32.6" y2="15.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="15.4" y1="32.6" x2="6.1" y2="41.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <span className="text-4xl font-semibold tracking-tight text-zinc-100">
            Cull<span className="text-indigo-400">AI</span>
          </span>
        </div>

        {/* Tagline */}
        <p className="text-sm tracking-widest uppercase text-zinc-500 animate-pulse">
          AI-powered photo culling
        </p>
      </div>
    </div>
  );
}