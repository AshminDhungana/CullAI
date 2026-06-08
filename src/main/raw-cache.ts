/**
 * src/main/raw-cache.ts
 *
 * Smart RAW preview caching for CullAI (Phase 5b).
 *
 * ── Purpose ──────────────────────────────────────────────────────────────────
 *
 *   Caches decoded RAW preview JPEGs to disk so that subsequent runs (or
 *   session resumes) over the same input folder skip the expensive
 *   lightdrift-libraw demosaic pipeline entirely.
 *
 * ── Cache location ───────────────────────────────────────────────────────────
 *
 *   Per-folder:  {inputFolder}/.cullai_cache/raw_previews/
 *
 *   This approach was chosen over a global cache (~/.cullai/cache/) because:
 *     • Portable — moving a folder to another machine keeps its cache.
 *     • Users can selectively delete caches per-project.
 *     • No single global directory growing indefinitely.
 *
 * ── Cache key ────────────────────────────────────────────────────────────────
 *
 *   key = SHA-256( absolutePath + ":" + mtime_ms ).slice(0, 32)
 *
 *   Using mtime ensures that if a RAW file is re-edited or replaced externally,
 *   the stale entry is a cache miss and gets overwritten on next decode.
 *
 * ── File layout ──────────────────────────────────────────────────────────────
 *
 *   {inputFolder}/.cullai_cache/raw_previews/{key}.jpg       — cached JPEG
 *   {inputFolder}/.cullai_cache/raw_previews/{key}.meta.json — sidecar metadata
 *
 * ── Integration ──────────────────────────────────────────────────────────────
 *
 *   image-processor.ts already contains dynamic import('./raw-cache') stubs
 *   that call getCachedRawPreview() and storeRawPreview() with the exact
 *   signatures exported here. No changes to image-processor.ts are needed.
 *
 * MAIN-PROCESS ONLY.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Cache statistics for a single input folder's .cullai_cache directory.
 */
export interface CacheStats {
  /** Total size of all cached JPEG files in bytes. */
  sizeBytes: number;
  /** Number of cached preview files. */
  fileCount: number;
  /** ISO timestamp of the oldest cache entry, or null if cache is empty. */
  oldestEntry: string | null;
}

/**
 * Sidecar metadata stored alongside each cached JPEG.
 * Used by cache-cleaner.ts to make age-based eviction decisions.
 */
export interface CacheSidecar {
  /** Absolute path to the original RAW file. */
  originalPath: string;
  /** mtime of the original RAW file at cache time (ms since epoch). */
  originalMtime: number;
  /** Size of the original RAW file in bytes. */
  originalSize: number;
  /** ISO timestamp of when this cache entry was created. */
  cachedAt: string;
  /** Schema version for forward-compatible sidecar evolution. */
  cacheVersion: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Module-level config set by the caller (ipc-handlers / index.ts). */
let _cacheDisabled = false;

/**
 * Updates the module-level cache configuration.
 * Called once at startup and whenever the user toggles the setting.
 */
export function setCacheConfig(config: { disabled: boolean }): void {
  _cacheDisabled = config.disabled;
}

/**
 * Returns true if RAW caching is currently disabled by user preference.
 */
export function isCacheDisabled(): boolean {
  return _cacheDisabled;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DIR_NAME = '.cullai_cache';
const PREVIEWS_SUBDIR = 'raw_previews';
/** Current sidecar schema version. Increment on breaking changes. */
const CACHE_VERSION = 1;
/** JPEG magic bytes — first two bytes of any valid JPEG file. */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the cache directory for an input folder.
 * Does NOT create the directory — use ensureCacheDir() for that.
 */
function getCacheDir(inputFolder: string): string {
  return path.join(inputFolder, CACHE_DIR_NAME, PREVIEWS_SUBDIR);
}

/**
 * Derives the cache dir from a RAW file path by using its parent directory.
 */
function getCacheDirForRawFile(rawPath: string): string {
  return getCacheDir(path.dirname(rawPath));
}

/**
 * Computes a deterministic 32-char hex cache key from a file path and mtime.
 *
 * The key changes whenever the file is modified (mtime changes), ensuring
 * stale cache entries are missed and overwritten.
 */
function computeCacheKey(absolutePath: string, mtimeMs: number): string {
  return crypto
    .createHash('sha256')
    .update(`${absolutePath}:${mtimeMs}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Creates the cache directory tree if it doesn't exist.
 * Uses recursive mkdir so intermediate directories are also created.
 */
async function ensureCacheDir(cacheDir: string): Promise<void> {
  await fs.promises.mkdir(cacheDir, { recursive: true });
}

/**
 * Validates that a buffer starts with JPEG magic bytes (0xFF 0xD8).
 * Used to detect corruption from partial writes or disk errors.
 */
function isValidJpeg(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === JPEG_MAGIC[0] && buffer[1] === JPEG_MAGIC[1];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Looks up a cached RAW preview for `rawPath`.
 *
 * Returns the cached JPEG buffer on a valid hit, or null on:
 *   • Cache miss (no matching key for current file + mtime)
 *   • Corruption (JPEG magic bytes check fails)
 *   • Caching disabled by user preference
 *   • Any I/O error (treated as miss, not thrown)
 *
 * This signature matches what image-processor.ts expects from its
 * dynamic import('./raw-cache') stub.
 *
 * @param rawPath  Absolute path to the RAW file.
 * @returns        Cached JPEG buffer or null.
 */
export async function getCachedRawPreview(rawPath: string): Promise<Buffer | null> {
  if (_cacheDisabled) return null;

  const devMode = process.env.NODE_ENV === 'development';

  try {
    const absolutePath = path.resolve(rawPath);
    const stat = await fs.promises.stat(absolutePath);
    const key = computeCacheKey(absolutePath, stat.mtimeMs);
    const cacheDir = getCacheDirForRawFile(absolutePath);
    const jpegPath = path.join(cacheDir, `${key}.jpg`);

    // Check if the cached file exists
    try {
      await fs.promises.access(jpegPath, fs.constants.R_OK);
    } catch {
      // File doesn't exist — cache miss
      return null;
    }

    const buffer = await fs.promises.readFile(jpegPath);

    // Validate JPEG integrity
    if (!isValidJpeg(buffer)) {
      if (devMode) {
        console.warn(
          `[raw-cache] Corrupted cache entry for ${path.basename(rawPath)} — ` +
          'JPEG magic bytes missing, treating as miss',
        );
      }
      // Delete the corrupted entry so storeRawPreview overwrites it
      await fs.promises.unlink(jpegPath).catch(() => {});
      const metaPath = path.join(cacheDir, `${key}.meta.json`);
      await fs.promises.unlink(metaPath).catch(() => {});
      return null;
    }

    return buffer;
  } catch (err) {
    // Any unexpected error is a non-fatal cache miss
    if (devMode) {
      console.warn(
        `[raw-cache] Cache lookup failed for ${path.basename(rawPath)}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

/**
 * Stores a decoded RAW preview in the per-folder cache.
 *
 * Uses an atomic write pattern (write to .tmp, then rename) to prevent
 * partial reads by concurrent processes.
 *
 * No-op if caching is disabled by user preference.
 *
 * This signature matches what image-processor.ts expects from its
 * dynamic import('./raw-cache') stub.
 *
 * @param rawPath     Absolute path to the original RAW file.
 * @param jpegBuffer  The decoded JPEG buffer to cache (pre-resize, full quality).
 */
export async function storeRawPreview(rawPath: string, jpegBuffer: Buffer): Promise<void> {
  if (_cacheDisabled) return;

  const devMode = process.env.NODE_ENV === 'development';

  try {
    const absolutePath = path.resolve(rawPath);
    const stat = await fs.promises.stat(absolutePath);
    const key = computeCacheKey(absolutePath, stat.mtimeMs);
    const cacheDir = getCacheDirForRawFile(absolutePath);

    // Ensure the cache directory exists (lazy creation)
    await ensureCacheDir(cacheDir);

    const jpegPath = path.join(cacheDir, `${key}.jpg`);
    const tmpPath = path.join(cacheDir, `${key}.jpg.tmp`);
    const metaPath = path.join(cacheDir, `${key}.meta.json`);

    // ── Atomic write: JPEG ──────────────────────────────────────────────────
    await fs.promises.writeFile(tmpPath, jpegBuffer);
    await fs.promises.rename(tmpPath, jpegPath);

    // ── Write sidecar metadata ──────────────────────────────────────────────
    const sidecar: CacheSidecar = {
      originalPath: absolutePath,
      originalMtime: stat.mtimeMs,
      originalSize: stat.size,
      cachedAt: new Date().toISOString(),
      cacheVersion: CACHE_VERSION,
    };
    await fs.promises.writeFile(metaPath, JSON.stringify(sidecar, null, 2), 'utf8');

    if (devMode) {
      console.log(
        `[raw-cache] Stored cache entry for ${path.basename(rawPath)} — ` +
        `${(jpegBuffer.length / 1024).toFixed(0)} KB | key=${key}`,
      );
    }
  } catch (err: any) {
    // Non-fatal: read-only media, disk full, permissions, etc.
    // Log and let the pipeline continue without caching.
    if (devMode || err?.code === 'ENOSPC') {
      const code = err?.code ?? 'UNKNOWN';
      console.warn(
        `[raw-cache] Failed to store cache entry for ${path.basename(rawPath)} ` +
        `(${code}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/**
 * Computes cache statistics for a single input folder.
 *
 * Scans {inputFolder}/.cullai_cache/raw_previews/ for *.meta.json files,
 * sums JPEG sizes, counts entries, and finds the oldest cache timestamp.
 *
 * @param inputFolder  Absolute path to the input folder.
 * @returns            Cache statistics. Returns zeroed stats if the cache
 *                     directory doesn't exist.
 */
export async function getCacheStats(inputFolder: string): Promise<CacheStats> {
  const cacheDir = getCacheDir(inputFolder);
  const stats: CacheStats = { sizeBytes: 0, fileCount: 0, oldestEntry: null };

  try {
    await fs.promises.access(cacheDir, fs.constants.R_OK);
  } catch {
    // Cache directory doesn't exist — return empty stats
    return stats;
  }

  try {
    const entries = await fs.promises.readdir(cacheDir);
    let oldestMs = Infinity;

    for (const entry of entries) {
      if (!entry.endsWith('.jpg')) continue;

      const jpegPath = path.join(cacheDir, entry);
      try {
        const fileStat = await fs.promises.stat(jpegPath);
        stats.sizeBytes += fileStat.size;
        stats.fileCount++;

        // Try to read the companion sidecar for age info
        const metaPath = path.join(cacheDir, entry.replace(/\.jpg$/, '.meta.json'));
        try {
          const metaRaw = await fs.promises.readFile(metaPath, 'utf8');
          const meta: CacheSidecar = JSON.parse(metaRaw);
          const cachedAtMs = new Date(meta.cachedAt).getTime();
          if (cachedAtMs < oldestMs) {
            oldestMs = cachedAtMs;
          }
        } catch {
          // No sidecar or invalid JSON — use file mtime as fallback
          if (fileStat.mtimeMs < oldestMs) {
            oldestMs = fileStat.mtimeMs;
          }
        }
      } catch {
        // Can't stat the file — skip
      }
    }

    if (oldestMs < Infinity) {
      stats.oldestEntry = new Date(oldestMs).toISOString();
    }
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[raw-cache] getCacheStats failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return stats;
}

/**
 * Deletes the entire .cullai_cache directory for the given input folder.
 *
 * @param inputFolder  Absolute path to the input folder.
 */
export async function clearCache(inputFolder: string): Promise<void> {
  const cacheDirRoot = path.join(inputFolder, CACHE_DIR_NAME);

  try {
    await fs.promises.rm(cacheDirRoot, { recursive: true, force: true });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[raw-cache] Cleared cache for ${inputFolder}`);
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      // ENOENT is fine — cache was already gone
      throw err;
    }
  }
}

/**
 * Lists all cache entry details for use by cache-cleaner.ts.
 *
 * Returns an array of { key, jpegPath, metaPath, sizeBytes, cachedAtMs }
 * for each valid cache entry in the given input folder.
 *
 * @internal Exported for cache-cleaner.ts only — not part of the public API.
 */
export async function listCacheEntries(inputFolder: string): Promise<
  Array<{
    key: string;
    jpegPath: string;
    metaPath: string;
    sizeBytes: number;
    cachedAtMs: number;
  }>
> {
  const cacheDir = getCacheDir(inputFolder);
  const results: Array<{
    key: string;
    jpegPath: string;
    metaPath: string;
    sizeBytes: number;
    cachedAtMs: number;
  }> = [];

  try {
    await fs.promises.access(cacheDir, fs.constants.R_OK);
  } catch {
    return results;
  }

  const entries = await fs.promises.readdir(cacheDir);

  for (const entry of entries) {
    if (!entry.endsWith('.jpg')) continue;

    const key = entry.replace(/\.jpg$/, '');
    const jpegPath = path.join(cacheDir, entry);
    const metaPath = path.join(cacheDir, `${key}.meta.json`);

    try {
      const fileStat = await fs.promises.stat(jpegPath);
      let cachedAtMs = fileStat.mtimeMs; // fallback

      try {
        const metaRaw = await fs.promises.readFile(metaPath, 'utf8');
        const meta: CacheSidecar = JSON.parse(metaRaw);
        cachedAtMs = new Date(meta.cachedAt).getTime();
      } catch {
        // No sidecar — use file mtime
      }

      results.push({
        key,
        jpegPath,
        metaPath,
        sizeBytes: fileStat.size,
        cachedAtMs,
      });
    } catch {
      // Can't stat — skip
    }
  }

  return results;
}
