/**
 * src/main/image-processor.ts
 *
 * Preview buffer routing for the CullAI image pipeline.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   1. Expose `getPreviewBuffer()` — the single entry point the pipeline calls
 *      to obtain a ≤1024 px JPEG preview for gallery display (Results screen).
 *
 *   2. Route RAW files to either the fast embedded-preview path or the full
 *      sensor-decode path, based on `AppSettings.useEmbeddedPreview`.
 *
 *   3. Resize every preview to ≤ PREVIEW_MAX_PX on its longest side using
 *      sharp, so the renderer never receives a multi-megabyte buffer.
 *
 *   4. Expose `getAiScoringBuffer()` — always calls decodeRaw() regardless of
 *      the embedded-preview setting, guaranteeing consistent full-quality input
 *      for AI scoring. Non-RAW files are returned as-is (already JPEG/HEIC).
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
 *   • It does not manage the RAW decode cache (Phase 5b wraps decodeRaw).
 *   • It does not check license tier — the pipeline does that before calling here.
 *   • It does not read files from disk for non-RAW formats — callers supply paths
 *     and this module does the format-specific routing.
 *
 * ── Dependencies ─────────────────────────────────────────────────────────────
 *
 *   lightdrift-libraw — native addon (main process only)
 *   sharp             — Node.js image resizer (must be installed separately)
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isRawFile, extractEmbeddedJpeg, decodeRaw, RawDecodeError } from './raw-decoder';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum pixel dimension (width OR height) for any preview buffer returned
 * by getPreviewBuffer(). Images larger than this are downscaled while
 * preserving the original aspect ratio.
 *
 * 1024 px is chosen to:
 *   • Exceed the minimum quality needed by AI vision models.
 *   • Keep base64-encoded payloads under ~400 KB (typical CR3 @ 1024 px).
 *   • Match the minimum size guard in extractEmbeddedJpeg().
 */
export const PREVIEW_MAX_PX = 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Source of the preview buffer. Logged per-file in development mode and
 * available to callers for metrics/debugging.
 *
 * - 'embedded'  Fast path: extracted from the RAW container's embedded JPEG.
 * - 'decoded'   Slow path: full sensor decode via LibRaw demosaic pipeline.
 * - 'passthrough' Non-RAW file: read from disk as-is (JPEG / HEIC).
 */
export type PreviewSource = 'embedded' | 'decoded' | 'passthrough';

export interface PreviewResult {
  /** JPEG buffer resized to ≤ PREVIEW_MAX_PX px on the longest side. */
  buffer: Buffer;
  /** How the buffer was produced. */
  source: PreviewSource;
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
 * Returns the original buffer unchanged if sharp is unavailable or if the
 * image is already small enough.
 *
 * @param input   JPEG (or any sharp-supported) buffer.
 * @param maxPx   Maximum pixel dimension on the longest side.
 * @returns       JPEG buffer, resized if necessary.
 */
async function resizeToPreview(input: Buffer, maxPx: number): Promise<Buffer> {
  const sharp = await getSharp();
  if (!sharp) return input; // sharp not available — skip resize

  // Let sharp read the dimensions before committing to a resize operation.
  // This avoids an unnecessary re-encode when the image is already small.
  const meta = await (sharp as any)(input).metadata();
  const { width = 0, height = 0 } = meta;

  if (width <= maxPx && height <= maxPx) return input;

  const resized = await (sharp as any)(input)
    .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  return resized;
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
 * @returns                  Preview buffer and the source that produced it.
 * @throws                   RawDecodeError if full decode fails on a RAW file.
 *                           Throws a plain Error if a non-RAW file cannot be read.
 *
 * @example
 * const { buffer, source } = await getPreviewBuffer('/photos/IMG_0001.CR3');
 * // source → 'embedded' | 'decoded'
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
    const buffer = await resizeToPreview(raw, PREVIEW_MAX_PX);
    if (devMode) {
      console.log(`[image-processor] ${filename} — passthrough (non-RAW)`);
    }
    return { buffer, source: 'passthrough' };
  }

  // ── RAW: attempt embedded preview ─────────────────────────────────────────
  if (useEmbeddedPreview) {
    const startNs = devMode ? process.hrtime.bigint() : 0n;
    const embedded = await extractEmbeddedJpeg(filePath);

    if (embedded !== null) {
      const buffer = await resizeToPreview(embedded, PREVIEW_MAX_PX);
      if (devMode) {
        const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        console.log(
          `[image-processor] ${filename} — embedded preview ` +
          `(${(buffer.length / 1024).toFixed(0)} KB after resize, ${ms.toFixed(1)} ms total)`,
        );
      }
      return { buffer, source: 'embedded' };
    }

    // Embedded path returned null → fall through to full decode.
    if (devMode) {
      console.log(
        `[image-processor] ${filename} — no usable embedded preview, ` +
        'falling back to full decode',
      );
    }
  }

  // ── RAW: full decode (always used for AI scoring; fallback for previews) ──
  const startNs = devMode ? process.hrtime.bigint() : 0n;
  const decoded = await decodeRaw(filePath); // throws RawDecodeError on failure
  const buffer = await resizeToPreview(decoded, PREVIEW_MAX_PX);

  if (devMode) {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    console.log(
      `[image-processor] ${filename} — full decode ` +
      `(${(buffer.length / 1024).toFixed(0)} KB after resize, ${ms.toFixed(1)} ms total)`,
    );
  }

  return { buffer, source: 'decoded' };
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
 * @returns         Resized JPEG buffer and the source ('decoded' | 'passthrough').
 * @throws          RawDecodeError if decode fails on a RAW file.
 *
 * @example
 * const { buffer } = await getAiScoringBuffer('/photos/IMG_0001.CR3');
 * const base64 = buffer.toString('base64');
 */
export async function getAiScoringBuffer(filePath: string): Promise<PreviewResult> {
  const devMode = process.env.NODE_ENV === 'development';
  const filename = path.basename(filePath);

  if (!isRawFile(filePath)) {
    const raw = await fs.promises.readFile(filePath);
    const buffer = await resizeToPreview(raw, PREVIEW_MAX_PX);
    return { buffer, source: 'passthrough' };
  }

  const startNs = devMode ? process.hrtime.bigint() : 0n;
  const decoded = await decodeRaw(filePath);
  const buffer = await resizeToPreview(decoded, PREVIEW_MAX_PX);

  if (devMode) {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    console.log(
      `[image-processor] ${filename} — AI scoring decode ` +
      `(${(buffer.length / 1024).toFixed(0)} KB, ${ms.toFixed(1)} ms)`,
    );
  }

  return { buffer, source: 'decoded' };
}