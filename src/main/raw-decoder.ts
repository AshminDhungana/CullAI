/**
 * src/main/raw-decoder.ts
 *
 * RAW image decoder for the CullAI main process.
 *
 * Responsibilities:
 *   1. Identify RAW files by extension (isRawFile).
 *   2. Fast-path: extract the embedded JPEG preview from a RAW container
 *      without a full sensor decode (extractEmbeddedJpeg). Used for gallery
 *      thumbnails in the Results screen.
 *   3. Full-decode a RAW file to a JPEG Buffer via lightdrift-libraw (decodeRaw).
 *      Used for AI scoring — always bypasses the embedded preview.
 *   4. Surface decode failures as typed RawDecodeError instances.
 *   5. Log per-file decode timing in development mode.
 *
 * This module is MAIN-PROCESS ONLY — it wraps a native C++ addon (.node file)
 * that cannot run inside the Electron renderer or preload sandbox. Never import
 * this file from src/renderer or src/shared.
 *
 * ── Fast-path vs full-decode ──────────────────────────────────────────────────
 *
 *   extractEmbeddedJpeg()  →  gallery thumbnails (Results screen)
 *   decodeRaw()            →  AI scoring (always full sensor decode)
 *
 * The caller (image-processor.ts) decides which path to invoke. This module
 * is deliberately ignorant of AppSettings — the useEmbeddedPreview flag is
 * checked upstream. extractEmbeddedJpeg() returns null on any failure rather
 * than throwing, so the caller can fall back to decodeRaw() without a try/catch.
 *
 * ── Embedded preview quality ──────────────────────────────────────────────────
 *
 * Most modern cameras (Canon CR3, Nikon NEF, Sony ARW, Fuji RAF, Adobe DNG)
 * embed a full-resolution or near-full-resolution JPEG in the RAW container.
 * The LibRaw thumbnail pipeline extracts this pre-baked JPEG directly — no
 * demosaicing, no colour conversion — making it 5–20× faster than decodeRaw().
 *
 * Older cameras may only embed a small (2 MP or less) thumbnail. If the
 * extracted dimensions are below MIN_EMBEDDED_DIMENSION on either axis the
 * buffer is rejected (returns null) and the caller falls back to decodeRaw(),
 * which guarantees a full-resolution decode.
 *
 * ── License gate ─────────────────────────────────────────────────────────────
 *
 * The pipeline — not this module — is responsible for checking
 * isAllowed('rawFormats', tier) before calling either function. Both functions
 * decode unconditionally when invoked; access control lives upstream.
 *
 * ── RAW cache ────────────────────────────────────────────────────────────────
 *
 * The cache layer (Phase 5b) wraps decodeRaw(). extractEmbeddedJpeg() is fast
 * enough that caching its output is usually not worth the overhead, but the
 * caller may cache the result if it chooses.
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
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum pixel dimension (width or height) an embedded JPEG must have before
 * it is accepted as a valid preview. Thumbnails below this size are too small
 * to be useful in the Results gallery and trigger a full decodeRaw() fallback.
 *
 * 1024 px matches the pipeline's ≤1024 resize target: an embedded preview
 * smaller than this cannot be upscaled without visible artefacts.
 */
const MIN_EMBEDDED_DIMENSION = 1024;

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

// ---------------------------------------------------------------------------
// extractEmbeddedJpeg
// ---------------------------------------------------------------------------

/**
 * Extracts the embedded JPEG preview from a RAW file without running the
 * full sensor decode pipeline.
 *
 * ── What "embedded preview" means ────────────────────────────────────────────
 *
 * RAW containers (CR3, NEF, ARW, RAF, DNG, …) carry one or more JPEG images
 * alongside the raw sensor data. These are baked by the camera at capture time
 * using its own JPEG engine and internal colour profile. LibRaw exposes this
 * via `unpackThumbnail()` → `createThumbnailJPEGBuffer()`.
 *
 * ── Why this is faster than decodeRaw() ──────────────────────────────────────
 *
 * Full decode (decodeRaw) runs an entire dcraw demosaic pipeline: black-level
 * subtraction, white balance, AHD/DHT demosaicing, colour-space conversion,
 * gamma correction, and JPEG re-encode. This typically takes 500 ms – 3 s per
 * file. Thumbnail extraction skips all of that and just reads a pre-baked
 * JPEG from the file header — typically 30–150 ms.
 *
 * ── Quality caveat ───────────────────────────────────────────────────────────
 *
 * The extracted JPEG is the camera's own rendering. Colour accuracy and tonal
 * range vary by manufacturer and camera model. This is acceptable for gallery
 * display (Results screen) where we want a fast, visually representative
 * image. It is NOT acceptable for AI scoring, where we always use decodeRaw()
 * to get a consistent, fully-processed image.
 *
 * ── Minimum size guard ───────────────────────────────────────────────────────
 *
 * Some cameras embed only a small thumbnail (e.g. 160×120 or 1080p). If
 * either dimension of the extracted preview is below MIN_EMBEDDED_DIMENSION
 * (1024 px) the buffer is rejected and null is returned so the caller can
 * fall back to decodeRaw().
 *
 * ── Defensive API probing ────────────────────────────────────────────────────
 *
 * The `thumbOK()` method was found in the README but is not in the published
 * TypeScript declarations for lightdrift-libraw. We call it defensively via
 * type-cast; if it throws or is absent at runtime we catch and fall through.
 * `unpackThumbnail()` and `createThumbnailJPEGBuffer()` ARE in the official
 * declarations and are the primary extraction path.
 *
 * @param filePath  Absolute path to the RAW file.
 * @returns         JPEG Buffer from the embedded preview, or null if:
 *                  – no embedded preview exists,
 *                  – the embedded preview is too small (< MIN_EMBEDDED_DIMENSION),
 *                  – any step of the extraction throws.
 *                  Callers must fall back to decodeRaw() on null.
 *
 * @example
 * const buf = await extractEmbeddedJpeg('/photos/IMG_0001.CR3');
 * if (buf) {
 *   // Use fast embedded preview for gallery display
 * } else {
 *   // Fall back to full decode
 * }
 */
export async function extractEmbeddedJpeg(filePath: string): Promise<Buffer | null> {
  const filename = path.basename(filePath);
  const devMode = process.env.NODE_ENV === 'development';
  const startNs = devMode ? process.hrtime.bigint() : 0n;
  const processor = new LibRaw();

  try {
    // ── Step 1: Open the RAW container ─────────────────────────────────────
    await processor.loadFile(filePath);

    // ── Step 2: Check whether a usable thumbnail exists ────────────────────
    // thumbOK() is documented in the README but absent from the .d.ts file.
    // We call it defensively — if the method doesn't exist at runtime (older
    // package build) we catch the TypeError and proceed to unpackThumbnail()
    // anyway, relying on unpackThumbnail() itself to fail fast on missing data.
    let thumbAvailable = true;
    try {
      const thumbOK = (processor as any).thumbOK;
      if (typeof thumbOK === 'function') {
        thumbAvailable = await thumbOK.call(processor);
      }
    } catch {
      // thumbOK not available — assume a thumbnail may exist and let
      // unpackThumbnail() be the definitive check.
    }

    if (!thumbAvailable) {
      if (devMode) {
        console.log(`[raw-decoder] ${filename} — no embedded thumbnail (thumbOK=false)`);
      }
      return null;
    }

    // ── Step 3: Unpack the embedded thumbnail data ──────────────────────────
    // This reads the thumbnail bytes from the RAW container into memory.
    // It does NOT run any demosaic or colour-processing pipeline.
    await processor.unpackThumbnail();

    // ── Step 4: Encode as JPEG buffer ───────────────────────────────────────
    // createThumbnailJPEGBuffer() converts the unpacked data to a JPEG buffer.
    // We pass no maxSize so we get the full embedded dimensions — resizing to
    // ≤1024 px is the caller's responsibility (image-processor.ts).
    const result = await processor.createThumbnailJPEGBuffer({ quality: 90 });

    if (!result.success || !result.buffer || result.buffer.length === 0) {
      if (devMode) {
        console.log(`[raw-decoder] ${filename} — createThumbnailJPEGBuffer returned empty`);
      }
      return null;
    }

    // ── Step 5: Minimum dimension guard ────────────────────────────────────
    // Inspect the metadata dimensions if available; fall back to accepting
    // the buffer if metadata is absent (let the caller resize as needed).
    const outDims =
      result.metadata?.outputDimensions ??
      result.metadata?.dimensions ??
      result.metadata?.originalDimensions;

    if (outDims) {
      const { width, height } = outDims;
      if (width < MIN_EMBEDDED_DIMENSION || height < MIN_EMBEDDED_DIMENSION) {
        if (devMode) {
          console.log(
            `[raw-decoder] ${filename} — embedded preview too small ` +
            `(${width}×${height} < ${MIN_EMBEDDED_DIMENSION}px) — rejecting`,
          );
        }
        return null;
      }
    }

    // ── Dev-mode performance logging ────────────────────────────────────────
    if (devMode) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const kb = (result.buffer.length / 1024).toFixed(0);
      const dims = outDims ? `${outDims.width}×${outDims.height}` : 'dims unknown';
      console.log(
        `[raw-decoder] ${filename} — embedded preview extracted in ${elapsedMs.toFixed(1)} ms` +
        ` | ${dims} | ${kb} KB`,
      );
    }

    return result.buffer;

  } catch (err) {
    // Any error in the thumbnail path is non-fatal — return null so the caller
    // falls back to decodeRaw(). We log in dev mode for diagnosability.
    if (devMode) {
      console.warn(
        `[raw-decoder] ${filename} — embedded preview extraction failed, ` +
        `will fall back to full decode:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;

  } finally {
    // Always close to release the native C++ LibRaw instance.
    try {
      await processor.close();
    } catch (closeErr) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[raw-decoder] processor.close() failed for ${filename}:`, closeErr);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// decodeRaw
// ---------------------------------------------------------------------------

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