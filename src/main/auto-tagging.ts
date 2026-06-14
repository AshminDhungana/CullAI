/**
 * src/main/auto-tagging.ts
 *
 * Phase 13b — AI-Powered Auto-Tagging
 *
 * Generates 5–10 descriptive keyword tags for S-tier and A-tier keeper images
 * by making a separate, lightweight AI vision call after scoring is complete.
 * Keywords are written into each image's ScoreRecord and subsequently exported
 * into XMP sidecar files as <dc:subject> bags, making them searchable in
 * Lightroom Classic and Capture One.
 *
 * ── Design decisions ────────────────────────────────────────────────────────
 *
 *   Batching:   Up to 5 images per API call. Vision models handle multi-image
 *               requests in a single round-trip, reducing API latency and cost
 *               compared to one call per image.
 *
 *   Top-percent: Only the top `tagTopPercent`% of S+A keepers by composite
 *                score are tagged. Default is 20%. Prevents excessive API cost
 *                on large shoots while still covering the most important images.
 *
 *   Fault isolation: A parse failure on one batch logs a warning and skips
 *                that batch. It never propagates up to crash the pipeline.
 *
 *   Single-image fallback: If a provider does not support multi-image requests
 *                (common for some Ollama models), the module automatically
 *                retries each image individually. The flag is set the first
 *                time a batch fails with a non-auth, non-rate-limit error.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer.
 */

import type { ScoreRecord, AppSettings, AIProvider } from '../shared/types';
import { callAITagging } from './ai-client';
import { AIAuthError, AIRateLimitError } from './ai-errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum images per tagging API call. Vision models handle 5 comfortably. */
const BATCH_SIZE = 5;

/** Minimum keepers to tag regardless of tagTopPercent calculation. */
const MIN_TAG_COUNT = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaggingEntry = {
  /** Session score key (ImageRecord.id). */
  id: string;
  record: ScoreRecord;
  /** Base64-encoded JPEG (1024px preview or thumbnail). */
  imageBase64: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates AI keyword tags for the top-percent of S and A tier keepers.
 *
 * @param entries         All S+A tier images with their base64 previews.
 * @param settings        AppSettings for the current session (provider, model,
 *                        apiKey, baseUrl, tagTopPercent).
 * @returns               Map<id, string[]> — keywords keyed by ImageRecord.id.
 *                        Only includes entries that were successfully tagged.
 *
 * @remarks
 *   This function never throws. All errors are caught, logged, and result in
 *   the affected batch being skipped. The caller should treat a partial result
 *   map as success — some keywords are better than none.
 */
export async function runAutoTagging(
  entries: TaggingEntry[],
  settings: AppSettings,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const devMode = process.env.NODE_ENV === 'development';

  if (entries.length === 0) {
    if (devMode) console.log('[auto-tagging] No qualifying entries — skipping');
    return result;
  }

  // ── 1. Filter to top-percent of S+A by composite score ──────────────────
  const sorted = [...entries].sort((a, b) => b.record.total - a.record.total);
  const percent = Math.max(0, Math.min(100, settings.tagTopPercent ?? 20));
  const tagCount = Math.max(MIN_TAG_COUNT, Math.ceil(sorted.length * (percent / 100)));
  const toTag = sorted.slice(0, tagCount);

  if (devMode) {
    console.log(
      `[auto-tagging] Tagging ${toTag.length}/${sorted.length} keepers ` +
      `(top ${percent}% — tagTopPercent=${percent})`,
    );
  }

  // ── 2. Build provider params ─────────────────────────────────────────────
  const providerParams = {
    provider: settings.provider,
    apiKey:   settings.apiKey,
    model:    settings.model,
    baseUrl:  settings.baseUrl,
  };

  // ── 3. Batch loop with single-image fallback ─────────────────────────────
  let useSingleImageFallback = false;

  for (let i = 0; i < toTag.length; i += BATCH_SIZE) {
    const batch = toTag.slice(i, i + BATCH_SIZE);

    if (useSingleImageFallback) {
      // ── Fallback: tag one image at a time ──────────────────────────────
      for (const entry of batch) {
        await tagSingleEntry(entry, providerParams, result, devMode);
      }
    } else {
      // ── Happy path: batch of up to 5 images ───────────────────────────
      try {
        const batchKeywords = await callAITagging(
          batch.map(e => e.imageBase64),
          batch.map(e => e.record.filename),
          providerParams,
        );

        for (const entry of batch) {
          const keywords = batchKeywords[entry.record.filename];
          if (Array.isArray(keywords) && keywords.length > 0) {
            result.set(entry.id, keywords);
            if (devMode) {
              console.log(
                `[auto-tagging] Tagged ${entry.record.filename}: [${keywords.join(', ')}]`,
              );
            }
          }
        }
      } catch (err: unknown) {
        // Auth errors and rate-limit errors are hard failures — abort tagging.
        if (err instanceof AIAuthError) {
          console.error('[auto-tagging] Auth error — aborting tagging run:', err.message);
          return result;
        }
        if (err instanceof AIRateLimitError) {
          console.warn(
            `[auto-tagging] Rate limited (retry after ${err.retryAfter}s) — `,
            'aborting tagging run to avoid blocking the pipeline.',
          );
          return result;
        }

        // Other errors (parse failure, timeout, model capability) → try
        // single-image fallback for the remaining images.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[auto-tagging] Batch call failed — switching to single-image fallback: ${msg}`,
        );
        useSingleImageFallback = true;

        // Retry this batch's entries individually.
        for (const entry of batch) {
          await tagSingleEntry(entry, providerParams, result, devMode);
        }
      }
    }
  }

  if (devMode) {
    console.log(
      `[auto-tagging] Done — ${result.size}/${toTag.length} images tagged successfully`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ProviderParams = {
  provider: AIProvider;
  apiKey:   string;
  model:    string;
  baseUrl:  string;
};

/**
 * Tags a single image, suppressing errors so one bad image doesn't stop
 * the rest of the tagging run.
 */
async function tagSingleEntry(
  entry: TaggingEntry,
  params: ProviderParams,
  result: Map<string, string[]>,
  devMode: boolean,
): Promise<void> {
  try {
    const batchKeywords = await callAITagging(
      [entry.imageBase64],
      [entry.record.filename],
      params,
    );
    const keywords = batchKeywords[entry.record.filename];
    if (Array.isArray(keywords) && keywords.length > 0) {
      result.set(entry.id, keywords);
      if (devMode) {
        console.log(
          `[auto-tagging] (single) Tagged ${entry.record.filename}: [${keywords.join(', ')}]`,
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[auto-tagging] Failed to tag ${entry.record.filename}: ${msg}`);
  }
}