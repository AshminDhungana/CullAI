/**
 * src/main/cache-cleaner.ts
 *
 * Automatic cache cleanup for CullAI RAW preview cache (Phase 5b).
 *
 * ── Purpose ──────────────────────────────────────────────────────────────────
 *
 *   Enforces user-defined size and age limits on the per-folder RAW preview
 *   cache. Runs non-blockingly at three trigger points:
 *
 *     1. App startup (after main window loads)
 *     2. After each process-images run completes
 *     3. When the user changes cache limit settings via the UI
 *
 * ── Algorithm ────────────────────────────────────────────────────────────────
 *
 *   1. Scan all *.meta.json sidecar files in the cache directory.
 *   2. Age pass: delete entries older than maxAgeDays.
 *   3. Size pass: sort remaining by cachedAt (oldest first), delete until
 *      total size ≤ maxSizeBytes.
 *
 * MAIN-PROCESS ONLY.
 */

import * as fs from 'fs';
import { listCacheEntries } from './raw-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * User-configurable cache limits.
 */
export interface CacheLimits {
  /** Maximum total cache size in bytes. */
  maxSizeBytes: number;
  /** Maximum age of a cache entry in days. */
  maxAgeDays: number;
}

/**
 * Result of a cleanup operation.
 */
export interface CleanupResult {
  /** Number of cache entries (JPEG + sidecar pairs) deleted. */
  deletedFiles: number;
  /** Total bytes freed by deletion. */
  freedBytes: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely deletes a file. Returns true on success, false on any error.
 */
async function safeUnlink(filePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enforces cache size and age limits for a single input folder.
 *
 * 1. Age pass: deletes any entry older than `limits.maxAgeDays`.
 * 2. Size pass: if total size still exceeds `limits.maxSizeBytes`, deletes
 *    the oldest entries first until the size is within the limit.
 *
 * @param inputFolder  Absolute path to the input folder whose cache to clean.
 * @param limits       User-configured size and age limits.
 * @returns            Summary of what was deleted.
 */
export async function enforceCacheLimits(
  inputFolder: string,
  limits: CacheLimits,
): Promise<CleanupResult> {
  const devMode = process.env.NODE_ENV === 'development';
  const result: CleanupResult = { deletedFiles: 0, freedBytes: 0 };

  try {
    const entries = await listCacheEntries(inputFolder);

    if (entries.length === 0) return result;

    const now = Date.now();
    const maxAgeMs = limits.maxAgeDays * 24 * 60 * 60 * 1000;

    // ── Age pass ────────────────────────────────────────────────────────────
    // Delete any entry whose age exceeds the configured limit.
    const surviving: typeof entries = [];

    for (const entry of entries) {
      const ageMs = now - entry.cachedAtMs;

      if (ageMs > maxAgeMs) {
        const jpegDeleted = await safeUnlink(entry.jpegPath);
        await safeUnlink(entry.metaPath);

        if (jpegDeleted) {
          result.deletedFiles++;
          result.freedBytes += entry.sizeBytes;

          if (devMode) {
            console.log(
              `[cache-cleaner] Age eviction: ${entry.key} ` +
              `(${(ageMs / 86400000).toFixed(1)} days old, ${(entry.sizeBytes / 1024).toFixed(0)} KB)`,
            );
          }
        }
      } else {
        surviving.push(entry);
      }
    }

    // ── Size pass ───────────────────────────────────────────────────────────
    // If the remaining entries exceed the size limit, evict oldest first.
    let totalSize = surviving.reduce((sum, e) => sum + e.sizeBytes, 0);

    if (totalSize > limits.maxSizeBytes) {
      // Sort oldest first (lowest cachedAtMs)
      surviving.sort((a, b) => a.cachedAtMs - b.cachedAtMs);

      for (const entry of surviving) {
        if (totalSize <= limits.maxSizeBytes) break;

        const jpegDeleted = await safeUnlink(entry.jpegPath);
        await safeUnlink(entry.metaPath);

        if (jpegDeleted) {
          totalSize -= entry.sizeBytes;
          result.deletedFiles++;
          result.freedBytes += entry.sizeBytes;

          if (devMode) {
            console.log(
              `[cache-cleaner] Size eviction: ${entry.key} ` +
              `(${(entry.sizeBytes / 1024).toFixed(0)} KB, ` +
              `total now ${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
            );
          }
        }
      }
    }

    if (devMode && result.deletedFiles > 0) {
      console.log(
        `[cache-cleaner] Cleanup complete for ${inputFolder}: ` +
        `deleted ${result.deletedFiles} files, freed ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB`,
      );
    }
  } catch (err) {
    if (devMode) {
      console.warn(
        '[cache-cleaner] enforceCacheLimits failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return result;
}

/**
 * Runs enforceCacheLimits across multiple known input folders.
 *
 * Used at app startup to clean all previously scanned folders in one pass.
 * Errors in one folder do not prevent cleanup of the remaining folders.
 *
 * @param knownFolders  Array of absolute input folder paths (e.g. from recentInputFolders).
 * @param limits        User-configured size and age limits.
 * @returns             Aggregated cleanup result across all folders.
 */
export async function enforceAllCacheLimits(
  knownFolders: string[],
  limits: CacheLimits,
): Promise<CleanupResult> {
  const aggregate: CleanupResult = { deletedFiles: 0, freedBytes: 0 };

  for (const folder of knownFolders) {
    try {
      const folderResult = await enforceCacheLimits(folder, limits);
      aggregate.deletedFiles += folderResult.deletedFiles;
      aggregate.freedBytes += folderResult.freedBytes;
    } catch {
      // Folder may not exist anymore — skip silently
    }
  }

  return aggregate;
}
