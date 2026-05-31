import React from "react";
import { GenrePreset, ScoringWeights } from "../../shared/types";
import { GENRE_PRESETS } from "../../shared/genre-presets";

// ─── Config ───────────────────────────────────────────────────────────────────

const GENRE_OPTIONS: { value: GenrePreset; label: string; hint: string }[] = [
  { value: "general",   label: "General",        hint: "All-purpose" },
  { value: "wedding",   label: "Wedding",         hint: "Moments & faces" },
  { value: "portrait",  label: "Portrait",        hint: "Face-forward" },
  { value: "sports",    label: "Sports / Action", hint: "Speed & sharpness" },
  { value: "landscape", label: "Landscape",       hint: "No face scoring" },
  { value: "street",    label: "Street",          hint: "Aesthetic-led" },
  { value: "event",     label: "Event",           hint: "People & energy" },
];

type WeightEntry = { key: keyof ScoringWeights; label: string; short: string };

const WEIGHT_KEYS: WeightEntry[] = [
  { key: "quality",     label: "Quality",      short: "Qual" },
  { key: "aesthetic",   label: "Aesthetic",    short: "Aes"  },
  { key: "composition", label: "Composition",  short: "Comp" },
  { key: "sharpness",   label: "Sharpness",    short: "Sharp"},
  { key: "exposure",    label: "Exposure",     short: "Exp"  },
  { key: "faceEyes",    label: "Face & Eyes",  short: "Face" },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  value: GenrePreset;
  onChange: (genre: GenrePreset) => void;
}

export default function GenrePresetSelector({ value, onChange }: Props) {
  const weights = GENRE_PRESETS[value];
  const selected = GENRE_OPTIONS.find((o) => o.value === value)!;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col gap-4 font-mono min-w-[320px] max-w-[480px]">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-zinc-700 pb-3">
        <span className="text-zinc-400 text-[11px] font-semibold tracking-widest uppercase">
          Genre Preset
        </span>
        <span className="text-zinc-500 text-[10px] tracking-wide">
          {selected.hint}
        </span>
      </div>

      {/* Select */}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as GenrePreset)}
          className="
            w-full appearance-none
            bg-zinc-800 border border-zinc-600 rounded-lg
            text-zinc-100 text-sm font-medium tracking-wide
            px-3 py-2.5 pr-9
            cursor-pointer
            focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500
            hover:border-zinc-500
            transition-colors duration-150
          "
        >
          {GENRE_OPTIONS.map(({ value: v, label }) => (
            <option key={v} value={v} className="bg-zinc-800 text-zinc-100">
              {label}
            </option>
          ))}
        </select>

        {/* Custom chevron */}
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">
          ▾
        </div>
      </div>

      {/* Weight preview — bar chart style */}
      <div className="flex flex-col gap-2">
        {WEIGHT_KEYS.map(({ key, label }) => {
          const pct = weights[key];
          const isZero = pct === 0;

          return (
            <div key={key} className="flex items-center gap-2">
              {/* Label */}
              <span
                className={`text-[10px] tracking-wide w-[76px] shrink-0 ${
                  isZero ? "text-zinc-600" : "text-zinc-400"
                }`}
              >
                {label}
              </span>

              {/* Bar track */}
              <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-700 to-amber-400 transition-[width] duration-300"
                  style={{ width: `${pct}%`, opacity: isZero ? 0 : 1 }}
                />
              </div>

              {/* Percentage */}
              <span
                className={`text-[10px] font-bold tracking-wide w-7 text-right ${
                  isZero ? "text-zinc-700" : "text-amber-400"
                }`}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Compact dot-separated summary */}
      <p className="text-zinc-600 text-[10px] tracking-wide border-t border-zinc-700 pt-3 m-0 leading-relaxed">
        {WEIGHT_KEYS.map(({ key, short }, i) => {
          const pct = weights[key];
          const isZero = pct === 0;
          return (
            <React.Fragment key={key}>
              {i > 0 && <span className="mx-1 text-zinc-700">·</span>}
              <span className={isZero ? "text-zinc-700" : "text-zinc-500"}>
                {short}{" "}
                <span className={isZero ? "text-zinc-700" : "text-amber-600"}>
                  {pct}%
                </span>
              </span>
            </React.Fragment>
          );
        })}
      </p>
    </div>
  );
}