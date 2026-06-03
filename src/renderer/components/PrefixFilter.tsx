import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  Filter,
  Loader2,
  X,
  CheckCircle2,
  Check,
  CaseSensitive,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PrefixFilterProps {
  /** Absolute path to the input folder — used for real-time match count IPC. */
  inputFolder: string;
  /** Currently applied prefix list (from AppSettings.prefixFilter). */
  value: string[];
  /** Called when the user clicks "Apply". */
  onChange: (prefixes: string[]) => void;
  /** Whether prefix matching ignores character case. */
  caseInsensitive: boolean;
  /** Called when the case-insensitive toggle changes. */
  onCaseInsensitiveChange: (value: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw text input into a clean, deduplicated prefix list.
 * Splits on commas and/or whitespace; strips empty tokens.
 */
function parseInput(raw: string): string[] {
  const tokens = raw.split(/[,\s]+/).filter(Boolean);
  return Array.from(new Set(tokens));
}

/** Format a prefix list back to a human-readable comma+space separated string. */
function formatPrefixes(prefixes: string[]): string {
  return prefixes.join(', ');
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PrefixFilter({
  inputFolder,
  value,
  onChange,
  caseInsensitive,
  onCaseInsensitiveChange,
}: PrefixFilterProps) {
  // ── Local state ────────────────────────────────────────────────────────────
  /** Raw textarea string — source of truth for editing. */
  const [rawInput, setRawInput] = useState<string>(formatPrefixes(value));
  /** Parsed, deduped draft — reflects rawInput but not yet "applied". */
  const [pending, setPending] = useState<string[]>(value);
  /** Expanded/collapsed state of the dropdown panel. */
  const [isOpen, setIsOpen] = useState(false);
  /** Number of matching files returned by IPC; null = not yet fetched. */
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Sync rawInput when parent value changes (e.g. settings load) ──────────
  useEffect(() => {
    setRawInput(formatPrefixes(value));
    setPending(value);
  }, [value.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Parse rawInput → pending whenever raw text changes ───────────────────
  useEffect(() => {
    setPending(parseInput(rawInput));
  }, [rawInput]);

  // ── Fetch real-time match count (debounced) ────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchMatchCount = useCallback(
    debounce(async (folder: string, prefixes: string[], ci: boolean) => {
      if (!folder) {
        setMatchCount(null);
        return;
      }
      setIsCountLoading(true);
      try {
        // IPC call — main process returns the count of matching filenames.
        // Gracefully degrades if the handler is not yet wired.
        const result = await (window as any).electronAPI?.scanFolderPrefixes?.(
          folder,
          prefixes,
          ci,
        ) as number | undefined;

        setMatchCount(typeof result === 'number' ? result : null);
      } catch {
        setMatchCount(null);
      } finally {
        setIsCountLoading(false);
      }
    }, 400),
    [],
  );

  useEffect(() => {
    fetchMatchCount(inputFolder, pending, caseInsensitive);
  }, [inputFolder, pending, caseInsensitive, fetchMatchCount]);

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRawChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRawInput(e.target.value);
  };

  const removeChip = (prefix: string) => {
    const next = pending.filter((p) => p !== prefix);
    setPending(next);
    setRawInput(formatPrefixes(next));
  };

  const apply = () => {
    onChange(pending);
    setIsOpen(false);
  };

  const clearAll = () => {
    setRawInput('');
    setPending([]);
  };

  const canOpen = !!inputFolder;

  // ── Derived display ───────────────────────────────────────────────────────
  const appliedCount  = value.length;
  const isAllFiles    = appliedCount === 0;

  const summaryText = (() => {
    if (!inputFolder) return 'Select a folder first';
    if (isAllFiles)   return 'All files (no filter)';
    return value.map((p) => p).join(' · ');
  })();

  // Match count badge label
  const matchLabel = (() => {
    if (!inputFolder) return null;
    if (pending.length === 0) return 'All files included';
    if (isCountLoading) return null;
    if (matchCount === null) return null;
    return `Matches: ${matchCount.toLocaleString()} file${matchCount !== 1 ? 's' : ''}`;
  })();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={dropdownRef} className="relative w-full">

      {/* ── Trigger button ── */}
      <button
        type="button"
        onClick={() => canOpen && setIsOpen((o) => !o)}
        disabled={!canOpen}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`
          w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left
          ${canOpen
            ? 'bg-white dark:bg-[#161b27] border-gray-200 dark:border-[#1e2535] hover:border-amber-400 dark:hover:border-amber-600 cursor-pointer'
            : 'bg-gray-50 dark:bg-[#0f1117] border-gray-200 dark:border-[#1e2535] cursor-not-allowed opacity-60'
          }
          ${isOpen ? 'border-amber-500 dark:border-amber-500 ring-2 ring-amber-500/20' : ''}
        `}
      >
        {/* Icon */}
        <div className="shrink-0">
          <Filter className="w-4 h-4 text-amber-500" />
        </div>

        {/* Summary */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
            Filename prefix filter
          </p>
          <p className="text-sm text-gray-900 dark:text-white font-mono truncate">
            {summaryText}
          </p>
        </div>

        {/* Chips count + chevron */}
        <div className="flex items-center gap-2 shrink-0">
          {!isAllFiles && (
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {appliedCount} prefix{appliedCount !== 1 ? 'es' : ''}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* ── Dropdown panel ── */}
      {isOpen && (
        <div
          className="
            absolute left-0 right-0 top-full mt-2 z-20
            bg-white dark:bg-[#161b27]
            border border-gray-200 dark:border-[#1e2535]
            rounded-xl shadow-xl shadow-black/10 dark:shadow-black/40
            overflow-hidden
          "
        >
          {/* ── Textarea ── */}
          <div className="p-4 border-b border-gray-100 dark:border-[#1e2535]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              Enter prefixes (comma or space separated)
            </label>
            <textarea
              value={rawInput}
              onChange={handleRawChange}
              rows={2}
              placeholder="IMG_, DSC_, _MG_"
              spellCheck={false}
              className="
                w-full resize-none rounded-lg border border-gray-200 dark:border-[#1e2535]
                bg-gray-50 dark:bg-[#0f1117]
                px-3 py-2 font-mono text-sm
                text-gray-900 dark:text-white
                placeholder-gray-400 dark:placeholder-gray-600
                focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500
                transition-colors
              "
            />
          </div>

          {/* ── Parsed prefix chips ── */}
          {pending.length > 0 && (
            <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-gray-100 dark:border-[#1e2535]">
              {pending.map((prefix) => (
                <span
                  key={prefix}
                  className="
                    inline-flex items-center gap-1 px-2.5 py-1 rounded-lg
                    bg-amber-50 dark:bg-amber-950/30
                    border border-amber-200 dark:border-amber-800/50
                    text-amber-800 dark:text-amber-300
                    font-mono text-xs font-semibold
                  "
                >
                  {prefix}
                  <button
                    type="button"
                    onClick={() => removeChip(prefix)}
                    aria-label={`Remove prefix ${prefix}`}
                    className="
                      ml-0.5 text-amber-400 dark:text-amber-600
                      hover:text-amber-700 dark:hover:text-amber-300
                      transition-colors rounded
                      focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500
                    "
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* ── Match count + case toggle ── */}
          <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100 dark:border-[#1e2535] bg-gray-50/50 dark:bg-[#0f1117]/50">
            {/* Match count */}
            <div className="flex-1 flex items-center gap-1.5 min-w-0">
              {isCountLoading ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
              ) : matchCount !== null && pending.length > 0 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : null}
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {isCountLoading
                  ? 'Counting…'
                  : matchLabel ?? (pending.length === 0
                    ? 'No filter — all files will be included'
                    : 'Count unavailable')}
              </span>
            </div>

            {/* Case-insensitive toggle */}
            <label className="flex items-center gap-2 shrink-0 cursor-pointer group select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={caseInsensitive}
                  onChange={(e) => onCaseInsensitiveChange(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`
                    w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                    ${caseInsensitive
                      ? 'bg-amber-500 border-amber-500'
                      : 'border-gray-300 dark:border-gray-600 group-hover:border-amber-400'}
                  `}
                >
                  {caseInsensitive && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
              </div>
              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                <CaseSensitive className="w-3.5 h-3.5" />
                Case insensitive
              </span>
            </label>
          </div>

          {/* ── Footer: Clear + Apply ── */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50/50 dark:bg-[#0f1117]/50">
            <button
              type="button"
              onClick={clearAll}
              disabled={pending.length === 0 && rawInput === ''}
              className="
                text-xs font-medium text-gray-500 dark:text-gray-400
                hover:text-gray-700 dark:hover:text-gray-300
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors px-2 py-0.5 rounded
                hover:bg-gray-100 dark:hover:bg-[#1a1f2e]
              "
            >
              Clear all
            </button>

            <button
              type="button"
              onClick={apply}
              className="
                flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                bg-amber-500 hover:bg-amber-600 active:bg-amber-700
                text-white transition-colors
              "
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
