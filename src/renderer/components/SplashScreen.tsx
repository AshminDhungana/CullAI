import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import logoAnimation from "../assets/logo-animation.json";
import { SPLASH_DURATION_MS } from "../../shared/constants";

interface SplashScreenProps {
  onDismiss: () => void;
}

export function SplashScreen({ onDismiss }: SplashScreenProps) {
  const [dismissing, setDismissing] = useState(false);
  const [stage, setStage] = useState<
    "logo" | "text" | "tagline" | "ready"
  >("logo");

  useEffect(() => {
    const t1 = setTimeout(() => setStage("text"), 300);
    const t2 = setTimeout(() => setStage("tagline"), 800);
    const t3 = setTimeout(() => setStage("ready"), 1400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDismissing(true);
    }, SPLASH_DURATION_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!dismissing) return;

    const timer = setTimeout(() => {
      onDismiss();
    }, 700);

    return () => clearTimeout(timer);
  }, [dismissing, onDismiss]);

  return (
    <div
      className={`
        fixed inset-0 z-50
        flex items-center justify-center
        overflow-hidden
        bg-black
        transition-all duration-700 ease-out
        ${
          dismissing
            ? "opacity-0 scale-110 blur-sm"
            : "opacity-100 scale-100 blur-0"
        }
      `}
    >
      {/* Content */}
      <div className="relative flex flex-col items-center gap-6">
        {/* Logo */}
        <div
          className={`
            transition-all duration-1000 ease-out
            ${
              stage === "logo"
                ? "scale-90 opacity-80"
                : "scale-100 opacity-100"
            }
          `}
        >
          <Lottie
            animationData={logoAnimation}
            loop={false}
            autoplay
            style={{
              width: 160,
              height: 160,
            }}
          />
        </div>

        {/* Brand */}
        <div className="flex flex-col items-center gap-2">
          <span
            className={`
              text-4xl font-semibold tracking-tight
              text-white
              transition-all duration-1000 ease-out
              ${
                stage === "text" ||
                stage === "tagline" ||
                stage === "ready"
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }
            `}
          >
            Cull
            <span className="text-indigo-400">
              AI
            </span>
          </span>

          <p
            className={`
              text-xs tracking-[0.25em] uppercase
              text-zinc-500
              transition-all duration-1000 ease-out
              ${
                stage === "tagline" ||
                stage === "ready"
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-3"
              }
            `}
          >
            Intelligent Photo Selection
          </p>

          <div
            className={`
              flex flex-col items-center mt-3 transition-all duration-700
              ${
                stage === "ready"
                  ? "opacity-100"
                  : "opacity-0"
              }
            `}
          >
            <p className="text-[11px] tracking-wide text-zinc-600 mb-3">
              Initializing AI Engine...
            </p>

            <div className="w-48 h-[2px] bg-zinc-900 rounded-full overflow-hidden">
              <div className="loading-bar h-full w-1/3 bg-indigo-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}