import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, FileImage, Loader2, X, Check } from 'lucide-react';

// ---------------------------------------------------------------------------
// Supported image extensions (mirrors image-processor.ts RAW + raster list)
// ---------------------------------------------------------------------------
const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.gif', '.avif', '.tiff', '.tif',
  // RAW
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2',
  '.raf', '.dng', '.orf', '.rw2', '.pef', '.3fr',
]);

// Display label — strip leading dot and uppercase
const extLabel = (ext: string) => ext.replace(/^\./, '').toUpperCase();

// Colour coding: RAW vs raster
const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2',
  '.raf', '.dng', '.orf', '.rw2', '.pef', '.3fr',
]);

function isRaw(ext: string): boolean {
  return RAW_EXTENSIONS.has(ext.toLowerCase());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ExtensionFilterProps {
  /** Absolute path to the input folder; triggers a rescan when it changes. */
  inputFolder: string;
  /** Currently applied extension filter (from AppSettings). Empty = all. */
  value: string[];
  /** Called with the new filter after the user clicks "Apply". */
  onChange: (extensions: string[]) => void;
}

interface ExtensionEntry {
  ext: string;    // e.g. '.cr3'
  count: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ExtensionFilter({
  inputFolder,
  value,
  onChange,
}: ExtensionFilterProps) {
  const [entries, setEntries]       = useState<ExtensionEntry[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [isOpen, setIsOpen]         = useState(false);
  // pending = local draft before "Apply"
  const [pending, setPending]       = useState<Set<string>>(new Set());
  const [hasScanned, setHasScanned] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Scan folder for extensions ────────────────────────────────────────────
  const scanExtensions = useCallback(async (folder: string) => {
    if (!folder) return;
    setIsLoading(true);
    setHasScanned(false);

    try {
      // IPC call — main process returns Record<string, number>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (window as any).electronAPI?.scanFolderExtensions?.(folder) as
        Record<string, number> | undefined;

      if (result && typeof result === 'object') {
        const found: ExtensionEntry[] = Object.entries(result)
          .filter(([ext]) => SUPPORTED_EXTENSIONS.has(ext.toLowerCase()))
          .map(([ext, count]) => ({ ext: ext.toLowerCase(), count }))
          .sort((a, b) => b.count - a.count); // highest count first

        setEntries(found);

        // Reset: select all found extensions (spec: "reset filter to all supported by default")
        const allExts = new Set(found.map((e) => e.ext));
        setPending(allExts);
        // Propagate immediately so AppSettings reflects "all selected"
        onChange(Array.from(allExts));
      } else {
        // IPC not wired yet — show empty gracefully
        setEntries([]);
        setPending(new Set());
      }
    } catch {
      setEntries([]);
      setPending(new Set());
    } finally {
      setIsLoading(false);
      setHasScanned(true);
    }
  }, [onChange]);

  // Rescan whenever the input folder changes
  useEffect(() => {
    if (inputFolder) {
      scanExtensions(inputFolder);
    } else {
      setEntries([]);
      setPending(new Set());
      setHasScanned(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputFolder]);

  // Sync pending from parent value on first mount (restore persisted selection)
  useEffect(() => {
    if (value && value.length > 0 && !hasScanned) {
      setPending(new Set(value));
    }
  }, [value, hasScanned]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleExt = (ext: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext);
      else next.add(ext);
      return next;
    });
  };

  const selectAll = () => setPending(new Set(entries.map((e) => e.ext)));
  const clearAll  = () => setPending(new Set());

  const apply = () => {
    onChange(Array.from(pending));
    setIsOpen(false);
  };

  // ── Derived display values ────────────────────────────────────────────────
  const totalFiles   = entries.reduce((s, e) => s + e.count, 0);
  const selectedExts = Array.from(pending);
  const allSelected  = entries.length > 0 && pending.size === entries.length;
  const noneSelected = pending.size === 0;

  // Summary pill text
  const summaryText = (() => {
    if (!inputFolder || !hasScanned) return 'Select a folder first';
    if (isLoading)                   return 'Scanning…';
    if (entries.length === 0)        return 'No images found';
    if (allSelected)                 return 'All types';
    if (noneSelected)                return 'None selected';
    return selectedExts.map(extLabel).join(' · ');
  })();

  const canOpen = !isLoading && hasScanned && entries.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={dropdownRef} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => canOpen && setIsOpen((o) => !o)}
        disabled={!canOpen}
        aria-haspopup="listbox"
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
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          ) : (
            <FileImage className="w-4 h-4 text-amber-500" />
          )}
        </div>

        {/* Summary */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
            File types
          </p>
          <p className="text-sm text-gray-900 dark:text-white font-mono truncate">
            {summaryText}
          </p>
        </div>

        {/* Count badge + chevron */}
        {hasScanned && entries.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {pending.size}/{entries.length} types
            </span>
            <ChevronDown
              className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label="File type filter"
          className="
            absolute left-0 right-0 top-full mt-2 z-20
            bg-white dark:bg-[#161b27]
            border border-gray-200 dark:border-[#1e2535]
            rounded-xl shadow-xl shadow-black/10 dark:shadow-black/40
            overflow-hidden
          "
        >
          {/* Bulk actions bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-[#1e2535] bg-gray-50 dark:bg-[#0f1117]">
            <span className="text-xs text-gray-400 dark:text-gray-500 flex-1">
              {totalFiles.toLocaleString()} files total
            </span>
            <button
              type="button"
              onClick={selectAll}
              disabled={allSelected}
              className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2 py-0.5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              Select all
            </button>
            <span className="text-gray-300 dark:text-gray-700 select-none">|</span>
            <button
              type="button"
              onClick={clearAll}
              disabled={noneSelected}
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#1a1f2e]"
            >
              Clear all
            </button>
          </div>

          {/* Extension list */}
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {entries.map(({ ext, count }) => {
              const checked  = pending.has(ext);
              const raw      = isRaw(ext);
              const label    = extLabel(ext);

              return (
                <button
                  key={ext}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggleExt(ext)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                    hover:bg-gray-50 dark:hover:bg-[#1a1f2e]
                    ${checked ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}
                  `}
                >
                  {/* Checkbox */}
                  <div
                    className={`
                      w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                      ${checked
                        ? 'bg-amber-500 border-amber-500'
                        : 'border-gray-300 dark:border-gray-600'
                      }
                    `}
                  >
                    {checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>

                  {/* Extension badge */}
                  <span
                    className={`
                      text-xs font-bold font-mono tracking-wider px-1.5 py-0.5 rounded
                      ${raw
                        ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40'
                        : 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30'
                      }
                      ${!checked ? 'opacity-50' : ''}
                    `}
                  >
                    {label}
                  </span>

                  {/* RAW label */}
                  {raw && (
                    <span className={`text-[10px] text-amber-500 dark:text-amber-600 font-medium ${!checked ? 'opacity-50' : ''}`}>
                      RAW
                    </span>
                  )}

                  {/* Spacer */}
                  <span className="flex-1" />

                  {/* File count */}
                  <span className={`text-xs tabular-nums text-right ${checked ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer: Apply */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-[#1e2535] bg-gray-50/50 dark:bg-[#0f1117]/50">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {noneSelected
                ? 'All files blocked — select at least one'
                : allSelected
                ? 'Processing all file types'
                : `${pending.size} of ${entries.length} type${entries.length !== 1 ? 's' : ''} selected`
              }
            </p>
            <button
              type="button"
              onClick={apply}
              disabled={noneSelected}
              className="
                flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                bg-amber-500 hover:bg-amber-600 active:bg-amber-700
                disabled:bg-gray-200 dark:disabled:bg-gray-700
                disabled:text-gray-400 dark:disabled:text-gray-500
                text-white disabled:cursor-not-allowed transition-colors
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