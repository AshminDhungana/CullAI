import React from "react";
import { GenrePreset, ScoringWeights } from "../../shared/types";
import { GENRE_PRESETS } from "../../shared/genre-presets";

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

interface Props {
  value: GenrePreset;
  onChange: (genre: GenrePreset) => void;
}

export default function GenrePresetSelector({ value, onChange }: Props) {
  const weights = GENRE_PRESETS[value];
  const selected = GENRE_OPTIONS.find((o) => o.value === value)!;

  return (
    <div className="bg-white dark:bg-[#161b27] border border-gray-200 dark:border-[#1e2535] rounded-xl p-5 flex flex-col gap-4 font-mono min-w-[320px] max-w-[480px] transition-colors shadow-sm">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-gray-200 dark:border-[#1e2535] pb-3 transition-colors">
        <span className="text-gray-500 dark:text-gray-400 text-[11px] font-semibold tracking-widest uppercase">
          Genre Preset
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-[10px] tracking-wide">
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
            bg-gray-50 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg
            text-gray-900 dark:text-zinc-100 text-sm font-medium tracking-wide
            px-3 py-2.5 pr-9
            cursor-pointer
            focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500
            hover:border-gray-400 dark:hover:border-gray-600
            transition-colors duration-150
          "
        >
          {GENRE_OPTIONS.map(({ value: v, label }) => (
            <option key={v} value={v} className="bg-white dark:bg-[#0f1117] text-gray-900 dark:text-zinc-100">
              {label}
            </option>
          ))}
        </select>

        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-xs">
          ▾
        </div>
      </div>

      {/* Weight preview */}
      <div className="flex flex-col gap-2">
        {WEIGHT_KEYS.map(({ key, label }) => {
          const pct = weights[key];
          const isZero = pct === 0;

          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className={`text-[10px] tracking-wide w-[76px] shrink-0 ${
                  isZero ? "text-gray-300 dark:text-zinc-600" : "text-gray-500 dark:text-zinc-400"
                }`}
              >
                {label}
              </span>

              <div className="flex-1 h-1 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden transition-colors">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 dark:from-amber-700 dark:to-amber-400 transition-[width] duration-300"
                  style={{ width: `${pct}%`, opacity: isZero ? 0 : 1 }}
                />
              </div>

              <span
                className={`text-[10px] font-bold tracking-wide w-7 text-right ${
                  isZero ? "text-gray-300 dark:text-zinc-700" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Compact summary */}
      <p className="text-gray-400 dark:text-zinc-600 text-[10px] tracking-wide border-t border-gray-200 dark:border-[#1e2535] pt-3 m-0 leading-relaxed transition-colors">
        {WEIGHT_KEYS.map(({ key, short }, i) => {
          const pct = weights[key];
          const isZero = pct === 0;
          return (
            <React.Fragment key={key}>
              {i > 0 && <span className="mx-1 text-gray-300 dark:text-gray-700">·</span>}
              <span className={isZero ? "text-gray-300 dark:text-zinc-700" : "text-gray-500 dark:text-zinc-500"}>
                {short}{" "}
                <span className={isZero ? "text-gray-300 dark:text-zinc-700" : "text-amber-600 dark:text-amber-600"}>
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