/**
 * src/main/orchestrator.ts
 *
 * Phase 10 — Full Batch Pipeline (Serial)
 *
 * Implements the three core pipeline functions:
 *
 *   runDiscoveryPass(images, settings, apiKey)
 *     → Samples 5–8 images, calls the AI once for a plain-text shoot summary.
 *       If a reference image is set, it is prepended to the sample set.
 *
 *   assignTiers(entries)
 *     → Pure function. Sorts by composite score, assigns S/A/B/rejected tiers
 *       using percentile cutoffs, then applies an absolute floor (total < 30 →
 *       rejected regardless of percentile).
 *
 *   runPipeline(settings, senderId, signal)
 *     → AsyncGenerator<PipelineEvent>. The full serial pipeline:
 *       scan → §10.5 input-count validation → processFolder → duplicate
 *       detection → face detection → discovery pass → createSession →
 *       serial scoring loop → tier assignment → shortfall summary →
 *       markSessionComplete.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import { scanFolder, processFolder } from './image-processor';
import { walkFolders } from './folder-walker';
import * as fs from 'fs';
import * as path from 'path';
import { groupDuplicates } from './duplicate-detector';
import { detectFaces } from './face-detector';
import {
  buildDiscoveryPrompt,
  callAIDiscovery,
  scoreImage,
} from './ai-client';
import {
  createSession,
  saveScore,
  saveDiscoveryContext,
  saveShortfallReasons,
  markSessionComplete,
  markSessionCancelled,
  loadSession,
} from './session-manager';

import type {
  AppSettings,
  ImageRecord,
  ScoreRecord,
  ShortfallReasons,
  PipelineEvent,
  FaceMetadata,
  StyleProfile,
  AICallParams,
  GenrePreset,
} from '../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Absolute quality floor. Any image with a composite total below this value
 * is demoted to 'rejected' regardless of its percentile rank.
 */
const QUALITY_FLOOR = 30;

/**
 * Tier percentile thresholds (of the scorable pool, excluding pre-rejected).
 * S: top 10%, A: next 30%, B: next 30%, rejected: bottom 30%.
 */
const TIER_PERCENTILES = { S: 0.10, A: 0.30, B: 0.30 } as const;

/**
 * Discovery pass sample count: 5% of the image set, clamped to [5, 8].
 */
const DISCOVERY_MIN_SAMPLES = 5;
const DISCOVERY_MAX_SAMPLES = 8;

/**
 * Safe empty FaceMetadata used for pre-rejected images that were never scored.
 */
const EMPTY_FACE_METADATA: FaceMetadata = {
  hasFaces: false,
  faceCount: 0,
  eyesOpen: true,
  blinkDetected: false,
  expressionNeutral: true,
  boundingBoxes: [],
  exceedsFaceLimit: false,
};

// ---------------------------------------------------------------------------
// Module-level confirmation-pause registry
//
// When the pipeline hits §10.5 (requested > available), it yields a
// 'pipeline-needs-confirmation' event and then awaits a Promise stored here.
// The IPC handler calls resolve() when 'pipeline-confirm-continue' fires, or
// reject() when 'pipeline-cancel' fires.
//
// Keyed by webContents.id (senderId) so concurrent windows are isolated.
// ---------------------------------------------------------------------------

type ConfirmationHandle = {
  resolve: () => void;
  reject: (reason: Error) => void;
};

const pendingConfirmations = new Map<number, ConfirmationHandle>();

/**
 * Called by the 'pipeline-confirm-continue' IPC handler to resume a paused
 * pipeline generator.
 */
export function resolvePipelineConfirmation(senderId: number): void {
  pendingConfirmations.get(senderId)?.resolve();
  pendingConfirmations.delete(senderId);
}

/**
 * Called by the 'pipeline-cancel' IPC handler to abort a paused pipeline
 * generator that is waiting for §10.5 confirmation.
 */
export function rejectPipelineConfirmation(senderId: number): void {
  pendingConfirmations.get(senderId)?.reject(new Error('Pipeline cancelled by user'));
  pendingConfirmations.delete(senderId);
}

// ---------------------------------------------------------------------------
// 10.1 runDiscoveryPass
// ---------------------------------------------------------------------------

/**
 * Selects 5–8 evenly-spaced representative images from the full set, optionally
 * prepends the reference image, and makes a single multi-image AI call to
 * produce a plain-text shoot summary.
 *
 * The summary is stored in the session as `discoveryContext` and threaded into
 * every subsequent individual scoring prompt.
 *
 * @param images   Full array of representative ImageRecords (post-dedup).
 * @param settings AppSettings for the current session.
 * @param apiKey   Decrypted API key for the provider.
 * @returns        Plain-text discovery context string. Empty string on failure
 *                 (non-fatal — scoring proceeds without context).
 */
export async function runDiscoveryPass(
  images: ImageRecord[],
  settings: AppSettings,
  apiKey: string,
): Promise<string> {
  if (images.length === 0) return '';

  const devMode = process.env.NODE_ENV === 'development';

  // ── 1. Select sample images ───────────────────────────────────────────────
  const sampleCount = Math.min(
    DISCOVERY_MAX_SAMPLES,
    Math.max(DISCOVERY_MIN_SAMPLES, Math.ceil(images.length * 0.05)),
  );

  // Evenly-spaced indices including first and last.
  const sampleIndices = selectEvenlySpaced(images.length, sampleCount);
  const sampleBase64s: string[] = sampleIndices.map((i) => images[i].base64);

  // Prepend reference image if set.
  if (settings.referenceImage) {
    sampleBase64s.unshift(settings.referenceImage.base64);
  }

  if (devMode) {
    console.log(
      `[orchestrator] Discovery pass: ${sampleBase64s.length} image(s) ` +
      `(${sampleCount} sampled${settings.referenceImage ? ' + 1 reference' : ''})`,
    );
  }

  // ── 2. Build prompt and call AI ───────────────────────────────────────────
  const prompt = buildDiscoveryPrompt(settings.genre as GenrePreset, sampleBase64s.length);

  try {
    const context = await callAIDiscovery(sampleBase64s, prompt, {
      provider: settings.provider,
      apiKey,
      model: settings.model,
      baseUrl: settings.baseUrl,
    });

    if (devMode) {
      console.log(`[orchestrator] Discovery context: "${context.slice(0, 120)}…"`);
    }

    return context;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[orchestrator] Discovery pass failed (proceeding without context): ${msg}`);
    return '';
  }
}

// ---------------------------------------------------------------------------
// 10.4 assignTiers
// ---------------------------------------------------------------------------

/**
 * Assigns S/A/B/rejected tiers to all scored images using relative percentiles.
 *
 * Algorithm:
 *   1. Separate pre-rejected images (face limit exceeded) from the scorable pool.
 *   2. Sort the scorable pool by `total` score descending.
 *   3. Assign tiers by percentile slice:
 *        S = top 10% (min 1 if pool is non-empty)
 *        A = next 30%
 *        B = next 30%
 *        rejected = bottom 30%
 *   4. Second pass: demote any image with total < QUALITY_FLOOR to 'rejected'.
 *   5. Pre-rejected images keep tier: 'rejected' unchanged.
 *
 * Mutates the `tier` field on each ScoreRecord in place and returns the full
 * array (scorable pool + pre-rejected).
 *
 * @param entries  Array of { id, record } pairs for all images in the session.
 * @returns        Same array with `record.tier` updated.
 */
export function assignTiers(
  entries: Array<{ id: string; record: ScoreRecord }>,
): Array<{ id: string; record: ScoreRecord }> {
  // ── 1. Partition ──────────────────────────────────────────────────────────
  const preRejected = entries.filter((e) => e.record.faceMetadata.exceedsFaceLimit);
  const pool = entries.filter((e) => !e.record.faceMetadata.exceedsFaceLimit);

  if (pool.length === 0) return entries;

  // ── 2. Sort descending by total ───────────────────────────────────────────
  pool.sort((a, b) => b.record.total - a.record.total);

  // ── 3. Percentile tier assignment ─────────────────────────────────────────
  const N = pool.length;
  const sCount = Math.max(1, Math.ceil(N * TIER_PERCENTILES.S));
  const aCount = Math.ceil(N * TIER_PERCENTILES.A);
  const bCount = Math.ceil(N * TIER_PERCENTILES.B);

  pool.forEach((entry, idx) => {
    if (idx < sCount) {
      entry.record.tier = 'S';
    } else if (idx < sCount + aCount) {
      entry.record.tier = 'A';
    } else if (idx < sCount + aCount + bCount) {
      entry.record.tier = 'B';
    } else {
      entry.record.tier = 'rejected';
    }
  });

  // ── 4. Absolute quality floor — apply after percentile pass ───────────────
  for (const entry of pool) {
    if (entry.record.total < QUALITY_FLOOR) {
      entry.record.tier = 'rejected';
    }
  }

  // Pre-rejected keep their tier unchanged (already 'rejected').
  return [...pool, ...preRejected];
}

// ---------------------------------------------------------------------------
// 10.2 runPipeline — the main async generator
// ---------------------------------------------------------------------------

/**
 * Runs the full culling pipeline for the given settings.
 *
 * When settings.processSubfolders is false (default), behaves exactly as
 * before — single batch, single session.
 *
 * When settings.processSubfolders is true, discovers all subdirectories,
 * processes each as a separate batch, and emits batch progress events
 * throughout. A combined pipeline-complete event is emitted at the end
 * using the last batch's session.
 */
export async function* runPipeline(
  settings: AppSettings,
  senderId: number,
  signal: AbortSignal,
): AsyncGenerator<PipelineEvent> {
  if (!settings.processSubfolders) {
    // ── Single-folder mode (existing behaviour) ──────────────────────────────
    yield* _runSingleFolderBatch(settings, settings.inputFolder, senderId, signal, {
      batchIndex: 1,
      totalBatches: 1,
    });
    return;
  }

  // ── Multi-folder mode (Phase 10b) ────────────────────────────────────────
  const devMode = process.env.NODE_ENV === 'development';

  let subfolders: string[];
  try {
    subfolders = await walkFolders(settings.inputFolder);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    yield {
      type: 'pipeline-error',
      code: 'WALK_FAILED',
      message: `Failed to walk subfolders: ${msg}`,
      recoverable: false,
    };
    return;
  }

  if (devMode) {
    console.log(`[orchestrator] Phase 10b: ${subfolders.length} folder(s) to process`);
  }

  const totalBatches = subfolders.length;
  let masterSession: import('../shared/types').Session | null = null;

  for (let batchIdx = 0; batchIdx < subfolders.length; batchIdx++) {
    if (signal.aborted) break;

    const relFolder = subfolders[batchIdx];
    const absoluteFolderPath = relFolder === ''
      ? settings.inputFolder
      : path.join(settings.inputFolder, relFolder);

    // Determine batch output folder
    let batchOutputFolder: string;
    if (settings.preserveSubfolderStructure && relFolder !== '') {
      batchOutputFolder = path.join(settings.outputFolder, relFolder);
    } else {
      batchOutputFolder = settings.outputFolder;
    }

    // Ensure batch output folder exists
    await fs.promises.mkdir(path.resolve(batchOutputFolder), { recursive: true });

    const folderName = relFolder === ''
      ? path.basename(settings.inputFolder)
      : path.basename(relFolder);

    // Quick scan to get image count for the batch header event
    let batchFilePaths: string[] = [];
    try {
      batchFilePaths = await scanFolder(absoluteFolderPath, {
        extensions: settings.extensionFilter,
        prefixes: settings.prefixFilter,
        prefixCaseInsensitive: settings.prefixCaseInsensitive,
        ignorePatterns: settings.ignorePatterns,
        recursive: false,
      });
    } catch { /* emit 0 — batch will handle its own error */ }

    yield {
      type: 'pipeline-batch-started',
      batchIndex: batchIdx + 1,
      totalBatches,
      folderName,
      batchImageCount: batchFilePaths.length,
    };

    // Build per-batch settings (override input/output folders only)
    const batchSettings: AppSettings = {
      ...settings,
      inputFolder: absoluteFolderPath,
      outputFolder: batchOutputFolder,
      processSubfolders: false, // Prevent infinite recursion
    };

    // Run the batch and forward all events except pipeline-complete
    // (we emit our own combined complete at the end)
    for await (const event of _runSingleFolderBatch(
      batchSettings,
      absoluteFolderPath,
      senderId,
      signal,
      { batchIndex: batchIdx + 1, totalBatches },
    )) {
      if (event.type === 'pipeline-complete') {
        masterSession = event.session;
        // Don't yield — we emit our own combined complete at the very end
        continue;
      }
      // Re-emit all other events to the renderer unchanged
      yield event;
    }

    yield {
      type: 'pipeline-batch-complete',
      batchIndex: batchIdx + 1,
      totalBatches,
    };

    if (signal.aborted) break;
  }

  // Emit the final complete event using the last batch's session as a proxy.
  if (masterSession) {
    yield { type: 'pipeline-complete', session: masterSession };
  }
}

// ---------------------------------------------------------------------------
// Internal: single-folder pipeline batch
// ---------------------------------------------------------------------------

/**
 * Runs the full serial culling pipeline for one folder.
 *
 * This is the original runPipeline body, extracted so it can be called
 * once in single-folder mode or N times in multi-folder mode.
 */
async function* _runSingleFolderBatch(
  settings: AppSettings,
  folderPath: string,
  senderId: number,
  signal: AbortSignal,
  _batchMeta: { batchIndex: number; totalBatches: number },
): AsyncGenerator<PipelineEvent> {
  const devMode = process.env.NODE_ENV === 'development';
  const apiKey = settings.apiKey;

  // ── Helper: check abort and mark session cancelled ────────────────────────
  const checkAbort = async (outputFolder?: string): Promise<boolean> => {
    if (!signal.aborted) return false;
    if (outputFolder) {
      try { await markSessionCancelled(outputFolder); } catch { /* non-fatal */ }
    }
    return true;
  };

  // =========================================================================
  // Step 1 — Scan folder to get file count (for §10.5 validation)
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 1: scanning folder');

  let filePaths: string[];
  try {
    filePaths = await scanFolder(settings.inputFolder, {
      extensions: settings.extensionFilter,
      prefixes: settings.prefixFilter,
      prefixCaseInsensitive: settings.prefixCaseInsensitive,
      ignorePatterns: settings.ignorePatterns,
      recursive: false, // Each batch is its own folder — walkFolders handles multi-folder dispatch
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'pipeline-error', code: 'SCAN_FAILED', message: `Failed to scan folder: ${msg}`, recoverable: false };
    return;
  }

  if (await checkAbort()) return;

  // =========================================================================
  // Step 2 — §10.5 Input count validation
  // =========================================================================

  if (
    settings.numImagesToSelect > 0 &&
    filePaths.length < settings.numImagesToSelect
  ) {
    if (devMode) {
      console.log(
        `[orchestrator] §10.5: requested ${settings.numImagesToSelect}, ` +
        `found ${filePaths.length} — awaiting user confirmation`,
      );
    }

    yield {
      type: 'pipeline-needs-confirmation',
      requested: settings.numImagesToSelect,
      available: filePaths.length,
    };

    // Pause the generator until the IPC handler resolves or rejects.
    try {
      await new Promise<void>((resolve, reject) => {
        pendingConfirmations.set(senderId, { resolve, reject });
      });
    } catch {
      // User cancelled at the confirmation dialog.
      return;
    }

    if (await checkAbort()) return;
  }

  // =========================================================================
  // Step 3 — processFolder → ImageRecord[]
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 3: processing folder into ImageRecords');

  const allRecords: ImageRecord[] = [];
  try {
    for await (const record of processFolder(settings.inputFolder, {
      extensions: settings.extensionFilter,
      prefixes: settings.prefixFilter,
      prefixCaseInsensitive: settings.prefixCaseInsensitive,
      ignorePatterns: settings.ignorePatterns,
      recursive: false, // Each batch is its own folder — walkFolders handles multi-folder dispatch
      useEmbeddedPreview: settings.useEmbeddedPreview,
      signal,
    })) {
      if (signal.aborted) break;
      allRecords.push(record);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'pipeline-error', code: 'PROCESS_FAILED', message: `Failed to process images: ${msg}`, recoverable: false };
    return;
  }

  if (await checkAbort()) return;

  if (allRecords.length === 0) {
    yield { type: 'pipeline-error', code: 'NO_IMAGES', message: 'No processable images found in the selected folder.', recoverable: false };
    return;
  }

  // =========================================================================
  // Step 4 — Duplicate / burst detection
  // =========================================================================

  if (devMode) console.log(`[orchestrator] Step 4: duplicate detection on ${allRecords.length} images`);

  let representatives: ImageRecord[];
  let duplicatesSkipped = 0;

  if (settings.disableDuplicateGrouping) {
    representatives = allRecords;
  } else {
    try {
      const groups = await groupDuplicates(allRecords, settings.duplicateThreshold);
      representatives = groups.map((g) => g.representative);
      duplicatesSkipped = allRecords.length - representatives.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[orchestrator] Duplicate detection failed, continuing without grouping: ${msg}`);
      representatives = allRecords;
    }
  }

  if (devMode) {
    console.log(
      `[orchestrator] ${allRecords.length} images → ${representatives.length} representatives ` +
      `(${duplicatesSkipped} duplicates suppressed)`,
    );
  }

  if (await checkAbort()) return;

  // =========================================================================
  // Step 5 — Face detection on all representatives
  // =========================================================================

  if (devMode) console.log(`[orchestrator] Step 5: face detection on ${representatives.length} representatives`);

  let exceededFaceLimit = 0;
  let faceDetectionFailed = 0;

  for (const rep of representatives) {
    if (signal.aborted) break;
    try {
      const buf = Buffer.from(rep.base64, 'base64');
      const meta = await detectFaces(buf, settings.maxFacesPerImage);
      rep.faceMetadata = meta;
      if (meta.exceedsFaceLimit) exceededFaceLimit++;
    } catch {
      // detectFaces is documented to never throw, but guard anyway.
      rep.faceMetadata = EMPTY_FACE_METADATA;
      faceDetectionFailed++;
    }
  }

  if (await checkAbort()) return;

  // =========================================================================
  // Step 6 — Discovery pass
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 6: discovery pass');

  const discoveryContext = await runDiscoveryPass(representatives, settings, apiKey);

  if (await checkAbort()) return;

  // =========================================================================
  // Step 7 — Create session
  // =========================================================================

  // scorable = representatives that are NOT pre-rejected by face limit
  const scorableReps = representatives.filter(
    (r) => !r.faceMetadata?.exceedsFaceLimit,
  );

  if (devMode) {
    console.log(
      `[orchestrator] Step 7: creating session — ${scorableReps.length} scorable images ` +
      `(${exceededFaceLimit} pre-rejected by face limit)`,
    );
  }

  let session: import('../shared/types').Session;
  try {
    session = await createSession(settings, scorableReps.length);
    await saveDiscoveryContext(settings.outputFolder, discoveryContext);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'pipeline-error', code: 'SESSION_CREATE_FAILED', message: `Failed to create session: ${msg}`, recoverable: false };
    return;
  }

  yield { type: 'pipeline-started', totalImages: scorableReps.length };

  // =========================================================================
  // Step 8 — Scoring loop
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 8: scoring loop');

  const startMs = Date.now();
  const scoreEntries: Array<{ id: string; record: ScoreRecord }> = [];
  let scoredCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Build a reusable StyleProfile from AppSettings fields.
  const styleProfile: StyleProfile = {
    id: settings.activeProfileId ?? 'ad-hoc',
    name: 'Session Profile',
    genre: settings.genre,
    weights: settings.weights,
    preferenceText: settings.preferenceText,
    createdAt: session.createdAt,
    lastUsedAt: new Date().toISOString(),
  };

  // Pre-populate pre-rejected records (no AI call — they are auto-rejected).
  for (const rep of representatives.filter((r) => r.faceMetadata?.exceedsFaceLimit)) {
    const rejected: ScoreRecord = {
      filename: rep.filename,
      scores: { quality: 0, aesthetic: 0, composition: 0, sharpness: 0, exposure: 0, faceEyes: 0 },
      total: 0,
      tier: 'rejected',
      reasoning: `Auto-rejected: ${rep.faceMetadata!.faceCount} faces detected, limit is ${settings.maxFacesPerImage}.`,
      faceMetadata: rep.faceMetadata!,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    scoreEntries.push({ id: rep.id, record: rejected });
    try {
      await saveScore(settings.outputFolder, rep.id, rejected);
    } catch { /* non-fatal — session will still complete */ }
  }

  // Score each non-pre-rejected representative serially.
  for (const rep of scorableReps) {
    if (signal.aborted) {
      await markSessionCancelled(settings.outputFolder);
      return;
    }

    const aiParams: AICallParams = {
      imageBase64: rep.base64,
      filename: rep.filename,
      discoveryContext,
      styleProfile,
      weights: settings.weights,
      faceMetadata: rep.faceMetadata ?? EMPTY_FACE_METADATA,
      provider: settings.provider,
      apiKey,
      model: settings.model,
      baseUrl: settings.baseUrl,
    };

    let scoreRecord: ScoreRecord;
    try {
      scoreRecord = await scoreImage(aiParams);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Non-fatal: give this image a zero score with a rejection note.
      console.warn(`[orchestrator] Scoring failed for ${rep.filename}: ${msg}`);
      scoreRecord = {
        filename: rep.filename,
        scores: { quality: 0, aesthetic: 0, composition: 0, sharpness: 0, exposure: 0, faceEyes: 0 },
        total: 0,
        tier: 'rejected',
        reasoning: `Scoring failed: ${msg}`,
        faceMetadata: rep.faceMetadata ?? EMPTY_FACE_METADATA,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    scoreEntries.push({ id: rep.id, record: scoreRecord });

    try {
      await saveScore(settings.outputFolder, rep.id, scoreRecord);
    } catch { /* non-fatal */ }

    scoredCount++;

    // Accumulate token usage for cost-update events.
    totalInputTokens  += scoreRecord.usage?.inputTokens  ?? 0;
    totalOutputTokens += scoreRecord.usage?.outputTokens ?? 0;

    // ETA calculation.
    const elapsedMs = Date.now() - startMs;
    const avgMs = elapsedMs / scoredCount;
    const remaining = scorableReps.length - scoredCount;
    const etaSeconds = remaining > 0 ? Math.round((avgMs * remaining) / 1000) : 0;

    yield {
      type: 'pipeline-image-scored',
      filename: rep.filename,
      score: scoreRecord,
      scoredCount,
      etaSeconds,
    };

    // Emit cost update every 10 images (or on every image if < 10 total).
    if (scoredCount % 10 === 0 || scoredCount === scorableReps.length) {
      yield {
        type: 'pipeline-cost-update',
        totalInputTokens,
        totalOutputTokens,
      };
    }
  }

  if (await checkAbort(settings.outputFolder)) return;

  // =========================================================================
  // Step 9 — Tier assignment
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 9: tier assignment');

  const tiered = assignTiers(scoreEntries);

  // Write final tiers back to session storage.
  for (const { id, record } of tiered) {
    try {
      await saveScore(settings.outputFolder, id, record);
    } catch { /* non-fatal */ }
  }
  const selectedSCount = tiered.filter(e => e.record.tier === 'S').length;


  // =========================================================================
  // Step 10 — Shortfall computation and summary
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 10: shortfall summary');

  const finalSelected = tiered.filter(
    (e) => e.record.tier === 'S' || e.record.tier === 'A',
  ).length;

  const belowThreshold = tiered.filter(
    (e) =>
      e.record.total < QUALITY_FLOOR &&
      !e.record.faceMetadata.exceedsFaceLimit,
  ).length;

  const shortfallReasons: ShortfallReasons = {
    duplicatesSkipped,
    belowThreshold,
    faceDetectionFailed,
    exceededFaceLimit,
    burstGrouped: duplicatesSkipped,
  };

  try {
    await saveShortfallReasons(settings.outputFolder, shortfallReasons);
  } catch { /* non-fatal */ }

  yield {
    type: 'pipeline-output-summary',
    shortfallReasons,
    finalSelectedCount: finalSelected,
    selectedSCount,
  };

  // =========================================================================
  // Step 11 — Mark session complete and emit pipeline-complete
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 11: marking session complete');

  try {
    await markSessionComplete(settings.outputFolder);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[orchestrator] markSessionComplete failed: ${msg}`);
  }

  const finalSession = await loadSession(settings.outputFolder);
  if (!finalSession) {
    yield {
      type: 'pipeline-error',
      code: 'SESSION_LOAD_FAILED',
      message: 'Pipeline completed but session could not be loaded for Results screen.',
      recoverable: false,
    };
    return;
  }

  yield { type: 'pipeline-complete', session: finalSession };

  if (devMode) console.log('[orchestrator] Pipeline complete.');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns `count` indices into an array of length `total`, evenly spaced
 * including the first (0) and last (total - 1) elements.
 *
 * Example: total=100, count=5 → [0, 25, 50, 74, 99]
 */
function selectEvenlySpaced(total: number, count: number): number[] {
  if (total === 0 || count === 0) return [];
  if (count === 1) return [0];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);

  return Array.from({ length: count }, (_, i) =>
    Math.min(total - 1, Math.floor(i * (total - 1) / (count - 1))),
  );
}

// ---------------------------------------------------------------------------
// Phase 10b — Output helpers
// ---------------------------------------------------------------------------

/**
 * Copies a keeper file to the output folder, preserving subfolder structure
 * if `preserveSubfolderStructure` is true, or flattening into outputFolder
 * if false.
 *
 * When flattening and a filename collision occurs, appends _1, _2, ... until
 * the name is unique.
 *
 * @param sourceFilePath     Absolute path to the source file.
 * @param rootInputFolder    The top-level input folder (used to compute relative path).
 * @param outputFolder       Root output folder.
 * @param preserve           Whether to mirror the subfolder hierarchy.
 */
export async function copyKeeperFile(
  sourceFilePath: string,
  rootInputFolder: string,
  outputFolder: string,
  preserve: boolean,
): Promise<void> {
  const filename = path.basename(sourceFilePath);
  let destPath: string;

  if (preserve) {
    // Reconstruct relative subfolder path
    const relativeDir = path.relative(
      path.resolve(rootInputFolder),
      path.dirname(path.resolve(sourceFilePath)),
    );
    const destDir = path.join(path.resolve(outputFolder), relativeDir);
    await fs.promises.mkdir(destDir, { recursive: true });
    destPath = path.join(destDir, filename);
  } else {
    // Flat output — resolve collisions
    destPath = await resolveConflict(outputFolder, filename);
  }

  await fs.promises.copyFile(sourceFilePath, destPath);
}

/**
 * Resolves a flat-output filename collision by appending _N until unique.
 * e.g. IMG_001.jpg → IMG_001_1.jpg → IMG_001_2.jpg
 */
async function resolveConflict(
  outputFolder: string,
  filename: string,
): Promise<string> {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(path.resolve(outputFolder), filename);
  let counter = 0;

  while (true) {
    try {
      await fs.promises.access(candidate);
      // File exists — try next suffix
      counter++;
      candidate = path.join(
        path.resolve(outputFolder),
        `${base}_${counter}${ext}`,
      );
    } catch {
      // access() threw ENOENT — path is free
      return candidate;
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 10.7 – Fill shortfall by promoting lower-tier images
// ---------------------------------------------------------------------------

/**
 * Promotes additional images from B-tier (or rejected, if fillWithRejected)
 * to S/A-tier until the session reaches the target keeper count.
 *
 * @param outputFolder  Session folder containing session.json
 * @param targetCount   Desired number of keepers (S + A)
 * @returns             Updated Session object
 */
export async function fillShortfall(
  outputFolder: string,
  targetCount: number,
): Promise<import('../shared/types').Session> {
  const session = await loadSession(outputFolder);
  if (!session) {
    throw new Error(`No session found in ${outputFolder}`);
  }

  const { settings, scores: scoresMap } = session;
  const strategy = settings.shortfallStrategy;

  // Only proceed if we are below target and strategy allows filling
  const currentKeepers = Object.values(scoresMap).filter(
    (s) => s.tier === 'S' || s.tier === 'A',
  ).length;
  const shortfall = targetCount - currentKeepers;
  if (shortfall <= 0) return session;
  if (strategy === 'stop') return session; // nothing to do

  // Build an array of candidates (images that are not already S/A)
  const candidates: Array<{ id: string; record: ScoreRecord }> = [];
  for (const [id, record] of Object.entries(scoresMap)) {
    if (record.tier !== 'S' && record.tier !== 'A') {
      candidates.push({ id, record });
    }
  }

  // Sort candidates by total score descending (best first)
  candidates.sort((a, b) => b.record.total - a.record.total);

  // Determine which tiers to promote
  let allowedTiers: Set<ScoreRecord['tier']>;
  if (strategy === 'fillWithRejected') {
    allowedTiers = new Set(['B', 'rejected']);
  } else {
    // fillWithB – only promote B-tier, ignore rejected
    allowedTiers = new Set(['B']);
  }

  const toPromote = candidates.filter((c) => allowedTiers.has(c.record.tier));
  const promoteCount = Math.min(shortfall, toPromote.length);

  // Promote the best `promoteCount` candidates to A-tier (or S if needed)
  // Simple approach: all promoted go to A-tier. For a more nuanced promotion
  // (e.g., best few to S), adjust as desired – but A is fine for filling.
  for (let i = 0; i < promoteCount; i++) {
    const { id, record } = toPromote[i];
    // If we have very few S images, we could promote the very best to S,
    // but the spec only says "add the excluded ones". We'll set tier to 'A'.
    record.tier = 'A';
    scoresMap[id] = record;
  }

  // Write back the updated scores
  for (const [id, record] of Object.entries(scoresMap)) {
    await saveScore(outputFolder, id, record);
  }

  // Reload session to get fresh counts
  const updatedSession = await loadSession(outputFolder);
  if (!updatedSession) throw new Error('Failed to reload session after fill');
  return updatedSession;
}