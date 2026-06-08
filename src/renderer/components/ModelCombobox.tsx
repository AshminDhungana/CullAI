/**
 * ModelCombobox.tsx
 *
 * A hybrid text-input + dropdown for selecting an AI model.
 *
 * Behaviour:
 *  - Always editable: the user can type any model name freely (custom IDs, etc.)
 *  - "Fetch models" button calls window.electronAPI.fetchModels() from the main
 *    process, which hits each provider's official model-listing endpoint and
 *    returns the cleaned list.
 *  - Auto-fetch: fires automatically once after an API key is saved (parent
 *    calls triggerFetch() via the forwarded ref) so the user sees options the
 *    moment their key is accepted — no extra click required.
 *  - Manual re-fetch: the refresh button in the combobox header lets users
 *    pull a fresh list at any time (e.g. after pulling a new Ollama model).
 *  - Dropdown renders below the input, scrollable, keyboard-navigable
 *    (↑ / ↓ to move, Enter to select, Escape to close).
 *  - Clicking a suggestion populates the input; the input remains editable so
 *    the user can still refine or type a fully custom string.
 *  - Soft error states (inline amber notice) — never blocks the user from
 *    proceeding with a manually typed model name.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  X,
} from 'lucide-react';
import type { AIProvider } from '../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchModelsResult {
  models: string[];
  error: string | null;
}

interface ModelComboboxProps {
  /** Controlled value — the current model string. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Which provider is selected (drives the fetch endpoint). */
  provider: AIProvider;
  /**
   * Ollama / Custom base URL — needed so the main-process handler
   * can reach the right host for non-cloud providers.
   */
  baseUrl?: string;
  /** Whether a key is already stored for this provider (used to show auto-fetch
   *  hint for cloud providers; ignored for Ollama which needs no key). */
  hasStoredKey?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
}

/** Handle exposed via forwardRef so Setup.tsx can call triggerFetch() after
 *  a key is successfully saved. */
export interface ModelComboboxHandle {
  triggerFetch: () => void;
}

// ---------------------------------------------------------------------------
// Provider-specific display labels shown in the fetch button tooltip / hint
// ---------------------------------------------------------------------------
const PROVIDER_SOURCE_LABEL: Record<AIProvider, string> = {
  claude: 'Anthropic API',
  openai: 'OpenAI API',
  gemini: 'Gemini API',
  ollama: 'local Ollama',
  custom: 'custom endpoint',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ModelCombobox = forwardRef<ModelComboboxHandle, ModelComboboxProps>(
  (
    {
      value,
      onChange,
      onBlur,
      provider,
      baseUrl,
      hasStoredKey = false,
      disabled = false,
      error,
      className = '',
    },
    ref,
  ) => {
    // ── State ────────────────────────────────────────────────────────────────
    const [fetchState, setFetchState] = useState<
      'idle' | 'loading' | 'success' | 'error'
    >('idle');
    const [fetchError, setFetchError] = useState<string>('');
    const [models, setModels] = useState<string[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    // Filter suggestions: show all fetched models, but move the current value
    // to top if it matches, so the user can see "this is what I typed and it
    // exists in the list"
    const filteredModels = React.useMemo(() => {
      if (!models.length) return [];
      const q = value.toLowerCase().trim();
      if (!q) return models;
      const exact = models.filter((m) => m.toLowerCase() === q);
      const prefix = models.filter(
        (m) => m.toLowerCase().startsWith(q) && m.toLowerCase() !== q,
      );
      const rest = models.filter(
        (m) => !m.toLowerCase().startsWith(q) && m.toLowerCase().includes(q),
      );
      // Always show all; sorted by relevance to current input
      return [...exact, ...prefix, ...rest];
    }, [models, value]);

    // ── Refs ─────────────────────────────────────────────────────────────────
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ── Keyboard navigation ───────────────────────────────────────────────────
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen || !filteredModels.length) {
          if (e.key === 'ArrowDown' && models.length) {
            setIsOpen(true);
            setHighlightedIndex(0);
          }
          return;
        }

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setHighlightedIndex((i) =>
              i < filteredModels.length - 1 ? i + 1 : 0,
            );
            break;
          case 'ArrowUp':
            e.preventDefault();
            setHighlightedIndex((i) =>
              i > 0 ? i - 1 : filteredModels.length - 1,
            );
            break;
          case 'Enter':
            e.preventDefault();
            if (highlightedIndex >= 0 && filteredModels[highlightedIndex]) {
              selectModel(filteredModels[highlightedIndex]);
            }
            break;
          case 'Escape':
            setIsOpen(false);
            setHighlightedIndex(-1);
            break;
        }
      },
      [isOpen, filteredModels, highlightedIndex],
    );

    // Scroll highlighted item into view
    useEffect(() => {
      if (highlightedIndex >= 0 && listRef.current) {
        const item = listRef.current.children[highlightedIndex] as HTMLElement;
        item?.scrollIntoView({ block: 'nearest' });
      }
    }, [highlightedIndex]);

    // ── Close on outside click ────────────────────────────────────────────────
    useEffect(() => {
      const handleOutside = (e: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setIsOpen(false);
        }
      };
      document.addEventListener('mousedown', handleOutside);
      return () => document.removeEventListener('mousedown', handleOutside);
    }, []);

    // ── Reset fetched list when provider changes ──────────────────────────────
    useEffect(() => {
      setModels([]);
      setFetchState('idle');
      setFetchError('');
      setIsOpen(false);
      abortRef.current?.abort();
    }, [provider]);

    // ── Core fetch function ───────────────────────────────────────────────────
    const doFetch = useCallback(async () => {
      // Abort any in-flight request for this session
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setFetchState('loading');
      setFetchError('');

      try {
        // @ts-expect-error — electronAPI is injected by preload.js
        const result: FetchModelsResult = await window.electronAPI.fetchModels({
          provider,
          baseUrl: baseUrl ?? '',
        });

        if (result.error) {
          setFetchState('error');
          setFetchError(result.error);
          return;
        }

        setModels(result.models);
        setFetchState('success');

        // Open the dropdown automatically after a successful fetch
        if (result.models.length > 0) {
          setIsOpen(true);
          setHighlightedIndex(0);
        }
      } catch (err: unknown) {
        // Ignore aborted requests
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFetchState('error');
        setFetchError(
          err instanceof Error ? err.message : 'Unexpected error fetching models',
        );
      }
    }, [provider, baseUrl]);

    // ── Expose triggerFetch via ref (called by Setup.tsx after key save) ──────
    useImperativeHandle(ref, () => ({ triggerFetch: doFetch }), [doFetch]);

    // ── Select a model from the list ─────────────────────────────────────────
    const selectModel = useCallback(
      (model: string) => {
        onChange(model);
        setIsOpen(false);
        setHighlightedIndex(-1);
        inputRef.current?.focus();
      },
      [onChange],
    );

    // ── Whether to show the fetch button ─────────────────────────────────────
    // Ollama/custom: always (no key required); cloud: only when a key is stored
    const canFetch = provider === 'ollama' || provider === 'custom' || hasStoredKey;

    // ── Whether we currently have results to show ─────────────────────────────
    const hasResults = models.length > 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div ref={containerRef} className={`relative ${className}`}>
        {/* ─── Label row ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Model name
          </label>

          {/* Fetch / refresh button */}
          <div className="flex items-center gap-2">
            {/* "key required" hint for cloud providers without a stored key */}
            {!canFetch && (
              <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                Enter API key above to fetch models
              </span>
            )}

            {/* Success badge */}
            {fetchState === 'success' && hasResults && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                {models.length} model{models.length !== 1 ? 's' : ''}
              </span>
            )}

            {canFetch && (
              <button
                type="button"
                onClick={doFetch}
                disabled={disabled || fetchState === 'loading'}
                title={`Fetch available models from ${PROVIDER_SOURCE_LABEL[provider]}`}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                  transition-all border
                  ${
                    fetchState === 'loading'
                      ? 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-500 cursor-wait'
                      : fetchState === 'error'
                      ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30'
                      : 'border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#0f1117] text-gray-600 dark:text-gray-300 hover:border-amber-400 hover:text-amber-500 dark:hover:text-amber-400'
                  }
                `}
              >
                {fetchState === 'loading' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : fetchState === 'success' ? (
                  <RefreshCw className="w-3 h-3" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {fetchState === 'loading'
                  ? 'Fetching…'
                  : fetchState === 'success'
                  ? 'Refresh'
                  : 'Fetch models'}
              </button>
            )}
          </div>
        </div>

        {/* ─── Input + dropdown toggle ─────────────────────────────────────── */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              // Re-open dropdown if we have results and user starts editing
              if (hasResults && e.target.value.length > 0) {
                setIsOpen(true);
              }
            }}
            onFocus={() => {
              if (hasResults) setIsOpen(true);
            }}
            onBlur={() => {
              // Small delay so click on dropdown item registers first
              setTimeout(() => {
                onBlur?.();
              }, 150);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              provider === 'claude'
                ? 'e.g. claude-sonnet-4-6'
                : provider === 'openai'
                ? 'e.g. gpt-4o'
                : provider === 'gemini'
                ? 'e.g. gemini-2.5-flash'
                : provider === 'ollama'
                ? 'e.g. llama3.2'
                : 'model-id'
            }
            className={`
              w-full bg-white dark:bg-[#0f1117] border rounded-lg px-4 py-2.5 pr-9
              text-sm text-gray-900 dark:text-white
              placeholder-gray-400 dark:placeholder-gray-500
              focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500
              transition-colors
              ${
                error
                  ? 'border-red-400 dark:border-red-600'
                  : 'border-gray-300 dark:border-[#1e2535]'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          />

          {/* Chevron / clear button */}
          {hasResults ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setIsOpen((o) => !o)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-amber-500 transition-colors"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          ) : null}
        </div>

        {/* ─── Dropdown ────────────────────────────────────────────────────── */}
        {isOpen && filteredModels.length > 0 && (
          <div
            className="
              absolute z-50 w-full mt-1 rounded-xl border border-gray-200 dark:border-[#1e2535]
              bg-white dark:bg-[#161b27] shadow-lg overflow-hidden
            "
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-[#1e2535]">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''} from{' '}
                {PROVIDER_SOURCE_LABEL[provider]}
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Model list */}
            <ul
              ref={listRef}
              role="listbox"
              className="max-h-56 overflow-y-auto py-1"
            >
              {filteredModels.map((model, idx) => {
                const isHighlighted = idx === highlightedIndex;
                const isSelected = model === value;
                return (
                  <li
                    key={model}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      // Prevent the input's onBlur from firing first
                      e.preventDefault();
                      selectModel(model);
                    }}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`
                      flex items-center justify-between px-3 py-2 cursor-pointer
                      text-sm transition-colors
                      ${
                        isHighlighted
                          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#1a1f2e]'
                      }
                    `}
                  >
                    <span className="font-mono text-xs">{model}</span>
                    {isSelected && (
                      <span className="text-amber-500 text-xs ml-2 shrink-0">
                        ✓ current
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Footer hint */}
            <div className="px-3 py-2 border-t border-gray-100 dark:border-[#1e2535]">
              <p className="text-xs text-gray-400 dark:text-gray-600">
                ↑↓ navigate · Enter select · Esc close · or type a custom ID
              </p>
            </div>
          </div>
        )}

        {/* ─── Inline error states ─────────────────────────────────────────── */}
        {error && (
          <p className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {error}
          </p>
        )}

        {fetchState === 'error' && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>
              Could not fetch models: {fetchError}.{' '}
              <span className="underline cursor-pointer" onClick={doFetch}>
                Retry
              </span>{' '}
              or type a model name manually.
            </span>
          </p>
        )}

        {fetchState === 'success' && models.length === 0 && (
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            No models returned — type a model name manually.
          </p>
        )}
      </div>
    );
  },
);

ModelCombobox.displayName = 'ModelCombobox';
export default ModelCombobox;