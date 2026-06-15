/**
 * src/cli/runner.ts
 *
 * Phase 19 — CLI Pipeline Runner
 *
 * Drives the existing runPipeline() from the command line in headless mode.
 * Converts CLIArgs → AppSettings, handles all PipelineEvent types, prints
 * progress and summary to stdout, writes summary files, and exits with the
 * appropriate exit code.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AppSettings, PipelineEvent, Session } from '../shared/types';
import { defaultAppSettings } from '../shared/types';
import { GENRE_PRESETS } from '../shared/genre-presets';
import { PROVIDER_DEFAULTS } from '../shared/constants';
import { getApiKey } from '../main/safe-storage';
import { runPipeline, resolvePipelineConfirmation } from '../main/orchestrator';
import { loadSession } from '../main/session-manager';
import { writeAllSidecars } from '../main/xmp-writer';
import { CullAIError } from '../main/ai-errors';
import { runBenchmark, printBenchmarkToConsole, writeBenchmarkReport } from '../main/benchmark';
import type { CLIArgs } from './args';

// ── Exit codes ───────────────────────────────────────────────────────────────
const EXIT = {
  OK: 0,
  GENERIC: 1,
  BAD_ARGS: 2,
  PREFLIGHT_FAIL: 3,
  CANCELLED: 4,
  AUTH_FAIL: 5,
} as const;

// ── Spinner helper ──────────────────────────────────────────────────────────
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ── Main entry ─────────────────────────────────────────────────────────────
export async function runCLI(args: CLIArgs): Promise<void> {
  // ── Phase 20.1: Benchmark mode ------------------------------------------------
  if (args.benchmark) {
    const includeAi = !!args.apiKey || !!process.env.ANTHROPIC_API_KEY;
    const report = await runBenchmark(includeAi);
    printBenchmarkToConsole(report);
    const reportPath = await writeBenchmarkReport(report, args.output || undefined);
    console.log(`Benchmark report written to: ${reportPath}`);
    process.exit(EXIT.OK);
    return;
  }

  const settings = buildSettings(args);

  // ── Resolve API key ──────────────────────────────────────────────────────
  let apiKey = settings.apiKey;
  if (!apiKey && settings.provider !== 'ollama') {
    apiKey = getApiKey(settings.provider) ?? '';
    if (!apiKey) {
      console.error('Error: --api-key is required (or store one via the GUI first)');
      process.exit(EXIT.BAD_ARGS);
    }
  }
  settings.apiKey = apiKey ?? '';

  // ── Verify input/output folders ──────────────────────────────────────────
  try {
    const inStat = await fs.promises.stat(path.resolve(settings.inputFolder));
    if (!inStat.isDirectory()) {
      console.error(`Error: Input path is not a directory: ${settings.inputFolder}`);
      process.exit(EXIT.PREFLIGHT_FAIL);
    }
  } catch {
    console.error(`Error: Input folder does not exist: ${settings.inputFolder}`);
    process.exit(EXIT.PREFLIGHT_FAIL);
  }

  // Ensure output folder exists
  try {
    await fs.promises.mkdir(path.resolve(settings.outputFolder), { recursive: true });
  } catch {
    console.error(`Error: Output folder cannot be created: ${settings.outputFolder}`);
    process.exit(EXIT.PREFLIGHT_FAIL);
  }

  // ── Dry-run guard ────────────────────────────────────────────────────────
  if (settings.dryRun) {
    console.log('=== CullAI Dry-Run Estimate ===');
    // For dry-run we just let the pipeline run; it'll yield a dry-run summary.
  }

  // ── Run the pipeline ───────────────────────────────────────────────────
  const controller = new AbortController();
  const senderId = 0; // dummy id for CLI (no renderer)
  let session: Session | null = null;
  let spinnerIdx = 0;

  // SIGINT / SIGTERM handler for graceful cancellation
  const onSignal = () => {
    console.log('\nAbort signal received — cancelling pipeline...');
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    for await (const event of runPipeline(settings, senderId, controller.signal)) {
      handleEvent(event, settings, { verbose: args.verbose });

      switch (event.type) {
        case 'pipeline-complete': {
          if (event.session) session = event.session;
          break;
        }
        case 'pipeline-needs-confirmation': {
          // In headless mode, auto-confirm without a GUI dialog
          console.log(`Auto-confirming: requested ${event.requested}, available ${event.available}`);
          resolvePipelineConfirmation(senderId);
          break;
        }
        case 'pipeline-error': {
          if (event.code === 'AUTH_FAILED' || event.code === 'FREE_LIMIT_EXCEEDED') {
            process.exit(EXIT.AUTH_FAIL);
          }
          process.exit(EXIT.PREFLIGHT_FAIL);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof CullAIError) {
      console.error(`\n[Error ${err.code}] ${err.message}`);
      if (err.code === 'AUTH_FAILED' || err.code === 'FREE_LIMIT_EXCEEDED') {
        process.exit(EXIT.AUTH_FAIL);
      }
      process.exit(EXIT.PREFLIGHT_FAIL);
    } else {
      console.error(`\nUnexpected error: ${msg}`);
      process.exit(EXIT.GENERIC);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  if (controller.signal.aborted) {
    console.log('\nPipeline cancelled.');
    process.exit(EXIT.CANCELLED);
  }

  if (!session) {
    console.error('\nPipeline completed but no session was returned.');
    process.exit(EXIT.GENERIC);
  }

  // ── Post-pipeline: XMP export ────────────────────────────────────────
  if (!args.noXmp && !settings.dryRun) {
    try {
      const scores = Object.values(session.scores);
      if (scores.length > 0) {
        // Build imagePathMap: filename → absolute path
        const imagePathMap: Record<string, string> = {};
        for (const [id, record] of Object.entries(session.scores)) {
          // Reconstruct the absolute path to the original file
          imagePathMap[record.filename] = path.join(settings.inputFolder, record.filename);
        }
        await writeAllSidecars(scores, imagePathMap, true);
        console.log(`\nExported ${scores.length} XMP sidecar files.`);
      }
    } catch (xmpErr: unknown) {
      const msg = xmpErr instanceof Error ? xmpErr.message : String(xmpErr);
      console.warn(`Warning: XMP export failed: ${msg}`);
    }
  }

  // ── Write JSON summary ─────────────────────────────────────────────────
  const summary = buildSummary(session, settings);
  const summaryPath = path.join(path.resolve(settings.outputFolder), 'results.json');
  try {
    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  } catch (writeErr: unknown) {
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    console.warn(`Warning: Could not write ${summaryPath}: ${msg}`);
  }

  // ── Print final summary ────────────────────────────────────────────────
  printSummary(session, settings.outputFolder);

  process.exit(EXIT.OK);
}

// ── Settings builder ─────────────────────────────────────────────────────────
function buildSettings(args: CLIArgs): AppSettings {
  const defaults = defaultAppSettings();
  const provider = args.provider;
  const providerDefaults = PROVIDER_DEFAULTS[provider] ?? { baseUrl: '', defaultModel: '' };

  // Resolve output folder default
  const outputFolder = args.output
    ? path.resolve(args.output)
    : path.join(args.input, 'cullai_results');

  // Resolve weights
  let weights = { ...defaults.weights };
  if (args.weights) {
    const parts = args.weights.split(',').map((s) => parseFloat(s.trim()));
    weights = {
      quality: parts[0] ?? defaults.weights.quality,
      aesthetic: parts[1] ?? defaults.weights.aesthetic,
      composition: parts[2] ?? defaults.weights.composition,
      sharpness: parts[3] ?? defaults.weights.sharpness,
      exposure: parts[4] ?? defaults.weights.exposure,
      faceEyes: parts[5] ?? defaults.weights.faceEyes,
    };
  }

  return {
    ...defaults,
    inputFolder: path.resolve(args.input),
    outputFolder,
    numImagesToSelect: args.count,
    provider,
    apiKey: args.apiKey ?? '',
    model: args.model ?? providerDefaults.defaultModel,
    baseUrl: providerDefaults.baseUrl,
    weights,
    enableXmpExport: !args.noXmp,
    dryRun: args.dryRun,
    lightroomMode: 'rateInPlace', // sensible CLI default
    // Preserve defaults for fields not exposed via CLI
    genre: defaults.genre,
    activeProfileId: null,
    preferenceText: '',
    concurrency: defaults.concurrency,
    extensionFilter: [],
    prefixFilter: [],
    prefixCaseInsensitive: true,
    ignorePatterns: [],
    referenceImage: null,
    disableDuplicateGrouping: false,
    duplicateThreshold: 10,
    maxFacesPerImage: 0,
    processSubfolders: false,
    preserveSubfolderStructure: false,
    enableAutoTagging: false,
    tagTopPercent: 20,
    rawCacheMaxSizeGb: 5,
    rawCacheMaxAgeDays: 30,
    disableRawCache: false,
    useEmbeddedPreview: true,
  };
}

// ── Event handler ───────────────────────────────────────────────────────────
function handleEvent(
  event: PipelineEvent,
  _settings: AppSettings,
  opts: { verbose: boolean },
): void {
  switch (event.type) {
    case 'pipeline-started': {
      console.log(`Processing ${event.totalImages} images...`);
      break;
    }
    case 'pipeline-image-scored': {
      const progress = `[${event.scoredCount}] ${event.filename}`;
      if (process.stdout.isTTY) {
        // In a TTY, overwrite the current line for live progress
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(progress);
      } else {
        console.log(progress);
      }
      break;
    }
    case 'pipeline-cost-update': {
      if (opts.verbose) {
        const cost = (
          (event.totalInputTokens / 1_000_000) * 3 +
          (event.totalOutputTokens / 1_000_000) * 15
        ).toFixed(4);
        console.log(`[cost] $${cost} (${event.totalInputTokens} in / ${event.totalOutputTokens} out)`);
      }
      break;
    }
    case 'pipeline-batch-started': {
      console.log(`
Batch ${event.batchIndex}/${event.totalBatches}: "${event.folderName}" (${event.batchImageCount} images)`);
      break;
    }
    case 'pipeline-batch-complete': {
      console.log(`Batch ${event.batchIndex}/${event.totalBatches}: complete`);
      break;
    }
    case 'pipeline-output-summary': {
      if (process.stdout.isTTY) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      }
      const reasons = event.shortfallReasons;
      console.log('\n--- Output Summary ---');
      console.log(`Selected: ${event.finalSelectedCount}`);
      if (reasons) {
        console.log(`  Duplicates skipped: ${reasons.duplicatesSkipped}`);
        console.log(`  Below threshold: ${reasons.belowThreshold}`);
        console.log(`  Exceeded face limit: ${reasons.exceededFaceLimit}`);
        console.log(`  Face detection failed: ${reasons.faceDetectionFailed}`);
      }
      break;
    }
    case 'pipeline-error': {
      console.error(`\n[Error ${event.code}] ${event.message}`);
      break;
    }
    case 'pipeline-complete': {
      // Handled after the loop
      break;
    }
  }
}

// ── Summary builder / printer ─────────────────────────────────────────────

function buildSummary(session: Session, _settings: AppSettings) {
  const scores = Object.values(session.scores);
  const tierCounts = {
    S: scores.filter((s) => s.tier === 'S').length,
    A: scores.filter((s) => s.tier === 'A').length,
    B: scores.filter((s) => s.tier === 'B').length,
    rejected: scores.filter((s) => s.tier === 'rejected').length,
  };

  return {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    inputFolder: session.inputFolder,
    outputFolder: session.outputFolder,
    totalImages: session.totalImages,
    scoredCount: session.scoredCount,
    tierCounts,
    shortfallReasons: session.outputShortfallReasons ?? null,
  };
}

function printSummary(session: Session, outputFolder: string): void {
  const scores = Object.values(session.scores);
  const tierCounts = {
    S: scores.filter((s) => s.tier === 'S').length,
    A: scores.filter((s) => s.tier === 'A').length,
    B: scores.filter((s) => s.tier === 'B').length,
    rejected: scores.filter((s) => s.tier === 'rejected').length,
  };

  console.log('\n═══════════════════════════════════════════════');
  console.log('              CULLING COMPLETE                    ');
  console.log('═══════════════════════════════════════════════');
  console.log(`\nTotal images:   ${session.totalImages}`);
  console.log(`S-tier:         ${tierCounts.S}`);
  console.log(`A-tier:         ${tierCounts.A}`);
  console.log(`B-tier:         ${tierCounts.B}`);
  console.log(`Rejected:       ${tierCounts.rejected}`);
  console.log(`\nSession saved:  ${path.join(outputFolder, 'session.json')}`);
  console.log(`Results saved:  ${path.join(outputFolder, 'results.json')}`);
  console.log('═══════════════════════════════════════════════');
}
