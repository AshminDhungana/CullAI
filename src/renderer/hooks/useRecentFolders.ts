/**
 * useRecentFolders.ts
 *
 * Wraps the two recent-folder IPC channels in a React hook so SetupScreen
 * stays lean. Local state is kept in sync with the electron-store values
 * without an extra round-trip after each update (the handler returns the
 * updated list directly).
 *
 * Usage:
 *   const { recentInput, recentOutput, addRecentInput, addRecentOutput }
 *     = useRecentFolders();
 */

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types (mirrored from preload contract — no import needed)
// ---------------------------------------------------------------------------

interface RecentFoldersState {
  recentInput:      string[];
  recentOutput:     string[];
  addRecentInput:   (path: string) => Promise<void>;
  addRecentOutput:  (path: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRecentFolders(): RecentFoldersState {
  const [recentInput,  setRecentInput]  = useState<string[]>([]);
  const [recentOutput, setRecentOutput] = useState<string[]>([]);

  // Load persisted lists once on mount.
  useEffect(() => {
    (async () => {
      try {
        // @ts-expect-error — electronAPI is injected by preload
        const { input, output } = await window.electronAPI.getRecentFolders();
        setRecentInput(input   ?? []);
        setRecentOutput(output ?? []);
      } catch (err) {
        // Non-fatal: runs in Storybook / tests without electronAPI.
        console.warn('[useRecentFolders] Could not load recent folders:', err);
      }
    })();
  }, []);

  const addRecentInput = useCallback(async (folderPath: string) => {
    try {
      // @ts-expect-error
      const updated: string[] = await window.electronAPI.updateRecentFolder({
        kind: 'input',
        path: folderPath,
      });
      setRecentInput(updated);
    } catch (err) {
      console.warn('[useRecentFolders] addRecentInput failed:', err);
    }
  }, []);

  const addRecentOutput = useCallback(async (folderPath: string) => {
    try {
      // @ts-expect-error
      const updated: string[] = await window.electronAPI.updateRecentFolder({
        kind: 'output',
        path: folderPath,
      });
      setRecentOutput(updated);
    } catch (err) {
      console.warn('[useRecentFolders] addRecentOutput failed:', err);
    }
  }, []);

  return { recentInput, recentOutput, addRecentInput, addRecentOutput };
}