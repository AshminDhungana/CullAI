import React from "react";
import { ScoringWeights } from "../../shared/types";

// ─── Slider config ────────────────────────────────────────────────────────────

type WeightKey = keyof ScoringWeights;

const SLIDER_KEYS: { key: WeightKey; label: string; icon: string }[] = [
  { key: "quality",     label: "Quality",     icon: "◈" },
  { key: "aesthetic",   label: "Aesthetic",   icon: "✦" },
  { key: "composition", label: "Composition", icon: "⊞" },
  { key: "sharpness",   label: "Sharpness",   icon: "◎" },
  { key: "exposure",    label: "Exposure",    icon: "◑" },
  { key: "faceEyes",    label: "Face & Eyes", icon: "◉" },
];

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Pure normalization function. Pins `changedKey` to `newValue`, then
 * redistributes the remainder (100 - newValue) proportionally across the
 * other 5 keys. Only keys with weight > 0 participate in redistribution;
 * if all others are 0, the remainder is split equally. After rounding, any
 * drift is corrected on the largest "other" key so the total is exactly 100.
 */
export function normalize(
  weights: ScoringWeights,
  changedKey: WeightKey,
  newValue: number
): ScoringWeights {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  const remainder = 100 - clamped;

  const otherKeys = SLIDER_KEYS.map((s) => s.key).filter((k) => k !== changedKey);

  // Keys that can receive weight — those currently > 0
  const nonZeroOthers = otherKeys.filter((k) => weights[k] > 0);
  const distributionKeys = nonZeroOthers.length > 0 ? nonZeroOthers : otherKeys;

  const currentSum = distributionKeys.reduce((s, k) => s + weights[k], 0);

  // Compute raw proportional shares
  const raw: Partial<Record<WeightKey, number>> = {};
  if (currentSum === 0 || nonZeroOthers.length === 0) {
    const share = remainder / otherKeys.length;
    otherKeys.forEach((k) => (raw[k] = share));
  } else {
    otherKeys.forEach((k) => {
      raw[k] = distributionKeys.includes(k)
        ? (weights[k] / currentSum) * remainder
        : 0;
    });
  }

  // Round all values
  const rounded: Partial<Record<WeightKey, number>> = {};
  otherKeys.forEach((k) => (rounded[k] = Math.round(raw[k]!)));

  // Fix rounding drift on the largest other key
  const roundedSum = otherKeys.reduce((s, k) => s + rounded[k]!, 0);
  const drift = remainder - roundedSum;
  if (drift !== 0 && otherKeys.length > 0) {
    const largestKey = otherKeys.reduce((best, k) =>
      rounded[k]! > rounded[best]! ? k : best
    );
    rounded[largestKey] = Math.max(0, rounded[largestKey]! + drift);
  }

  return { ...weights, [changedKey]: clamped, ...rounded } as ScoringWeights;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  weights: ScoringWeights;
  onChange: (weights: ScoringWeights) => void;
}

export default function ScoringWeightsPanel({ weights, onChange }: Props) {
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  const totalOk = total === 100;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col gap-4 font-mono min-w-[320px] max-w-[480px]">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-zinc-700 pb-3">
        <span className="text-zinc-400 text-[11px] font-semibold tracking-widest uppercase">
          Scoring Weights
        </span>
        <span
          className={`text-[11px] font-bold tracking-wide rounded px-2 py-0.5 ${
            totalOk
              ? "text-amber-400 bg-amber-950"
              : "text-red-400 bg-red-950"
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

          return (
            <div key={key} className="flex flex-col gap-1.5">

              {/* Label row */}
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500 text-xs w-3.5 shrink-0 leading-none">
                  {icon}
                </span>
                <span className="text-zinc-200 text-xs font-medium flex-1 tracking-wide">
                  {label}
                </span>
                <span
                  className={`text-xs font-bold min-w-[36px] text-right tracking-wide transition-colors duration-150 ${
                    isZero ? "text-zinc-600" : "text-amber-400"
                  }`}
                >
                  {value}%
                </span>
              </div>

              {/* Custom track + native input overlay */}
              <div className="relative h-1 rounded-full bg-zinc-700">
                {/* Amber fill */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-700 to-amber-400 transition-[width] duration-75 pointer-events-none"
                  style={{ width: `${value}%`, opacity: isZero ? 0 : 1 }}
                />
                {/* Native range — invisible but interactive, sits on top */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  aria-label={`${label} weight`}
                  onChange={(e) =>
                    onChange(normalize(weights, key, parseInt(e.target.value, 10)))
                  }
                  className="
                    absolute inset-0 w-full h-6 -top-2.5
                    opacity-0 cursor-pointer z-10
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-3.5
                    [&::-webkit-slider-thumb]:h-3.5
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-amber-400
                  "
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="text-zinc-600 text-[10px] tracking-wide border-t border-zinc-700 pt-3 m-0">
        Weights auto-normalize to 100% when any slider changes.
      </p>
    </div>
  );
}