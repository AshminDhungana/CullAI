import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import logoAnimation from "../assets/logo-animation.json";
import { SPLASH_DURATION_MS } from "../../shared/constants";

interface SplashScreenProps {
  onDismiss: () => void;
}

const colorFilters = [
  { keypath: "flesh.Group 1.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 1.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 2.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 3.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 4.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 5.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 6.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 7.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "lence.Group 8.Fill 1", color: { r: 0.506, g: 0.549, b: 0.973, a: 1 } },
  { keypath: "circle.Group 1.Fill 1", color: { r: 0.09, g: 0.09, b: 0.11, a: 1 } },
  { keypath: "circle 2.Group 1.Fill 1", color: { r: 0.31, g: 0.34, b: 0.6, a: 1 } },
  { keypath: "camera.Group 1.Fill 1", color: { r: 0.09, g: 0.09, b: 0.11, a: 1 } },
  { keypath: "camera.Group 2.Fill 1", color: { r: 0.09, g: 0.09, b: 0.11, a: 1 } },
  { keypath: "button.Group 1.Fill 1", color: { r: 0.31, g: 0.34, b: 0.6, a: 1 } },
];

export function SplashScreen({ onDismiss }: SplashScreenProps) {
  const [dismissing, setDismissing] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showTagline, setShowTagline] = useState(false);

  const handleDismiss = () => {
    if (dismissing) return;
    setDismissing(true);
  };

  useEffect(() => {
    const wordmark = setTimeout(() => setShowText(true), 300);
    const tagline = setTimeout(() => setShowTagline(true), 800);
    return () => {
      clearTimeout(wordmark);
      clearTimeout(tagline);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDismissing(true), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!dismissing) return;
    const timer = setTimeout(() => onDismiss(), 350);
    return () => clearTimeout(timer);
  }, [dismissing, onDismiss]);

  return (
    <div
      onClick={handleDismiss}
      className={`
        fixed inset-0 z-50
        flex items-center justify-center
        bg-white dark:bg-zinc-950 cursor-pointer
        transition-colors duration-300
        ${dismissing ? "animate-fade-out" : ""}
      `}
    >
      {/* Radial glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 rounded-full bg-amber-500/10 dark:bg-indigo-500/10 blur-3xl transition-colors" />
      </div>

      {/* Main content */}
      <div className="relative flex flex-col items-center gap-6">
        <Lottie
          animationData={logoAnimation}
          loop={false}
          autoplay={true}
          colorFilters={colorFilters}
          style={{ width: 160, height: 160 }}
        />

        <div
          className={`
            flex flex-col items-center gap-2
            transition-all duration-700 ease-out
            ${showText ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}
          `}
        >
          <span className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-zinc-100">
            Cull<span className="text-amber-500 dark:text-indigo-400">AI</span>
          </span>

          <p
            className={`
              text-xs tracking-widest uppercase text-gray-500 dark:text-zinc-500
              transition-all duration-700 ease-out
              ${showTagline ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
            `}
          >
            AI-powered photo culling
          </p>
        </div>
      </div>
    </div>
  );
}