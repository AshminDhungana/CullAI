/**
 * src/main/batch-scheduler.ts
 *
 * Phase 11 — Parallel Batch Scheduler
 *
 * ── Purpose ──────────────────────────────────────────────────────────────────
 *
 *   Scores a queue of images with N concurrent workers and yields each result
 *   as it arrives, enabling real-time progress and cost events in the
 *   orchestrator generator without buffering.
 *
 * ── Architecture: async iterator, not callbacks ───────────────────────────────
 *
 *   The previous callback design (`onResult`) forced the orchestrator to buffer
 *   all pipeline events and yield them only after `run()` resolved — because
 *   `yield` cannot cross an async callback boundary into a generator.
 *
 *   The fix: `BatchScheduler.run()` is itself an `AsyncGenerator` that yields
 *   `SchedulerResult` objects one at a time as each worker finishes. The
 *   orchestrator simply `for await`s the generator and yields IPC events
 *   directly after each result — fully live, no buffering.
 *
 *         for await (const result of scheduler.run(workQueue)) {
 *           yield { type: 'pipeline-image-scored', ... };   // ← live
 *           yield { type: 'pipeline-cost-update',  ... };   // ← live
 *         }
 *
 * ── Concurrency model ─────────────────────────────────────────────────────────
 *
 *   `run()` spawns exactly `concurrency` long-lived worker Promises. Each worker
 *   loops: pull next image → score with retries → push result into a shared
 *   channel → repeat. The generator reads from the channel and yields each
 *   result. Workers exit when the queue is empty; the generator exits once all
 *   workers have finished and the channel is drained.
 *
 *   This is a work-stealing model: fast workers absorb more images automatically
 *   if others are sleeping through a rate-limit retry.
 *
 * ── Retry policy ─────────────────────────────────────────────────────────────
 *
 *   Error               │ Action
 *   ────────────────────┼───────────────────────────────────────────────────────
 *   AIAuthError         │ Abort entire pipeline immediately (non-retryable).
 *                       │ Yielded as a SchedulerResult with authError set.
 *   AIRateLimitError    │ Sleep retryAfter seconds, retry the same image.
 *   AIServerError (5xx) │ Exponential backoff: 1 s, 2 s, 4 s — up to 3 retries.
 *   AITimeoutError      │ Retry once; on second timeout mark as scoring-failed.
 *   AIParseError/other  │ Non-retryable; mark image as scoring-failed.
 *
 * ── Abort support ────────────────────────────────────────────────────────────
 *
 *   Workers check `signal.aborted` before each dequeue and after each retry
 *   sleep. An AIAuthError also calls `abortController.abort()` to wake all
 *   sleeping workers immediately.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer.
 */

import { scoreImage } from './ai-client';
import {
  AIAuthError,
  AIRateLimitError,
  AIServerError,
  AITimeoutError,
} from './ai-errors';

import type { AICallParams, ScoreRecord, FaceMetadata } from '../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum attempts per image for AIServerError (5xx). */
const MAX_SERVER_RETRIES = 3;

/** Base backoff in ms for AIServerError; doubles each retry: 1 s, 2 s, 4 s. */
const SERVER_BACKOFF_BASE_MS = 1_000;

/** Log a warning when a single image takes more than this many retries total. */
const RETRY_WARN_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BatchSchedulerOptions = {
  /** Maximum simultaneous API calls (from AppSettings.concurrency). */
  concurrency: number;
  /** AbortSignal forwarded from the pipeline's AbortController. */
  signal: AbortSignal;
};

/**
 * One result yielded per image from `BatchScheduler.run()`.
 *
 * - On success:    `record` is the scored ScoreRecord.
 * - On failure:    `record` is a zero-score rejection record.
 * - On auth error: `authError` is set; the caller should abort and surface it.
 *                  No `record` is provided — this result must be handled before
 *                  processing continues.
 */
export type SchedulerResult = {
  id: string;
  record: ScoreRecord;
  /** Set only when an AIAuthError aborted the pipeline. */
  authError?: AIAuthError;
};

// ---------------------------------------------------------------------------
// Internal: async channel
//
// A minimal unbuffered push/pull channel that connects the worker Promises
// (which produce results asynchronously) to the async generator (which
// consumes them one at a time via `for await`).
//
// Design:
//   - Workers call `channel.push(value)` to enqueue a result.
//   - The generator calls `channel.pull()` to dequeue the next result,
//     awaiting a Promise if nothing is ready yet.
//   - Workers call `channel.done()` when they exit; once all workers have
//     called done() AND the queue is empty, `channel.pull()` returns null
//     to signal end-of-stream.
// ---------------------------------------------------------------------------

type Channel<T> = {
  push: (value: T) => void;
  done: () => void;
  pull: () => Promise<T | null>;
};

function makeChannel<T>(workerCount: number): Channel<T> {
  const queue: T[] = [];
  // Pending resolver waiting for the next push() — set when pull() is called
  // before any item is in the queue.
  let waiting: ((value: T | null) => void) | null = null;
  let activeWorkers = workerCount;

  return {
    push(value: T) {
      if (waiting) {
        // A pull() is already waiting — resolve it directly.
        const resolve = waiting;
        waiting = null;
        resolve(value);
      } else {
        queue.push(value);
      }
    },

    done() {
      activeWorkers--;
      // If all workers are done and a pull() is waiting with nothing queued,
      // signal end-of-stream.
      if (activeWorkers === 0 && queue.length === 0 && waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(null);
      }
    },

    pull(): Promise<T | null> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      if (activeWorkers === 0) {
        return Promise.resolve(null); // all done, nothing left
      }
      // Block until a worker pushes or all workers call done().
      return new Promise<T | null>((resolve) => {
        waiting = resolve;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves after `ms` ms, or rejects early if `signal` is aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Aborted')); return; }
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(id); reject(new Error('Aborted')); }, { once: true });
  });
}

/** Zero-score ScoreRecord representing a permanent scoring failure. */
function makeFailureRecord(
  filename: string,
  faceMetadata: FaceMetadata,
  reason: string,
): ScoreRecord {
  return {
    filename,
    scores: { quality: 0, aesthetic: 0, composition: 0, sharpness: 0, exposure: 0, faceEyes: 0 },
    total: 0,
    tier: 'rejected',
    reasoning: `Scoring failed: ${reason}`,
    faceMetadata,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// BatchScheduler
// ---------------------------------------------------------------------------

export class BatchScheduler {
  private readonly _opts: BatchSchedulerOptions;
  private readonly _abortController: AbortController;

  constructor(opts: BatchSchedulerOptions) {
    this._opts = opts;
    this._abortController = new AbortController();
    // Propagate external cancellation into our internal controller.
    opts.signal.addEventListener('abort', () => {
      this._abortController.abort();
    }, { once: true });
  }

  /**
   * Processes all `images` with N concurrent workers and yields each
   * `SchedulerResult` as soon as it is available.
   *
   * Usage in the orchestrator generator:
   *
   *   for await (const result of scheduler.run(workQueue)) {
   *     if (result.authError) { ... abort ... }
   *     yield { type: 'pipeline-image-scored', ... };
   *     yield { type: 'pipeline-cost-update',  ... };
   *   }
   *
   * The generator exits (returns) when all workers have finished or the
   * signal is aborted. Results may arrive in any order.
   */
  async *run(
    images: Array<{ id: string; params: AICallParams }>,
  ): AsyncGenerator<SchedulerResult> {
    if (images.length === 0) return;

    const signal = this._abortController.signal;
    const concurrency = Math.max(1, Math.min(this._opts.concurrency, images.length));
    const channel = makeChannel<SchedulerResult>(concurrency);

    // Shared queue index — workers atomically claim the next image by reading
    // and incrementing this counter (safe: Node.js is single-threaded).
    let queueIndex = 0;

    const dequeue = (): { id: string; params: AICallParams } | null => {
      if (queueIndex >= images.length) return null;
      return images[queueIndex++];
    };

    // ── Per-image scoring with full retry policy ────────────────────────────
    const scoreWithRetry = async (
      id: string,
      params: AICallParams,
    ): Promise<ScoreRecord | { authError: AIAuthError } | null> => {
      const devMode = process.env.NODE_ENV === 'development';
      let serverRetries = 0;
      let timeoutRetries = 0;
      let totalRetries = 0;

      while (true) {
        if (signal.aborted) return null;

        try {
          const record = await scoreImage(params);
          if (totalRetries > RETRY_WARN_THRESHOLD) {
            console.warn(
              `[batch-scheduler] ${params.filename} scored after ${totalRetries} retries`,
            );
          }
          return record;

        } catch (err: unknown) {

          // ── Auth error — non-retryable, abort all workers ─────────────────
          if (err instanceof AIAuthError) {
            this._abortController.abort();
            return { authError: err };
          }

          // ── Rate limit — sleep retryAfter seconds, retry ──────────────────
          if (err instanceof AIRateLimitError) {
            totalRetries++;
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `[batch-scheduler] Rate limited on ${params.filename}, ` +
                `waiting ${err.retryAfter}s (retry #${totalRetries})`,
              );
            }
            try { await sleep(err.retryAfter * 1_000, signal); } catch { return null; }
            continue;
          }

          // ── Server error (5xx) — exponential backoff, up to 3 retries ─────
          if (err instanceof AIServerError) {
            if (serverRetries >= MAX_SERVER_RETRIES) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[batch-scheduler] ${params.filename}: server error exhausted ` +
                `${MAX_SERVER_RETRIES} retries — marking as failed`,
              );
              return makeFailureRecord(params.filename, params.faceMetadata, msg);
            }
            serverRetries++;
            totalRetries++;
            const backoffMs = SERVER_BACKOFF_BASE_MS * Math.pow(2, serverRetries - 1);
            if (process.env.NODE_ENV === 'development') {
              console.log(
                `[batch-scheduler] Server error on ${params.filename}, ` +
                `backoff ${backoffMs}ms (retry #${serverRetries}/${MAX_SERVER_RETRIES})`,
              );
            }
            try { await sleep(backoffMs, signal); } catch { return null; }
            continue;
          }

          // ── Timeout — retry once, then fail ──────────────────────────────
          if (err instanceof AITimeoutError) {
            if (timeoutRetries === 0) {
              timeoutRetries++;
              totalRetries++;
              if (process.env.NODE_ENV === 'development') {
                console.log(`[batch-scheduler] Timeout on ${params.filename}, retrying once`);
              }
              continue;
            }
            return makeFailureRecord(params.filename, params.faceMetadata, 'Request timed out twice');
          }

          // ── Any other error — non-retryable ───────────────────────────────
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[batch-scheduler] Non-retryable error for ${params.filename}: ${msg}`);
          return makeFailureRecord(params.filename, params.faceMetadata, msg);
        }
      }
    };

    // ── Spawn N workers ─────────────────────────────────────────────────────
    const workers = Array.from({ length: concurrency }, async () => {
      try {
        while (true) {
          if (signal.aborted) break;

          const item = dequeue();
          if (!item) break;

          const outcome = await scoreWithRetry(item.id, item.params);

          if (outcome === null) {
            // Aborted mid-retry — stop this worker without pushing a result.
            break;
          }

          if ('authError' in outcome) {
            // Push the auth-error sentinel so the generator can surface it.
            channel.push({ id: item.id, record: makeFailureRecord(item.params.filename, item.params.faceMetadata, outcome.authError.message), authError: outcome.authError });
            break;
          }

          channel.push({ id: item.id, record: outcome });
        }
      } finally {
        channel.done();
      }
    });

    // Fire off all workers but don't await them — the channel lets us pull
    // results as they arrive rather than waiting for all workers to finish.
    const allDone = Promise.all(workers);

    // ── Yield results as they arrive ────────────────────────────────────────
    while (true) {
      const result = await channel.pull();
      if (result === null) break; // all workers done, channel drained
      yield result;
      // Stop consuming if an auth error was encountered.
      if (result.authError) break;
    }

    // Ensure all worker Promises resolve cleanly before returning.
    await allDone;
  }
}