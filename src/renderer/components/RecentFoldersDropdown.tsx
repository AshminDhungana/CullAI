/**
 * RecentFoldersDropdown.tsx
 *
 * A compact, accessible dropdown that lists recently used folder paths.
 * Renders nothing when `paths` is empty so callers never need to gate it.
 *
 * Keyboard behaviour:
 *   ↓ / ↑   — move focus through items
 *   Enter / Space — select focused item
 *   Escape  — close without selecting
 *   Tab     — close (natural tab-out)
 */

import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Clock, ChevronDown, FolderOpen } from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RecentFoldersDropdownProps {
  paths:    string[];
  onSelect: (path: string) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns just the last path segment for compact display in the trigger. */
function basename(fullPath: string): string {
  return fullPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? fullPath;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RecentFoldersDropdown({
  paths,
  onSelect,
  disabled = false,
}: RecentFoldersDropdownProps) {
  const [isOpen,       setIsOpen]       = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const triggerRef   = useRef<HTMLButtonElement>(null);
  const listRef      = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId    = useId();

  // Nothing to show — render nothing so the parent layout is unaffected.
  if (paths.length === 0) return null;

  // ── Open / close ──────────────────────────────────────────────────────────

  const open = () => {
    setFocusedIndex(-1);
    setIsOpen(true);
  };

  const close = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
  }, []);

  const toggle = () => (isOpen ? close() : open());

  // ── Selection ─────────────────────────────────────────────────────────────

  const select = useCallback(
    (path: string) => {
      onSelect(path);
      close();
      triggerRef.current?.focus();
    },
    [onSelect, close],
  );

  // ── Click-outside ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, close]);

  // ── Scroll focused item into view ─────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || focusedIndex < 0) return;
    const item = listRef.current?.children[focusedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, isOpen]);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) open();
      setFocusedIndex(0);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, paths.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => {
        if (i <= 0) { triggerRef.current?.focus(); return -1; }
        return i - 1;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusedIndex >= 0) select(paths[focusedIndex]);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative mt-2">

      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
        className={[
          'flex items-center gap-1.5 text-xs font-medium transition-colors',
          'text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-400',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded',
        ].join(' ')}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" />
        Recent
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Recent folders"
          onKeyDown={handleListKeyDown}
          tabIndex={-1}
          className={[
            'absolute left-0 z-50 mt-1 w-full min-w-[260px] max-w-[420px]',
            'max-h-48 overflow-y-auto',
            'rounded-xl border border-gray-200 dark:border-[#1e2535]',
            'bg-white dark:bg-[#161b27]',
            'shadow-lg shadow-black/10 dark:shadow-black/40',
            'py-1',
            // Subtle entrance animation via CSS — no framer-motion dep here
            'animate-[fadeSlideDown_0.12s_ease-out]',
          ].join(' ')}
          style={{
            // Inline keyframes fallback if Tailwind JIT doesn't pick up custom animation
            animation: 'fadeSlideDown 0.12s ease-out',
          }}
        >
          {paths.map((p, idx) => (
            <li
              key={p}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                // Use mousedown (fires before blur) to reliably capture the click
                e.preventDefault();
                select(p);
              }}
              onMouseEnter={() => setFocusedIndex(idx)}
              className={[
                'flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none',
                'transition-colors duration-75',
                focusedIndex === idx
                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1f2e]',
              ].join(' ')}
            >
              <FolderOpen
                className={`w-3.5 h-3.5 shrink-0 ${
                  focusedIndex === idx
                    ? 'text-amber-500'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              />
              <span className="flex-1 min-w-0">
                {/* Short name in bold, full path as muted subtitle */}
                <span className="block text-xs font-medium truncate">
                  {basename(p)}
                </span>
                <span
                  className="block text-[10px] text-gray-400 dark:text-gray-600 truncate"
                  title={p}
                >
                  {p}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Keyframe definition — injected once into the document head via a style tag */}
      <style>{`
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
    </div>
  );
}