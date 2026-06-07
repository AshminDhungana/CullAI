/**
 * useIgnoreRules.ts
 *
 * Watches the input folder for changes, reads the `.cullaiignore` file via
 * IPC, and exposes both the parsed patterns and how many files those patterns
 * would exclude from the current folder scan.
 *
 * Usage:
 *   const { patterns, matchCount, loading, reload } = useIgnoreRules(inputFolder);
 *
 * State shape:
 *   patterns   – string[] of active glob patterns, or [] when file is absent.
 *   matchCount – number of files excluded by those patterns (0 when no file).
 *   found      – true when a .cullaiignore file was found in the folder.
 *   loading    – true while the IPC round-trips are in flight.
 *   reload     – call this to force a re-read (e.g. after editing the file).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IgnoreRulesState {
  /** Active glob patterns from .cullaiignore. Empty when file is absent. */
  patterns: string[];
  /** How many files in the folder are excluded by those patterns. */
  matchCount: number;
  /** True when a .cullaiignore file was found (even if it has no rules). */
  found: boolean;
  /** True while IPC calls are in flight. */
  loading: boolean;
  /** Force a re-read of .cullaiignore without changing the folder. */
  reload: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIgnoreRules(inputFolder: string | undefined): IgnoreRulesState {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [found, setFound] = useState(false);
  const [loading, setLoading] = useState(false);

  // Increment this to trigger a re-read without changing the folder dep.
  const [reloadKey, setReloadKey] = useState(0);

  // Track the folder we last fetched for, so we can skip stale responses
  // when the user types quickly (or recent-folders list loads).
  const lastFolderRef = useRef<string>('');

  const reload = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  useEffect(() => {
    // Nothing to do without a folder.
    if (!inputFolder) {
      setPatterns([]);
      setMatchCount(0);
      setFound(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    lastFolderRef.current = inputFolder;

    async function fetch() {
      setLoading(true);
      try {
        // ── 1. Parse .cullaiignore ───────────────────────────────────────────
        // @ts-expect-error – electronAPI injected by preload
        const parsed: string[] | null = await window.electronAPI.parseCullaiIgnore(inputFolder);

        if (cancelled || lastFolderRef.current !== inputFolder) return;

        const activePatterns = parsed ?? [];
        setPatterns(activePatterns);
        setFound(parsed !== null);

        // ── 2. Count ignored files ───────────────────────────────────────────
        // We run two scans: one without ignore patterns (total), one with them
        // (filtered). The delta is the number of excluded files.
        //
        // Both calls pass empty extension/prefix arrays so we count all files —
        // matching what `validateInputFolder` does in Setup.tsx. The caller can
        // refine this if extension/prefix filters need to be applied first, but
        // for the badge we care about the raw ignore-file exclusion count.
        if (activePatterns.length === 0) {
          setMatchCount(0);
          return;
        }

        const [totalResult, filteredResult] = await Promise.all([
          // @ts-expect-error – electronAPI injected by preload
          window.electronAPI.scanFolder(inputFolder, [], [], []),
          // @ts-expect-error – electronAPI injected by preload
          window.electronAPI.scanFolder(inputFolder, [], [], activePatterns),
        ]);

        if (cancelled || lastFolderRef.current !== inputFolder) return;

        const excluded = (totalResult?.count ?? 0) - (filteredResult?.count ?? 0);
        setMatchCount(Math.max(0, excluded));
      } catch (err) {
        if (cancelled || lastFolderRef.current !== inputFolder) return;
        // Silently reset — the folder may not exist yet or IPC bridge isn't
        // ready. Setup.tsx already validates folder existence separately.
        console.warn('[useIgnoreRules] fetch error:', err);
        setPatterns([]);
        setMatchCount(0);
        setFound(false);
      } finally {
        if (!cancelled && lastFolderRef.current === inputFolder) {
          setLoading(false);
        }
      }
    }

    fetch();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputFolder, reloadKey]);

  return { patterns, matchCount, found, loading, reload };
}