/**
 * src/main/image-processor.ts
 *
 * Preview buffer routing and image processing pipeline for CullAI.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   1. scanFolder()       — Enumerate image files in a folder, applying
 *                           extension/prefix/ignore filters. Single authoritative
 *                           implementation; ipc-handlers.ts delegates to this.
 *
 *   2. processImage()     — Convert one file path into an ImageRecord with a
 *                           resized base64 JPEG and correct width/height.
 *
 *   3. processFolder()    — Async generator that yields one ImageRecord at a time
 *                           over an entire folder. Intentionally serial in Phase 5;
 *                           Phase 11 replaces the concurrency model.
 *
 *   4. getPreviewBuffer() — Single entry point the gallery calls to obtain a
 *                           ≤1024 px JPEG preview for the Results screen.
 *
 *   5. getAiScoringBuffer() — Always uses full decodeRaw() for RAW files,
 *                             guaranteeing consistent AI scoring input.
 *
 * ── RAW caching stub (Phase 5b) ───────────────────────────────────────────────
 *
 *   processImage() calls getCachedRawPreview() and storeRawPreview() from
 *   './raw-cache'. That module does not exist until Phase 5b. The dynamic
 *   import below gracefully falls back to a cache-miss on MODULE_NOT_FOUND so
 *   Phase 5 works without raw-cache.ts being present.
 *
 * ── Path decision (RAW files only) ───────────────────────────────────────────
 *
 *   useEmbeddedPreview = true (default)
 *     → extractEmbeddedJpeg() → resize
 *     → if null (no usable embedded preview) → decodeRaw() → resize
 *
 *   useEmbeddedPreview = false
 *     → decodeRaw() → resize (always)
 *
 * ── What this module is NOT ───────────────────────────────────────────────────
 *
 *   • It does not handle AI API calls.
 *   • It does not check license tier — the pipeline does that before calling here.
 *
 * ── Dependencies ─────────────────────────────────────────────────────────────
 *
 *   lightdrift-libraw — native addon (main process only)
 *   sharp             — Node.js image resizer
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isRawFile, extractEmbeddedJpeg, decodeRaw, RawDecodeError, RAW_EXTENSIONS } from './raw-decoder';
import type { ImageRecord } from '../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum pixel dimension (width OR height) for any preview buffer returned
 * by getPreviewBuffer() or processImage(). Images larger than this are
 * downscaled while preserving the original aspect ratio.
 *
 * 1024 px is chosen to:
 *   • Exceed the minimum quality needed by AI vision models.
 *   • Keep base64-encoded payloads under ~400 KB (typical CR3 @ 1024 px).
 *   • Match the minimum size guard in extractEmbeddedJpeg().
 */
export const PREVIEW_MAX_PX = 1024;

/**
 * All non-RAW image extensions supported by the pipeline.
 * Combined with RAW_EXTENSIONS to form the full supported set.
 */
const STANDARD_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
  '.gif',
  '.avif',
  '.tiff',
  '.tif',
] as const;

/**
 * Complete set of supported extensions (standard + RAW), all lowercase.
 * Used by scanFolder when no extension filter is provided.
 */
export const ALL_SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...STANDARD_EXTENSIONS,
  ...RAW_EXTENSIONS,
]);

/**
 * Files and directories that are always excluded from folder scanning,
 * regardless of extension or prefix filters.
 *
 * .cullai_cache — RAW preview cache directory (Phase 5b)
 * .DS_Store     — macOS metadata
 * Thumbs.db     — Windows thumbnail database
 */
const ALWAYS_EXCLUDED = new Set(['.cullai_cache', '.DS_Store', 'Thumbs.db']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Source of the preview buffer. Logged per-file in development mode and
 * available to callers for metrics/debugging.
 *
 * - 'embedded'    Fast path: extracted from the RAW container's embedded JPEG.
 * - 'decoded'     Slow path: full sensor decode via LibRaw demosaic pipeline.
 * - 'passthrough' Non-RAW file: read from disk as-is (JPEG / HEIC).
 */
export type PreviewSource = 'embedded' | 'decoded' | 'passthrough';

export interface PreviewResult {
  /** JPEG buffer resized to ≤ PREVIEW_MAX_PX px on the longest side. */
  buffer: Buffer;
  /** How the buffer was produced. */
  source: PreviewSource;
  /** Width of the resized buffer in pixels. */
  width: number;
  /** Height of the resized buffer in pixels. */
  height: number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ScanFolderOptions {
  /**
   * Lowercase dot-prefixed extensions to include.
   * Empty array or undefined = include ALL_SUPPORTED_EXTENSIONS.
   */
  extensions?: string[];
  /**
   * Filename prefixes to include (matched from the start of the basename).
   * Empty array or undefined = no prefix filter.
   */
  prefixes?: string[];
  /**
   * Whether prefix matching is case-insensitive. Defaults to true.
   */
  prefixCaseInsensitive?: boolean;
  /**
   * Parsed .cullaiignore glob patterns. Files matching any pattern are excluded.
   * Empty array or undefined = no ignore filter.
   */
  ignorePatterns?: string[];
  /**
   * Recurse into subdirectories. Defaults to false.
   */
  recursive?: boolean;
}

export interface ProcessFolderOptions extends ScanFolderOptions {
  /**
   * AbortSignal to cancel the generator mid-run.
   * When signalled, the generator stops yielding and returns.
   * Phase 10 uses this to handle user cancellation.
   */
  signal?: AbortSignal;
  /**
   * When true, attempt to use the embedded JPEG preview for RAW files
   * instead of a full sensor decode. Defaults to true.
   */
  useEmbeddedPreview?: boolean;
}

// ---------------------------------------------------------------------------
// sharp loader (optional peer dependency)
// ---------------------------------------------------------------------------
//
// sharp is not listed in lightdrift-libraw's peerDependencies and is a
// substantial native addon. We import it lazily so the module can be required
// even if sharp is not yet installed. If sharp is unavailable, resizing is
// skipped and the raw buffer is returned at its original size — which is
// fine for correctness (just potentially large).

let _sharp: typeof import('sharp') | null | undefined = undefined; // undefined = not yet probed

async function getSharp(): Promise<typeof import('sharp') | null> {
  if (_sharp !== undefined) return _sharp;
  try {
    _sharp = (await import('sharp')).default as unknown as typeof import('sharp');
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[image-processor] sharp is not installed — previews will not be resized. ' +
        'Run `npm install sharp` in the project root to enable resizing.',
      );
    }
    _sharp = null;
  }
  return _sharp;
}

// ---------------------------------------------------------------------------
// Resize helper
// ---------------------------------------------------------------------------

/**
 * Resizes `input` so its longest side is ≤ maxPx, preserving aspect ratio.
 * Returns the buffer and the final dimensions.
 *
 * Uses `resolveWithObject: true` so we get width/height from a single Sharp
 * pipeline invocation — no second metadata() call needed.
 *
 * If sharp is unavailable, returns the original buffer with dimensions read
 * via a metadata() call on a fallback path.
 *
 * @param input   JPEG (or any sharp-supported) buffer.
 * @param maxPx   Maximum pixel dimension on the longest side.
 * @returns       JPEG buffer (resized if necessary) + final dimensions.
 */
async function resizeToPreview(
  input: Buffer,
  maxPx: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const sharp = await getSharp();

  if (!sharp) {
    // sharp not available — return as-is, dimensions unknown (0×0 sentinel).
    // Phase 11 / production use requires sharp to be installed.
    return { buffer: input, width: 0, height: 0 };
  }

  // Read metadata first to decide whether resize is necessary.
  // This avoids a redundant re-encode when the image is already small enough.
  const meta = await (sharp as any)(input).metadata();
  const srcWidth: number = meta.width ?? 0;
  const srcHeight: number = meta.height ?? 0;

  if (srcWidth <= maxPx && srcHeight <= maxPx) {
    // Already within bounds — still re-encode to normalise format/quality,
    // but use resolveWithObject to get the confirmed output dimensions.
    const { data, info } = await (sharp as any)(input)
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data as Buffer, width: info.width as number, height: info.height as number };
  }

  // Downscale to fit inside maxPx × maxPx, preserving aspect ratio.
  const { data, info } = await (sharp as any)(input)
    .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data as Buffer, width: info.width as number, height: info.height as number };
}

// ---------------------------------------------------------------------------
// Glob helpers (used by scanFolder for .cullaiignore patterns)
// ---------------------------------------------------------------------------

/**
 * Converts a single glob pattern string to a RegExp.
 * Supports: `*` (no slash), `**` (any including slash), `?` (single non-slash),
 * `[abc]` / `[a-z]` (character classes).
 */
function globToRegex(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, '/').trim();
  let re = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*' && p[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (p[i] === '/') i++;
    } else if (ch === '*') {
      re += '[^/]*';
      i++;
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if (ch === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) { re += '\\['; i++; }
      else { re += p.slice(i, end + 1); i = end + 1; }
    } else {
      re += ch.replace(/[.+^${}()|\\]/g, '\\$&');
      i++;
    }
  }
  const hasPathPart = p.includes('/');
  return hasPathPart
    ? new RegExp(`^${re}$`, 'i')
    : new RegExp(`(?:^|/)${re}$`, 'i');
}

function matchesIgnorePatterns(relativePath: string, patterns: RegExp[]): boolean {
  return patterns.some(rx => rx.test(relativePath));
}

// ---------------------------------------------------------------------------
// scanFolder
// ---------------------------------------------------------------------------

/**
 * Enumerates image files in `folderPath`, returning an array of absolute paths
 * sorted alphabetically by filename.
 *
 * This is the single authoritative folder-scanning implementation for the
 * pipeline. The `'scan-folder'` IPC handler in ipc-handlers.ts delegates to
 * this function instead of doing its own scan.
 *
 * Filtering order:
 *   1. Skip hidden files (leading dot), ALWAYS_EXCLUDED entries.
 *   2. Extension filter (if provided; otherwise all ALL_SUPPORTED_EXTENSIONS).
 *   3. Prefix filter (if provided).
 *   4. .cullaiignore patterns (if provided).
 *
 * @param folderPath   Absolute path to the folder to scan.
 * @param options      Filter options.
 * @returns            Sorted array of absolute file paths.
 */
export async function scanFolder(
  folderPath: string,
  options: ScanFolderOptions = {},
): Promise<string[]> {
  const {
    extensions,
    prefixes,
    prefixCaseInsensitive = true,
    ignorePatterns,
    recursive = false,
  } = options;

  // Build the effective extension set.
  const extSet: ReadonlySet<string> =
    extensions && extensions.length > 0
      ? new Set(extensions.map(e => e.toLowerCase()))
      : ALL_SUPPORTED_EXTENSIONS;

  // Pre-compile ignore patterns once outside the recursive walk.
  const ignoreRegexes: RegExp[] =
    ignorePatterns && ignorePatterns.length > 0
      ? ignorePatterns.map(globToRegex)
      : [];

  const results: string[] = [];
  const resolved = path.resolve(folderPath);

  async function walk(dir: string, relativeBase: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      // Unreadable directory — skip silently (permissions, network share, etc.)
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[image-processor] scanFolder: cannot read dir ${dir}:`, err.message);
      }
      return;
    }

    for (const entry of entries) {
      const name = entry.name;

      // ── Always-excluded entries ────────────────────────────────────────────
      if (ALWAYS_EXCLUDED.has(name) || name.startsWith('.')) continue;

      const absolutePath = path.join(dir, name);
      // Relative path from the root of the scan (for ignore pattern matching).
      const relativePath = relativeBase ? `${relativeBase}/${name}` : name;

      if (entry.isDirectory()) {
        if (recursive) await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      // ── Extension filter ──────────────────────────────────────────────────
      const ext = path.extname(name).toLowerCase();
      if (!extSet.has(ext)) continue;

      // ── Prefix filter ─────────────────────────────────────────────────────
      if (prefixes && prefixes.length > 0) {
        const testName = prefixCaseInsensitive ? name.toLowerCase() : name;
        const matched = prefixes.some(p =>
          testName.startsWith(prefixCaseInsensitive ? p.toLowerCase() : p),
        );
        if (!matched) continue;
      }

      // ── .cullaiignore patterns ────────────────────────────────────────────
      if (ignoreRegexes.length > 0 && matchesIgnorePatterns(relativePath, ignoreRegexes)) {
        continue;
      }

      results.push(absolutePath);
    }
  }

  await walk(resolved, '');

  // Alphabetical sort by basename so processing order is predictable.
  results.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  return results;
}

// ---------------------------------------------------------------------------
// processImage
// ---------------------------------------------------------------------------

/**
 * Converts a single image file into an ImageRecord with a resized base64 JPEG.
 *
 * For RAW files:
 *   1. Attempts getCachedRawPreview() from raw-cache.ts (Phase 5b stub — graceful
 *      cache-miss if the module is not yet present).
 *   2. On cache miss: calls getAiScoringBuffer() (full decode) then storeRawPreview().
 *
 * For non-RAW files:
 *   Reads from disk and passes through resizeToPreview().
 *
 * The `id` field is a 16-char hex prefix of SHA-256(absoluteFilePath).
 * See ImageRecord.id JSDoc in types.ts for the full rationale.
 *
 * @param filePath           Absolute path to the image file.
 * @param useEmbeddedPreview When true, use embedded JPEG preview for RAW gallery
 *                           previews. Defaults to true. Has no effect on the
 *                           base64 stored in ImageRecord (always full decode).
 * @returns                  Populated ImageRecord ready for AI scoring.
 * @throws                   RawDecodeError on RAW decode failure.
 *                           Plain Error if a non-RAW file cannot be read.
 */
export async function processImage(
  filePath: string,
  useEmbeddedPreview = true,
): Promise<ImageRecord> {
  const devMode = process.env.NODE_ENV === 'development';
  const filename = path.basename(filePath);
  const absolutePath = path.resolve(filePath);
  const rawFile = isRawFile(absolutePath);

  // ── Stable session ID ───────────────────────────────────────────────────────
  // SHA-256 of the absolute path, truncated to 16 hex chars.
  // See ImageRecord.id JSDoc for design rationale and Phase 5b/8 guidance.
  const id = crypto
    .createHash('sha256')
    .update(absolutePath)
    .digest('hex')
    .slice(0, 16);

  let buffer: Buffer;
  let width = 0;
  let height = 0;

  if (rawFile) {
    // ── RAW: try cache first (Phase 5b stub) ──────────────────────────────────
    let cached: Buffer | null = null;
    try {
      // Dynamic import so the module not existing (pre-Phase-5b) is a graceful
      // cache miss, not a hard crash. Once raw-cache.ts is implemented the
      // import resolves normally with no code change needed here.
      const rawCache = await import('./raw-cache' as string) as {
        getCachedRawPreview: (p: string) => Promise<Buffer | null>;
        storeRawPreview: (p: string, buf: Buffer) => Promise<void>;
      };
      cached = await rawCache.getCachedRawPreview(absolutePath);
    } catch (err: any) {
      // MODULE_NOT_FOUND is expected in Phase 5 before raw-cache.ts is written.
      // Any other error is logged in dev mode but treated as a cache miss.
      if (err?.code !== 'MODULE_NOT_FOUND' && devMode) {
        console.warn(`[image-processor] raw-cache lookup failed for ${filename}:`, err.message);
      }
    }

    if (cached) {
      if (devMode) console.log(`[image-processor] ${filename} — raw cache HIT`);
      const result = await resizeToPreview(cached, PREVIEW_MAX_PX);
      buffer = result.buffer;
      width = result.width;
      height = result.height;
    } else {
      // Cache miss — full AI-quality decode.
      if (devMode) console.log(`[image-processor] ${filename} — raw cache MISS, decoding`);
      const { buffer: decoded } = await getAiScoringBuffer(absolutePath);
      const result = await resizeToPreview(decoded, PREVIEW_MAX_PX);
      buffer = result.buffer;
      width = result.width;
      height = result.height;

      // Store the DECODED buffer (pre-resize, full quality) for future cache hits.
      // The cache stores the raw decode output; resizing is always applied on load.
      try {
        const rawCache = await import('./raw-cache' as string) as {
          getCachedRawPreview: (p: string) => Promise<Buffer | null>;
          storeRawPreview: (p: string, buf: Buffer) => Promise<void>;
        };
        await rawCache.storeRawPreview(absolutePath, decoded);
      } catch {
        // Module not yet present (Phase 5b) or write failed — non-fatal.
      }
    }
  } else {
    // ── Non-RAW: read from disk and resize ────────────────────────────────────
    const raw = await fs.promises.readFile(absolutePath);
    const result = await resizeToPreview(raw, PREVIEW_MAX_PX);
    buffer = result.buffer;
    width = result.width;
    height = result.height;
  }

  const base64 = buffer.toString('base64');

  if (devMode) {
    console.log(
      `[image-processor] processImage ${filename} — ` +
      `${width}×${height} | ${(buffer.length / 1024).toFixed(0)} KB | id=${id}`,
    );
  }

  return {
    id,
    filePath: absolutePath,
    filename,
    isRaw: rawFile,
    base64,
    width,
    height,
    // faceMetadata is intentionally absent here; Phase 6 attaches it.
  };
}

// ---------------------------------------------------------------------------
// processFolder (async generator)
// ---------------------------------------------------------------------------

/**
 * Async generator that scans `folderPath` and yields one `ImageRecord` at a
 * time. Each image is processed (decoded, resized, base64-encoded) before the
 * next begins.
 *
 * ── Serial by design ──────────────────────────────────────────────────────────
 * Phase 5 processes images one at a time. This is intentional:
 *   • Native LibRaw is memory-intensive; concurrent decodes can exhaust RAM.
 *   • The generator contract (one yield per iteration) keeps memory bounded.
 *   • Phase 11 (Parallel Batching) replaces this with a concurrent p-limit pool.
 *     Do not add concurrency here to "pre-optimise".
 *
 * ── Cancellation ─────────────────────────────────────────────────────────────
 * Pass `options.signal` (an AbortSignal) to cancel mid-run. The generator
 * checks the signal before processing each file and stops cleanly. Phase 10
 * uses this to handle user-initiated cancellation from the UI.
 *
 * ── Error handling ───────────────────────────────────────────────────────────
 * Per-file errors (RawDecodeError, unreadable file) are caught and logged; the
 * generator skips the failed file and continues. Fatal errors (e.g., the folder
 * becoming unreadable mid-scan) are re-thrown.
 *
 * @param folderPath  Absolute path to the folder to process.
 * @param options     Filter and cancellation options.
 * @yields            One ImageRecord per successfully processed file.
 *
 * @example
 * for await (const record of processFolder('/photos', { signal: ac.signal })) {
 *   console.log(record.filename, record.width, record.height);
 * }
 */
export async function* processFolder(
  folderPath: string,
  options: ProcessFolderOptions = {},
): AsyncGenerator<ImageRecord> {
  const { signal, useEmbeddedPreview = true, ...scanOptions } = options;
  const devMode = process.env.NODE_ENV === 'development';

  const filePaths = await scanFolder(folderPath, scanOptions);

  if (devMode) {
    console.log(`[image-processor] processFolder — ${filePaths.length} files in ${folderPath}`);
  }

  for (const filePath of filePaths) {
    // Cancellation check before each file.
    if (signal?.aborted) {
      if (devMode) console.log('[image-processor] processFolder — aborted by signal');
      return;
    }

    try {
      const record = await processImage(filePath, useEmbeddedPreview);
      yield record;
    } catch (err) {
      // RawDecodeError and read failures are non-fatal — skip and continue.
      const filename = path.basename(filePath);
      if (err instanceof RawDecodeError) {
        console.warn(`[image-processor] Skipping ${filename} — RAW decode failed: ${err.reason}`);
      } else if (err instanceof Error) {
        console.warn(`[image-processor] Skipping ${filename} — ${err.message}`);
      } else {
        console.warn(`[image-processor] Skipping ${filename} — unknown error`);
      }
      // Do NOT re-throw; move on to the next file.
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — preview buffer (gallery display)
// ---------------------------------------------------------------------------

/**
 * Returns a ≤ PREVIEW_MAX_PX JPEG buffer suitable for gallery display in the
 * Results screen.
 *
 * For RAW files the routing depends on `useEmbeddedPreview`:
 *   true  → try extractEmbeddedJpeg() first; fall back to decodeRaw() if null.
 *   false → always decodeRaw() (highest fidelity, slower).
 *
 * For non-RAW files (JPEG, HEIC, PNG, …) the file is read from disk and
 * returned as a passthrough — sharp resizes it to ≤ PREVIEW_MAX_PX.
 *
 * @param filePath           Absolute path to the image file.
 * @param useEmbeddedPreview When true, attempt the fast embedded-preview path
 *                           for RAW files. Defaults to true.
 * @returns                  Preview buffer, source, and resized dimensions.
 * @throws                   RawDecodeError if full decode fails on a RAW file.
 *                           Throws a plain Error if a non-RAW file cannot be read.
 */
export async function getPreviewBuffer(
  filePath: string,
  useEmbeddedPreview = true,
): Promise<PreviewResult> {
  const devMode = process.env.NODE_ENV === 'development';
  const filename = path.basename(filePath);

  // ── Non-RAW fast path ──────────────────────────────────────────────────────
  if (!isRawFile(filePath)) {
    const raw = await fs.promises.readFile(filePath);
    const { buffer, width, height } = await resizeToPreview(raw, PREVIEW_MAX_PX);
    if (devMode) {
      console.log(`[image-processor] ${filename} — passthrough (non-RAW)`);
    }
    return { buffer, source: 'passthrough', width, height };
  }

  // ── RAW: attempt embedded preview ─────────────────────────────────────────
  if (useEmbeddedPreview) {
    const startNs = devMode ? process.hrtime.bigint() : 0n;
    const embedded = await extractEmbeddedJpeg(filePath);

    if (embedded !== null) {
      const { buffer, width, height } = await resizeToPreview(embedded, PREVIEW_MAX_PX);
      if (devMode) {
        const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        console.log(
          `[image-processor] ${filename} — embedded preview ` +
          `(${(buffer.length / 1024).toFixed(0)} KB, ${width}×${height}, ${ms.toFixed(1)} ms)`,
        );
      }
      return { buffer, source: 'embedded', width, height };
    }

    if (devMode) {
      console.log(
        `[image-processor] ${filename} — no usable embedded preview, ` +
        'falling back to full decode',
      );
    }
  }

  // ── RAW: full decode ───────────────────────────────────────────────────────
  const startNs = devMode ? process.hrtime.bigint() : 0n;
  const decoded = await decodeRaw(filePath);
  const { buffer, width, height } = await resizeToPreview(decoded, PREVIEW_MAX_PX);

  if (devMode) {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    console.log(
      `[image-processor] ${filename} — full decode ` +
      `(${(buffer.length / 1024).toFixed(0)} KB, ${width}×${height}, ${ms.toFixed(1)} ms)`,
    );
  }

  return { buffer, source: 'decoded', width, height };
}

// ---------------------------------------------------------------------------
// Public API — AI scoring buffer (always full quality)
// ---------------------------------------------------------------------------

/**
 * Returns a ≤ PREVIEW_MAX_PX JPEG buffer for AI scoring.
 *
 * Unlike getPreviewBuffer(), this function ALWAYS uses the full decodeRaw()
 * pipeline for RAW files — regardless of the useEmbeddedPreview setting.
 * This guarantees consistent, high-quality input for AI vision models and
 * prevents the embedded-preview path from affecting scoring results.
 *
 * For non-RAW files the behaviour is identical to getPreviewBuffer() with
 * useEmbeddedPreview = false (read from disk, resize).
 *
 * @param filePath  Absolute path to the image file.
 * @returns         Resized JPEG buffer, source, and dimensions.
 * @throws          RawDecodeError if decode fails on a RAW file.
 */
export async function getAiScoringBuffer(filePath: string): Promise<PreviewResult> {
  const devMode = process.env.NODE_ENV === 'development';
  const filename = path.basename(filePath);

  if (!isRawFile(filePath)) {
    const raw = await fs.promises.readFile(filePath);
    const { buffer, width, height } = await resizeToPreview(raw, PREVIEW_MAX_PX);
    return { buffer, source: 'passthrough', width, height };
  }

  const startNs = devMode ? process.hrtime.bigint() : 0n;
  const decoded = await decodeRaw(filePath);
  const { buffer, width, height } = await resizeToPreview(decoded, PREVIEW_MAX_PX);

  if (devMode) {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    console.log(
      `[image-processor] ${filename} — AI scoring decode ` +
      `(${(buffer.length / 1024).toFixed(0)} KB, ${width}×${height}, ${ms.toFixed(1)} ms)`,
    );
  }

  return { buffer, source: 'decoded', width, height };
}