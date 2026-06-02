import React, { useState } from "react";
import { ScoringWeights } from "../../shared/types";
import { Lock, Unlock } from "lucide-react";

type WeightKey = keyof ScoringWeights;

const SLIDER_KEYS: { key: WeightKey; label: string; icon: string }[] = [
  { key: "quality",     label: "Quality",     icon: "◈" },
  { key: "aesthetic",   label: "Aesthetic",   icon: "✦" },
  { key: "composition", label: "Composition", icon: "⊞" },
  { key: "sharpness",   label: "Sharpness",   icon: "◎" },
  { key: "exposure",    label: "Exposure",    icon: "◑" },
  { key: "faceEyes",    label: "Face & Eyes", icon: "◉" },
];

export function normalize(
  weights: ScoringWeights,
  changedKey: WeightKey,
  newValue: number,
  lockedKeys: Set<WeightKey>
): ScoringWeights {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  const remainder = 100 - clamped;

  const otherKeys = SLIDER_KEYS.map((s) => s.key).filter((k) => k !== changedKey);
  const unlockedOthers = otherKeys.filter((k) => !lockedKeys.has(k));

  // If changed key is locked, we need to unlock it first
  const effectiveChangedKey = changedKey;
  const distributionKeys = unlockedOthers.length > 0 ? unlockedOthers : otherKeys;

  const currentSum = distributionKeys.reduce((s, k) => s + weights[k], 0);

  const raw: Partial<Record<WeightKey, number>> = {};
  if (currentSum === 0 || unlockedOthers.length === 0) {
    const share = remainder / distributionKeys.length;
    distributionKeys.forEach((k) => (raw[k] = share));
  } else {
    distributionKeys.forEach((k) => {
      raw[k] = (weights[k] / currentSum) * remainder;
    });
    otherKeys.filter((k) => lockedKeys.has(k)).forEach((k) => {
      raw[k] = weights[k];
    });
  }

  const rounded: Partial<Record<WeightKey, number>> = {};
  otherKeys.forEach((k) => (rounded[k] = Math.round(raw[k]!)));

  const roundedSum = otherKeys.reduce((s, k) => s + rounded[k]!, 0);
  const drift = remainder - roundedSum;
  if (drift !== 0 && distributionKeys.length > 0) {
    const largestKey = distributionKeys.reduce((best, k) =>
      (rounded[k] || 0) > (rounded[best] || 0) ? k : best
    );
    rounded[largestKey] = Math.max(0, (rounded[largestKey] || 0) + drift);
  }

  return { ...weights, [effectiveChangedKey]: clamped, ...rounded } as ScoringWeights;
}

interface Props {
  weights: ScoringWeights;
  onChange: (weights: ScoringWeights) => void;
}

export default function ScoringWeightsPanel({ weights, onChange }: Props) {
  const [lockedKeys, setLockedKeys] = useState<Set<WeightKey>>(new Set());
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  const totalOk = total === 100;

  const toggleLock = (key: WeightKey) => {
    setLockedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleChange = (key: WeightKey, value: number) => {
    onChange(normalize(weights, key, value, lockedKeys));
  };

  return (
    <div className="bg-white dark:bg-[#161b27] border border-gray-200 dark:border-[#1e2535] rounded-xl p-5 flex flex-col gap-4 font-mono min-w-[320px] max-w-[480px] transition-colors shadow-sm">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-gray-200 dark:border-[#1e2535] pb-3 transition-colors">
        <span className="text-gray-500 dark:text-gray-400 text-[11px] font-semibold tracking-widest uppercase">
          Scoring Weights
        </span>
        <span
          className={`text-[11px] font-bold tracking-wide rounded px-2 py-0.5 ${
            totalOk
              ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30"
              : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30"
          }`}
        >
          {total}%
        </span>
      </div>

      {/* Sliders */}
      <div className="flex flex-col gap-3.5">
        {SLIDER_KEYS.map(({ key, label, icon }) => {
          const value = weights[key];
          const isZero = value === 0;
          const isLocked = lockedKeys.has(key);

          return (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 dark:text-zinc-500 text-xs w-3.5 shrink-0 leading-none">
                  {icon}
                </span>
                <span className="text-gray-700 dark:text-zinc-200 text-xs font-medium flex-1 tracking-wide">
                  {label}
                </span>
                <button
                  type="button"
                  onClick={() => toggleLock(key)}
                  className={`p-0.5 rounded transition-colors ${
                    isLocked
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-gray-300 dark:text-zinc-700 hover:text-gray-400 dark:hover:text-zinc-500"
                  }`}
                  title={isLocked ? "Unlock weight" : "Lock weight"}
                >
                  {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </button>
                <span
                  className={`text-xs font-bold min-w-[36px] text-right tracking-wide transition-colors duration-150 ${
                    isZero ? "text-gray-300 dark:text-zinc-600" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {value}%
                </span>
              </div>

              {/* Custom accessible slider */}
              <div className="relative h-5 flex items-center">
                {/* Track background */}
                <div className="absolute w-full h-1 rounded-full bg-gray-200 dark:bg-zinc-700 transition-colors" />
                {/* Fill */}
                <div
                  className="absolute h-1 rounded-full bg-gradient-to-r from-amber-500 to-amber-300 dark:from-amber-700 dark:to-amber-400 transition-[width] duration-75"
                  style={{ width: `${value}%`, opacity: isZero ? 0 : 1 }}
                />
                {/* Thumb */}
                <div
                  className="absolute w-4 h-4 rounded-full bg-amber-500 shadow-md shadow-amber-500/30 transition-all duration-75 pointer-events-none z-10"
                  style={{
                    left: `calc(${value}% - 8px)`,
                    opacity: isZero ? 0.5 : 1,
                    transform: isLocked ? 'scale(0.9)' : 'scale(1)',
                  }}
                />
                {/* Native range input */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  aria-label={`${label} weight`}
                  aria-valuenow={value}
                  aria-valuetext={`${value} percent`}
                  disabled={isLocked}
                  onChange={(e) => handleChange(key, parseInt(e.target.value, 10))}
                  className="
                    absolute inset-0 w-full h-full
                    opacity-0 cursor-pointer z-20
                    disabled:cursor-not-allowed
                  "
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-gray-400 dark:text-zinc-600 text-[10px] tracking-wide border-t border-gray-200 dark:border-[#1e2535] pt-3 m-0 transition-colors">
        Weights auto-normalize to 100% when any slider changes. Lock weights to exclude from redistribution.
      </p>
    </div>
  );
}