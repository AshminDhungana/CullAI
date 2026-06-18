/**
 * src/main/maintenance.ts
 *
 *
 * Runs lightweight maintenance tasks on app startup:
 *  1. Orphaned .cullai_cache cleanup — checks if the input folder still exists.
 *  2. Session log trimming — keeps only the last 30 entries in sessionHistory.
 *  3. Last-run tracking — skips if run within the last 7 days (configurable).
 *
 * All operations are non-blocking, logged, and can be disabled by a hidden
 * electron-store setting `"disableBackgroundMaintenance"`.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MaintenanceResult {
  orphanedCacheCount: number;
  orphanedCacheFreedBytes: number;
  sessionLogEntriesRemoved: number;
  skippedBecause: 'disabled' | 'too-soon' | 'done';
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_HISTORY_MAX = 30;

/** Check if maintenance should run (based on last run timestamp). */
function shouldRun(store: unknown): boolean {
  const s = store as any;
  const disabled = s.get('disableBackgroundMaintenance');
  if (disabled === true || disabled === 'true') return false;

  const lastRun = s.get('maintenanceLastRun');
  if (lastRun) {
    const last = new Date(lastRun as string);
    if (Number.isNaN(last.getTime())) return true; // invalid date, run anyway
    if (Date.now() - last.getTime() < WEEK_MS) return false; // ran too recently
  }
  return true;
}

function markRan(store: unknown): void {
  (store as any).set('maintenanceLastRun', new Date().toISOString());
}

/**
 * Scans electron-store's recentInputFolders for cache dirs whose input folder
 * no longer exists, and offers to delete them. In this non-interactive variant,
 * we just count and delete.
 */
async function cleanupOrphanedCaches(store: unknown): Promise<{ count: number; freedBytes: number }> {
  const s = store as any;
  const recentFolders: string[] = s.get('recentInputFolders', []) || [];
  let count = 0;
  let freedBytes = 0;

  for (const inputFolder of recentFolders) {
    if (!inputFolder) continue;
    const cacheDir = path.join(inputFolder, '.cullai_cache');
    if (!fs.existsSync(cacheDir)) continue;

    const inputStillExists = fs.existsSync(inputFolder);
    if (inputStillExists) continue; // not orphaned

    try {
      const stats = await fs.promises.stat(cacheDir);
      if (stats.isDirectory()) {
        // Recursively size and delete
        freedBytes += (await getDirSize(cacheDir));
        await fs.promises.rm(cacheDir, { recursive: true, force: true });
        count++;
      }
    } catch {
      // best effort, don't crash
    }
  }

  return { count, freedBytes };
}

/** Calculate total size of a directory recursively. */
async function getDirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) {
        total += await getDirSize(fullPath);
      } else {
        total += stat.size;
      }
    }
  } catch {
    // ignore
  }
  return total;
}

/** Trims electron-store's sessionHistory to the last `SESSION_HISTORY_MAX` entries. */
function trimSessionLogs(store: unknown): number {
  const s = store as any;
  try {
    const history = s.get('sessionHistory') as any[] | undefined;
    if (!Array.isArray(history) || history.length <= SESSION_HISTORY_MAX) return 0;
    const removed = history.length - SESSION_HISTORY_MAX;
    s.set('sessionHistory', history.slice(0, SESSION_HISTORY_MAX));
    return removed;
  } catch {
    return 0;
  }
}

/**
 * Runs all background maintenance tasks. Non-blocking and safe to call every
 * time the app starts. Returns a summary of what was done.
 */
export async function runBackgroundMaintenance(store: unknown): Promise<MaintenanceResult> {
  if (!shouldRun(store)) {
    return {
      orphanedCacheCount: 0,
      orphanedCacheFreedBytes: 0,
      sessionLogEntriesRemoved: 0,
      skippedBecause: 'too-soon',
    };
  }

  const { count, freedBytes } = await cleanupOrphanedCaches(store);
  const sessionLogRemoved = trimSessionLogs(store);

  markRan(store);

  return {
    orphanedCacheCount: count,
    orphanedCacheFreedBytes: freedBytes,
    sessionLogEntriesRemoved: sessionLogRemoved,
    skippedBecause: 'done',
  };
}