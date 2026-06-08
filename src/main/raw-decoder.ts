/**
 * src/main/raw-decoder.ts
 *
 * RAW image decoder for the CullAI main process.
 *
 * Responsibilities:
 *   1. Identify RAW files by extension (isRawFile).
 *   2. Full-decode a RAW file to a JPEG Buffer via lightdrift-libraw (decodeRaw).
 *   3. Surface decode failures as typed RawDecodeError instances.
 *   4. Log per-file decode timing in development mode.
 *
 * This module is MAIN-PROCESS ONLY — it wraps a native C++ addon (.node file)
 * that cannot run inside the Electron renderer or preload sandbox. Never import
 * this file from src/renderer or src/shared.
 *
 * Downstream usage (Phase 5):
 *   The image-pipeline will call isRawFile() to branch on format, then call
 *   decodeRaw() to get a full-resolution JPEG buffer, which it resizes to a
 *   1024 px preview before base64-encoding for the AI provider.
 *
 * License gate (Phase 5):
 *   The pipeline — not this module — is responsible for checking
 *   isAllowed('rawFormats', tier) before calling decodeRaw(). This module
 *   decodes unconditionally when invoked; access control lives upstream.
 *
 * RAW cache (Phase 5b):
 *   The cache layer will wrap decodeRaw() — call it on a miss, store the
 *   result keyed by (filePath + mtime), return the cached buffer on a hit.
 *   This module stays pure and cache-unaware.
 */

import * as path from 'path';
import LibRaw from 'lightdrift-libraw';

// ---------------------------------------------------------------------------
// Supported RAW extensions
// ---------------------------------------------------------------------------

/**
 * Lowercase dot-prefixed extensions recognised as RAW files.
 *
 * Covers the major manufacturer formats supported by LibRaw:
 *   Canon   .cr2 .cr3
 *   Nikon   .nef .nrw
 *   Sony    .arw .sr2
 *   Fuji    .raf
 *   Adobe   .dng
 *   Olympus .orf
 *   Pana    .rw2
 *   Pentax  .pef
 *   Hasselblad .3fr
 *
 * Keep in sync with the extension filter options shown in Setup → Options.
 * All entries must be lowercase; isRawFile() lowercases before comparing.
 */
export const RAW_EXTENSIONS = [
  '.cr2',
  '.cr3',
  '.nef',
  '.nrw',
  '.arw',
  '.sr2',
  '.raf',
  '.dng',
  '.orf',
  '.rw2',
  '.pef',
  '.3fr',
] as const;

// Derive a plain string[] type for runtime `.includes()` checks without
// casting the entire tuple to string[] at every call site.
type RawExtension = (typeof RAW_EXTENSIONS)[number];

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown by decodeRaw() when a RAW file cannot be processed.
 *
 * @property filename  Basename of the file that failed (no directory path),
 *                     safe to display in the renderer.
 * @property reason    Human-readable description of what went wrong, sourced
 *                     from the underlying LibRaw or Sharp error message.
 *
 * Callers should catch this specifically to distinguish decode failures from
 * other unexpected errors:
 *
 * @example
 * try {
 *   const buf = await decodeRaw('/photos/IMG_0001.CR3');
 * } catch (err) {
 *   if (err instanceof RawDecodeError) {
 *     console.warn(`Skipping ${err.filename}: ${err.reason}`);
 *   } else {
 *     throw err; // unexpected — re-throw
 *   }
 * }
 */
export class RawDecodeError extends Error {
  readonly filename: string;
  readonly reason: string;

  constructor(filename: string, reason: string, cause?: unknown) {
    super(`RAW decode failed [${filename}]: ${reason}`);
    this.name = 'RawDecodeError';
    this.filename = filename;
    this.reason = reason;

    // Append the original stack so developers can trace native LibRaw errors
    // without having to separately log the `cause`. Kept out of the public API
    // surface to avoid leaking internal paths in renderer-bound error objects.
    if (cause instanceof Error && cause.stack) {
      this.stack += `\nCaused by: ${cause.stack}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if `filePath` has a RAW file extension.
 *
 * Comparison is always case-insensitive so both `IMG_0001.CR3` and
 * `img_0001.cr3` are recognised correctly on case-sensitive file systems
 * (Linux) and case-insensitive ones (macOS, Windows NTFS).
 *
 * @example
 * isRawFile('/photos/IMG_0001.CR3')  // true
 * isRawFile('/photos/IMG_0001.JPG')  // false
 * isRawFile('/photos/.cullaiignore') // false
 */
export function isRawFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase() as RawExtension;
  // Cast to readonly string[] to satisfy TS — RAW_EXTENSIONS is a const tuple.
  return (RAW_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Full-decodes a RAW file and returns a JPEG Buffer.
 *
 * Uses lightdrift-libraw's full processing pipeline:
 *   loadFile()      — open and parse the RAW container
 *   processImage()  — run the full dcraw-compatible demosaic pipeline
 *                     (exposure, white balance, colour space conversion).
 *                     This is a full sensor decode, NOT an embedded thumbnail.
 *   createJPEGBuffer({ quality: 100 }) — encode the processed RGB data to
 *                     lossless-quality JPEG in memory, no temp files.
 *
 * The returned buffer is a standard JPEG at the camera's native resolution.
 * Downstream callers (Phase 5 image pipeline) are responsible for resizing
 * it to a ≤1024 px preview before base64-encoding for the AI provider.
 *
 * The LibRaw processor instance is always recycled in the `finally` block,
 * even on error. Skipping close() leaks a native C++ heap allocation.
 *
 * @param filePath  Absolute path to the RAW file.
 * @returns         JPEG-encoded Buffer at full camera resolution, quality 100.
 * @throws          RawDecodeError if loading, processing, or encoding fails.
 *
 * @example
 * const buf = await decodeRaw('/photos/IMG_0001.CR3');
 * console.log(`Decoded ${buf.length} bytes`);
 */
export async function decodeRaw(filePath: string): Promise<Buffer> {
  const filename = path.basename(filePath);
  const processor = new LibRaw();

  // Capture start time before any async work so timing includes loadFile().
  // hrtime.bigint() is monotonic and nanosecond-precise — better than Date.now().
  const devMode = process.env.NODE_ENV === 'development';
  const startNs = devMode ? process.hrtime.bigint() : 0n;

  try {
    // ── Step 1: Open and parse the RAW container ────────────────────────────
    // loadFile() reads the file header and decodes metadata. It does NOT yet
    // decode the full sensor data — that happens in processImage().
    await processor.loadFile(filePath);

    // ── Step 2: Full sensor decode ──────────────────────────────────────────
    // processImage() runs the complete dcraw demosaic pipeline:
    //   • Black-level subtraction
    //   • White balance (camera or auto)
    //   • Demosaicing (AHD / DHT depending on LibRaw build)
    //   • Colour space conversion (→ sRGB)
    //   • Gamma correction
    //
    // This is intentionally a FULL decode of the sensor data, not an extraction
    // of the smaller embedded JPEG thumbnail that most RAW files carry. The
    // embedded thumbnail is typically 1080p or smaller and lacks the full tonal
    // range needed for accurate AI scoring.
    await processor.processImage();

    // ── Step 3: Encode to JPEG buffer in memory ─────────────────────────────
    // quality: 100 preserves all detail at this stage. The pipeline (Phase 5)
    // will resize to ≤1024 px before sending to the AI, so we want zero lossy
    // compression artifacts in the intermediate buffer.
    // mozjpeg defaults to true in the library; keep it for smaller output size
    // even at quality 100.
    const result = await processor.createJPEGBuffer({ quality: 100 });

    // Defensive check: the library should throw on failure, but guard anyway.
    if (!result.success || !result.buffer || result.buffer.length === 0) {
      throw new RawDecodeError(
        filename,
        'createJPEGBuffer returned an empty or failed result',
      );
    }

    // ── Dev-mode performance logging ────────────────────────────────────────
    if (devMode) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const kb = (result.buffer.length / 1024).toFixed(0);
      console.log(
        `[raw-decoder] ${filename} — decoded in ${elapsedMs.toFixed(1)} ms` +
        ` | output: ${kb} KB`,
      );
    }

    return result.buffer;

  } catch (err) {
    // Re-throw RawDecodeErrors unchanged (already typed and annotated).
    if (err instanceof RawDecodeError) throw err;

    // Wrap all other errors (LibRaw native errors, Sharp errors, etc.) into a
    // typed RawDecodeError so callers have a single catch target.
    throw new RawDecodeError(
      filename,
      err instanceof Error ? err.message : String(err),
      err,
    );

  } finally {
    // Always close the processor to release the native C++ LibRaw instance.
    // The inner try/catch prevents a close() failure from masking the original
    // error — a common pitfall with async finally blocks.
    try {
      await processor.close();
    } catch (closeErr) {
      if (devMode) {
        console.warn(
          `[raw-decoder] processor.close() failed for ${filename}:`,
          closeErr,
        );
      }
    }
  }
}