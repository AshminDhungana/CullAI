/**
 * src/main/orchestrator.ts
 *
 * Phase 10 — Full Batch Pipeline
 * Phase 11 — Parallel Scoring via BatchScheduler
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
 *     → AsyncGenerator<PipelineEvent>. The full pipeline:
 *       scan → §10.5 input-count validation → processFolder → duplicate
 *       detection → face detection → discovery pass → createSession →
 *       parallel scoring (BatchScheduler) → tier assignment → shortfall
 *       summary → markSessionComplete.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import { scanFolder, processFolder, ALL_SUPPORTED_EXTENSIONS } from './image-processor';
import { walkFolders } from './folder-walker';
import * as fs from 'fs';
import * as path from 'path';
import { CullAIError } from './ai-errors';
import { preloadUsageForSession } from './usage-tracker';
import { groupDuplicates } from './duplicate-detector';
import { detectFaces } from './face-detector';
import {
  buildDiscoveryPrompt,
  callAIDiscovery,
  scoreImage,
} from './ai-client';
import { BatchScheduler } from './batch-scheduler';
import {
  createSession,
  saveScore,
  saveDiscoveryContext,
  saveShortfallReasons,
  markSessionComplete,
  markSessionCancelled,
  loadSession,
  sessionFilePath,
} from './session-manager';
import { runAutoTagging } from './auto-tagging';

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

async function performPreFlightChecks(settings: AppSettings) {
  // 1. Verify input folder exists and is a directory
  try {
    const stat = await fs.promises.stat(path.resolve(settings.inputFolder));
    if (!stat.isDirectory()) {
      throw new CullAIError('INPUT_FOLDER_INVALID', 'Input folder is not a directory.', false);
    }
  } catch (err: any) {
    if (err instanceof CullAIError) throw err;
    throw new CullAIError('INPUT_FOLDER_INVALID', 'Input folder does not exist.', false);
  }

  // 2. Verify output folder exists (or can be created) and is writable
  const outResolved = path.resolve(settings.outputFolder);
  let outDirExists = false;
  try {
    const outStat = await fs.promises.stat(outResolved);
    if (outStat.isDirectory()) {
      outDirExists = true;
    } else {
      throw new CullAIError('OUTPUT_FOLDER_NOT_WRITABLE', 'Output path exists but is not a directory.', false);
    }
  } catch {
    try {
      await fs.promises.mkdir(outResolved, { recursive: true });
      outDirExists = true;
    } catch {
      throw new CullAIError('OUTPUT_FOLDER_NOT_WRITABLE', 'Output folder cannot be created.', false);
    }
  }

  if (outDirExists) {
    const testFilePath = path.join(outResolved, `.cullai-write-test-${Date.now()}`);
    try {
      await fs.promises.writeFile(testFilePath, 'test');
      await fs.promises.unlink(testFilePath);
    } catch {
      throw new CullAIError('OUTPUT_FOLDER_NOT_WRITABLE', 'Output folder is not writable.', false);
    }
  }

  // 3. Ollama health check
  if (settings.provider === 'ollama') {
    const ollamaBase = settings.baseUrl?.trim().replace(/\/+$/, '') || 'http://localhost:11434';
    const modelsUrl = `${ollamaBase}/api/tags`;
    try {
      const res = await fetch(modelsUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        throw new CullAIError('OLLAMA_NOT_RUNNING', `Ollama returned error status ${res.status}.`, true);
      }
    } catch {
      throw new CullAIError('OLLAMA_NOT_RUNNING', `Cannot reach Ollama at ${ollamaBase} — is Ollama running?`, true);
    }
  }

  // 4. File counts & format checks
  let subfolders = [''];
  if (settings.processSubfolders) {
    try {
      subfolders = await walkFolders(settings.inputFolder);
    } catch {
      throw new CullAIError('INPUT_FOLDER_INVALID', 'Failed to walk subfolders.', false);
    }
  }

  const ALWAYS_EXCLUDED = new Set(['.cullai_cache', '.DS_Store', 'Thumbs.db']);
  const EXCLUDED_DIRS = new Set(['.cullai_cache', 'node_modules', '.git']);

  async function collectAllFiles(dir: string, recursive: boolean): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || ALWAYS_EXCLUDED.has(entry.name)) {
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      } else if (entry.isDirectory() && recursive && !EXCLUDED_DIRS.has(entry.name)) {
        files.push(...(await collectAllFiles(fullPath, true)));
      }
    }
    return files;
  }

  let allFiles: string[] = [];
  try {
    allFiles = await collectAllFiles(settings.inputFolder, settings.processSubfolders ?? false);
  } catch {
    throw new CullAIError('INPUT_FOLDER_INVALID', 'Failed to read input folder contents.', false);
  }

  if (allFiles.length === 0) {
    throw new CullAIError('NO_IMAGES_FOUND', 'No images found in the selected folder.', false);
  }

  const hasSupported = allFiles.some(f => {
    const ext = path.extname(f).toLowerCase();
    return ALL_SUPPORTED_EXTENSIONS.has(ext);
  });
  if (!hasSupported) {
    throw new CullAIError('UNSUPPORTED_FORMATS_ONLY', 'The selected folder contains only unsupported file formats.', false);
  }

  // Count files that match filters
  let filteredCount = 0;
  for (const relFolder of subfolders) {
    const absoluteFolderPath = relFolder === ''
      ? settings.inputFolder
      : path.join(settings.inputFolder, relFolder);
    try {
      const paths = await scanFolder(absoluteFolderPath, {
        extensions: settings.extensionFilter,
        prefixes: settings.prefixFilter,
        prefixCaseInsensitive: settings.prefixCaseInsensitive,
        ignorePatterns: settings.ignorePatterns,
        recursive: false,
      });
      filteredCount += paths.length;
    } catch {
      // ignore
    }
  }

  if (filteredCount === 0) {
    throw new CullAIError('NO_IMAGES_FOUND', 'No images match the active filters.', false);
  }

  // 5. Quota check
  const quotaCheck = await preloadUsageForSession(filteredCount);
  if (!quotaCheck.allowed && quotaCheck.remaining <= 0) {
    throw new CullAIError('FREE_LIMIT_EXCEEDED', 'Remaining monthly quota exceeded. Upgrade your license to process more images.', false);
  }
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
  // Run pre-flight checks
  await performPreFlightChecks(settings);

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

  // ── Master session: accumulated across all batches ───────────────────────
  // We merge scores from every completed batch into a single Session so the
  // final pipeline-complete event contains all images, not just the last batch.
  const existingMaster = await loadSession(settings.outputFolder);
  let masterSession: import('../shared/types').Session | null = existingMaster ? { ...existingMaster, status: 'running' } : null;

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

    // Run the batch and forward all events except pipeline-complete.
    // Intercept pipeline-complete to harvest the batch session and merge it
    // into the running masterSession instead of replacing it.
    let batchSession: import('../shared/types').Session | null = null;

    for await (const event of _runSingleFolderBatch(
      batchSettings,
      absoluteFolderPath,
      senderId,
      signal,
      { batchIndex: batchIdx + 1, totalBatches },
    )) {
      if (event.type === 'pipeline-complete') {
        const currentBatchSession = event.session;
        if (!currentBatchSession) continue;
        batchSession = currentBatchSession;

        // Accumulate into masterSession — merge scores maps so every batch
        // contributes its ScoreRecords to the final result.
        if (masterSession === null) {
          // First completed batch becomes the base session.
          masterSession = { ...currentBatchSession };
        } else {
          const currentMasterSession = masterSession as import('../shared/types').Session;
          const mergedScores = { ...currentMasterSession.scores, ...currentBatchSession.scores };
          // Subsequent batches: merge scores and update aggregate counts.
          masterSession = {
            ...currentMasterSession,
            // Keep the original session's identity / timestamps
            totalImages: existingMaster ? currentMasterSession.totalImages : (currentMasterSession.totalImages + currentBatchSession.totalImages),
            scores: mergedScores,
            scoredCount: Object.keys(mergedScores).length,
            // The master session is "complete" only after the final batch.
            status: 'running',
            elapsedMs: (currentMasterSession.elapsedMs ?? 0) + (currentBatchSession.elapsedMs ?? 0),
          };
        }
        // Do NOT yield pipeline-complete yet — we emit one combined event at the end.
        continue;
      }
      // Re-emit all other events to the renderer unchanged.
      yield event;
    }

    // ── File export for this batch ──────────────────────────────────────────
    // After each batch completes, copy keeper files (S + A tier) to the output
    // folder according to lightroomMode and preserveSubfolderStructure.
    // This is intentionally per-batch (not deferred to the end) so disk writes
    // are spread across the processing time rather than hitting all at once.
    if (batchSession && !signal.aborted && settings.lightroomMode === 'copyToOutput' && !settings.dryRun) {
      const keeperEntries = Object.entries(batchSession.scores).filter(
        ([, rec]) => rec.tier === 'S' || rec.tier === 'A',
      );

      for (const [, rec] of keeperEntries) {
        if (signal.aborted) break;
        // Reconstruct the absolute source path from the batch input folder
        // and the filename stored in the score record.
        const sourceFilePath = path.join(absoluteFolderPath, rec.filename);
        try {
          await copyKeeperFile(
            sourceFilePath,
            settings.inputFolder, // root input — needed to compute relative dir
            settings.outputFolder, // root output
            settings.preserveSubfolderStructure,
          );
        } catch (copyErr: unknown) {
          const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
          console.warn(`[orchestrator] copyKeeperFile failed for ${rec.filename}: ${msg}`);
          // Non-fatal: log and continue — other keepers should still be copied.
        }
      }

      if (devMode) {
        console.log(
          `[orchestrator] Batch ${batchIdx + 1}/${totalBatches}: ` +
          `copied ${keeperEntries.length} keeper(s) from "${folderName}"`,
        );
      }
    }

    yield {
      type: 'pipeline-batch-complete',
      batchIndex: batchIdx + 1,
      totalBatches,
    };

    if (signal.aborted) break;
  }

  // ── Emit the final combined pipeline-complete ─────────────────────────────
  if (masterSession) {
    // Mark the master session as completed now that all batches are done.
    const finalSession: import('../shared/types').Session = {
      ...masterSession,
      status: 'completed',
    };
    try {
      const filePath = sessionFilePath(settings.outputFolder);
      await fs.promises.writeFile(filePath, JSON.stringify(finalSession, null, 2));
    } catch (writeErr) {
      console.warn(`[orchestrator] failed to save master session: ${writeErr}`);
    }
    yield { type: 'pipeline-complete', session: finalSession };
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
  const existingSession = await loadSession(settings.outputFolder);
  const previouslyScoredCount = existingSession && existingSession.scores
    ? Object.keys(existingSession.scores).length
    : 0;
  const previouslyElapsed = existingSession?.elapsedMs ?? 0;

  if (existingSession) {
    session = existingSession;
    session.status = 'running';
    try {
      const filePath = sessionFilePath(settings.outputFolder);
      await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2));
    } catch { /* non-fatal */ }
    await saveDiscoveryContext(settings.outputFolder, session.discoveryContext || discoveryContext);
  } else {
    try {
      session = await createSession(settings, scorableReps.length);
      await saveDiscoveryContext(settings.outputFolder, discoveryContext);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'pipeline-error', code: 'SESSION_CREATE_FAILED', message: `Failed to create session: ${msg}`, recoverable: false };
      return;
    }
  }

  yield { type: 'pipeline-started', totalImages: session.totalImages };

  // =========================================================================
  // Step 8 — Scoring loop
  // =========================================================================

  if (devMode) console.log('[orchestrator] Step 8: scoring loop');

  const startMs = Date.now();
  const scoreEntries: Array<{ id: string; record: ScoreRecord }> = [];
  if (existingSession && existingSession.scores) {
    for (const [id, rec] of Object.entries(existingSession.scores)) {
      scoreEntries.push({ id, record: rec });
    }
  }
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
    if (session.scores[rep.id]) continue;
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

  // ── Phase 11: Parallel scoring via BatchScheduler ─────────────────────────
  //
  // BatchScheduler.run() is an AsyncGenerator that yields one SchedulerResult
  // per image as each worker finishes. Because we `for await` it directly
  // inside this generator function, we can `yield` IPC events immediately
  // after each result — no buffering, fully live progress and cost updates.

  // Build the flat work queue from scorable representatives.
  const workQueue: Array<{ id: string; params: AICallParams }> = scorableReps
    .filter((rep) => !session.scores[rep.id])
    .map((rep) => ({
      id: rep.id,
      params: {
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
      },
    }));

  const scheduler = new BatchScheduler({ concurrency: settings.concurrency, signal });
  let parallelScoredCount = 0;

  for await (const result of scheduler.run(workQueue)) {
    // ── Auth error — abort immediately, surface to renderer ──────────────────
    if (result.authError) {
      yield {
        type: 'pipeline-error',
        code: 'AUTH_FAILED',
        message: result.authError.message,
        recoverable: false,
      };
      await markSessionCancelled(settings.outputFolder);
      return;
    }

    const { id: imageId, record } = result;

    // Persist to session immediately — crash-safe resume, including elapsed culling duration.
    const currentElapsed = previouslyElapsed + (Date.now() - startMs);
    try {
      await saveScore(settings.outputFolder, imageId, record, currentElapsed);
    } catch { /* non-fatal */ }

    scoreEntries.push({ id: imageId, record });
    parallelScoredCount++;

    // Accumulate token usage.
    totalInputTokens  += record.usage?.inputTokens  ?? 0;
    totalOutputTokens += record.usage?.outputTokens ?? 0;

    // ETA: account for parallel throughput by dividing elapsed wall-clock
    // time by concurrency — gives actual expected time remaining.
    const elapsedMs = Date.now() - startMs;
    const effectiveConcurrency = Math.max(1, settings.concurrency);
    const avgMs = (elapsedMs / parallelScoredCount) / effectiveConcurrency;
    const remaining = workQueue.length - parallelScoredCount;
    const etaSeconds = remaining > 0 ? Math.round((avgMs * remaining) / 1000) : 0;

    // ── Live IPC events — emitted immediately as each image completes ─────────
    yield {
      type: 'pipeline-image-scored',
      filename: record.filename,
      score: record,
      scoredCount: previouslyScoredCount + parallelScoredCount,
      etaSeconds,
    };

    yield {
      type: 'pipeline-cost-update',
      totalInputTokens,
      totalOutputTokens,
    };
  }

  // If the signal was aborted (user cancel) during parallel scoring, exit now.
  if (signal.aborted) {
    await markSessionCancelled(settings.outputFolder);
    return;
  }

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
  // Step 9b — Generate gallery thumbnails
  // =========================================================================
  //
  // Create 800px JPEG thumbnails for each scored image and store them as
  // files in {outputFolder}/.cullai_cache/thumbnails/. This follows the
  // file-based caching pattern recommended for Electron image galleries
  // (vs base64 in session.json which bloats memory and has no browser caching).
  //
  // 800px is chosen to:
  //   • Display crisp in CompareView (fills ~half a 1440px screen at full-screen).
  //   • Display crisp in the gallery grid tiles (rendered at ~280px wide).
  //   • Stay well under the 1024px AI scoring buffer size (no upscaling needed).
  //   • Keep per-thumbnail file size reasonable (~80–150 KB at q85).

  if (devMode) console.log('[orchestrator] Step 9b: generating gallery thumbnails');

  const thumbDir = path.join(path.resolve(settings.outputFolder), '.cullai_cache', 'thumbnails');
  try {
    await fs.promises.mkdir(thumbDir, { recursive: true });
  } catch { /* non-fatal — thumbnails are optional */ }

  // Build a lookup from imageId → base64 so we can generate thumbnails
  // from the already-in-memory data. allRecords contains all images with
  // their base64 from the processFolder step.
  const idToBase64 = new Map<string, string>();
  for (const rec of allRecords) {
    idToBase64.set(rec.id, rec.base64);
  }

  for (const { id, record } of tiered) {
    if (signal.aborted) break;
    const base64Data = idToBase64.get(id);
    if (!base64Data) continue;

    try {
      const srcBuffer = Buffer.from(base64Data, 'base64');
      // Use sharp to resize to 800px max dimension — sharp enough for CompareView
      // and the gallery grid while keeping file sizes manageable.
      let thumbBuffer: Buffer;
      try {
        const sharpMod = (await import('sharp')).default as unknown as typeof import('sharp');
        const { data } = await (sharpMod as any)(srcBuffer)
          .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        thumbBuffer = data as Buffer;
      } catch {
        // sharp not available — store the full buffer (suboptimal but functional)
        thumbBuffer = srcBuffer;
      }

      const thumbFilename = `${id}.jpg`;
      const thumbPath = path.join(thumbDir, thumbFilename);
      await fs.promises.writeFile(thumbPath, thumbBuffer);
      record.thumbnailPath = `.cullai_cache/thumbnails/${thumbFilename}`;

      // Persist the updated thumbnailPath to session
      try {
        await saveScore(settings.outputFolder, id, record);
      } catch { /* non-fatal */ }
    } catch (thumbErr: unknown) {
      // Non-fatal — gallery will show a placeholder for this image
      if (devMode) {
        const msg = thumbErr instanceof Error ? thumbErr.message : String(thumbErr);
        console.warn(`[orchestrator] Thumbnail generation failed for ${record.filename}: ${msg}`);
      }
    }
  }



  // =========================================================================
  // Step 9c — AI Auto-Tagging (Phase 13b, Pro feature)
  // =========================================================================
  //
  // Runs after tier assignment and thumbnail generation so:
  //   • Only S and A-tier keepers are tagged (tiers are final by this point).
  //   • idToBase64 is still in scope — we reuse the already-decoded previews
  //     rather than re-reading thumbnails from disk.
  //   • saveScore() is called for each tagged image so keywords are persisted
  //     to session.json before markSessionComplete() is called below. This
  //     means keywords are available in the Results screen without re-running
  //     the pipeline.

  if (settings.enableAutoTagging) {
    if (devMode) console.log('[orchestrator] Step 9c: AI auto-tagging');

    // Build the entries the auto-tagger needs. Only S and A tier, and only
    // images for which we have a base64 preview in memory.
    const tagEntries = tiered
      .filter(e => (e.record.tier === 'S' || e.record.tier === 'A') && !signal.aborted)
      .map(e => ({
        id:           e.id,
        record:       e.record,
        imageBase64:  idToBase64.get(e.id) ?? '',
      }))
      .filter(e => e.imageBase64.length > 0);

    if (tagEntries.length > 0) {
      try {
        const keywordMap = await runAutoTagging(tagEntries, settings);

        for (const [id, keywords] of keywordMap) {
          const entry = tiered.find(e => e.id === id);
          if (!entry) continue;
          entry.record.keywords = keywords;
          try {
            await saveScore(settings.outputFolder, id, entry.record);
          } catch { /* non-fatal — keyword loss is acceptable */ }
        }

        if (devMode) {
          console.log(
            `[orchestrator] Step 9c: tagged ${keywordMap.size}/${tagEntries.length} keepers`,
          );
        }
      } catch (err: unknown) {
        // runAutoTagging is documented to never throw, but guard anyway.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[orchestrator] Auto-tagging failed (non-fatal): ${msg}`);
      }
    } else if (devMode) {
      console.log('[orchestrator] Step 9c: no qualifying entries for auto-tagging');
    }
  }

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

  if (!settings.processSubfolders && settings.lightroomMode === 'copyToOutput' && !settings.dryRun && !signal.aborted) {
    const keeperEntries = Object.entries(finalSession.scores).filter(
      ([, rec]) => rec.tier === 'S' || rec.tier === 'A',
    );

    for (const [, rec] of keeperEntries) {
      if (signal.aborted) break;
      const sourceFilePath = path.join(folderPath, rec.filename);
      try {
        await copyKeeperFile(
          sourceFilePath,
          settings.inputFolder,
          settings.outputFolder,
          settings.preserveSubfolderStructure,
        );
      } catch (copyErr: unknown) {
        const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
        console.warn(`[orchestrator] copyKeeperFile failed for ${rec.filename}: ${msg}`);
      }
    }
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

// ---------------------------------------------------------------------------
// Phase 12b.4 — Re-score Selected Images
// ---------------------------------------------------------------------------

/**
 * Re-scores a subset of already-processed images using the current weights
 * without re-running folder scan or duplicate detection.
 *
 * For each image:
 *   1. Load the existing ScoreRecord from session to get filename + faceMetadata.
 *   2. Load the cached thumbnail JPEG from `.cullai_cache/thumbnails/{id}.jpg`
 *      and convert it to base64 for the AI call.
 *   3. Call scoreImage() with the new weights.
 *   4. Persist the updated record.
 *   5. Emit a `pipeline-image-scored` event so the renderer updates in real time.
 *
 * After all images are scored, run assignTiers() on the full session so tier
 * percentiles are recalculated across the entire image set.
 *
 * @param imageIds     Array of session image IDs to re-score.
 * @param outputFolder Absolute path to the output folder (contains session.json).
 * @param settings     AppSettings with the new weights and provider config.
 * @param sender       WebContents to push `pipeline-image-scored` events to.
 */
export async function rescoreImages(
  imageIds: string[],
  outputFolder: string,
  settings: AppSettings,
  sender: import('electron').WebContents,
): Promise<void> {
  const session = await loadSession(outputFolder);
  if (!session) throw new Error('re-score-images: no session found in output folder.');

  const devMode = process.env.NODE_ENV === 'development';
  const thumbDir = path.join(path.resolve(outputFolder), '.cullai_cache', 'thumbnails');

  // Build an in-memory map of all entries for tier recalculation later
  const allEntries: Array<{ id: string; record: ScoreRecord }> = Object.entries(session.scores).map(
    ([id, record]) => ({ id, record }),
  );

  let scoredCount = 0;

  for (const imageId of imageIds) {
    const existing = session.scores[imageId];
    if (!existing) {
      if (devMode) console.warn(`[rescoreImages] imageId "${imageId}" not found in session — skipping`);
      continue;
    }

    // Load thumbnail base64 from disk cache
    const thumbPath = path.join(thumbDir, `${imageId}.jpg`);
    let imageBase64: string;
    try {
      const thumbBuffer = await fs.promises.readFile(thumbPath);
      imageBase64 = thumbBuffer.toString('base64');
    } catch {
      if (devMode) console.warn(`[rescoreImages] No thumbnail for ${existing.filename} — skipping`);
      continue;
    }

    // Build a minimal StyleProfile from current settings
    const styleProfile: StyleProfile = {
      id:            settings.activeProfileId ?? 'ad-hoc',
      name:          'Ad-hoc',
      genre:         settings.genre as import('../shared/types').GenrePreset,
      weights:       settings.weights,
      preferenceText: settings.preferenceText,
      createdAt:     new Date().toISOString(),
      lastUsedAt:    new Date().toISOString(),
    };

    const params: AICallParams = {
      imageBase64,
      filename:       existing.filename,
      discoveryContext: session.discoveryContext ?? '',
      styleProfile,
      weights:        settings.weights,
      faceMetadata:   existing.faceMetadata,
      provider:       settings.provider,
      apiKey:         settings.apiKey,
      model:          settings.model,
      baseUrl:        settings.baseUrl,
    };

    let newRecord: ScoreRecord;
    try {
      newRecord = await scoreImage(params);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rescoreImages] scoreImage failed for ${existing.filename}: ${msg}`);
      continue;
    }

    // Preserve fields that scoreImage doesn't populate
    newRecord.thumbnailPath = existing.thumbnailPath;
    newRecord.keywords      = existing.keywords;

    // Update the in-memory entry for tier recalculation
    const entryRef = allEntries.find(e => e.id === imageId);
    if (entryRef) entryRef.record = newRecord;

    // Persist to session
    try {
      await saveScore(outputFolder, imageId, newRecord);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rescoreImages] saveScore failed for ${existing.filename}: ${msg}`);
    }

    scoredCount++;

    // Notify renderer — reuse the pipeline-image-scored event type.
    // We send imageId in the `filename` field so the renderer can key by ID.
    if (!sender.isDestroyed()) {
      sender.send('pipeline-event', {
        type:        'pipeline-image-scored',
        filename:    imageId,
        score:       newRecord,
        scoredCount,
        etaSeconds:  null,
      });
    }
  }

  // Re-run tier assignment on the full updated session so percentiles are
  // correct across the whole image set (not just the re-scored subset).
  const retiered = assignTiers(allEntries);
  for (const { id, record } of retiered) {
    try {
      await saveScore(outputFolder, id, record);
    } catch { /* non-fatal */ }
  }

  if (devMode) {
    console.log(`[rescoreImages] Completed: ${scoredCount}/${imageIds.length} images re-scored.`);
  }
}