/**
 * src/main/session-manager.ts
 *
 * Phase 8 — Session Manager
 *
 * ── Purpose ──────────────────────────────────────────────────────────────────
 *
 *   Provides crash-safe persistence for scoring sessions. Every image score is
 *   written to disk immediately after it is produced, so a crashed or cancelled
 *   run can resume from the exact image where it stopped.
 *
 * ── Storage layout ───────────────────────────────────────────────────────────
 *
 *   {outputFolder}/session.json        — current session state
 *   {outputFolder}/session.json.tmp    — atomic write staging file (transient)
 *   {outputFolder}/session.json.bak    — backup of last known-good state
 *
 * ── Atomic write pattern ─────────────────────────────────────────────────────
 *
 *   1. Serialise session to JSON.
 *   2. Write to session.json.tmp.
 *   3. If session.json already exists, copy it to session.json.bak.
 *   4. Rename session.json.tmp → session.json.
 *
 *   The rename is near-atomic on all three platforms (POSIX rename syscall on
 *   Linux/macOS; MoveFileExW with MOVEFILE_REPLACE_EXISTING on Windows via
 *   Node's fs.rename). If the process crashes between steps 2 and 4, the old
 *   session.json remains intact; if it crashes after step 4, the .bak can be
 *   used to recover.
 *
 * ── Session file format ───────────────────────────────────────────────────────
 *
 *   Plain JSON with the Session type from src/shared/types.ts.
 *   Scores are stored in the `scores` map, keyed by ImageRecord.id (not
 *   filename), so processSubfolders=true sessions with duplicate basenames
 *   across subdirectories are handled without silent collision.
 *
 * ── Resume logic ──────────────────────────────────────────────────────────────
 *
 *   `getScoredIds(session)` returns the Set of ImageRecord.id values that have
 *   already been scored. The orchestrator (Phase 10) skips any image whose id
 *   is in this set.
 *
 * ── Thread safety ─────────────────────────────────────────────────────────────
 *
 *   All public functions are async and serialised implicitly through Node.js's
 *   single-threaded event loop. Multiple concurrent `saveScore` calls will be
 *   interleaved correctly because each acquires the write lock (a Promise chain
 *   stored in _writeLock) before touching disk.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Session,
  SessionStatus,
  ScoreRecord,
  ShortfallReasons,
} from '../shared/types';
import type { AppSettings } from '../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the session file written into the output folder. */
const SESSION_FILENAME = 'session.json';
/** Transient staging file used during atomic writes. */
const TMP_SUFFIX = '.tmp';
/** Backup of the previous session.json before an atomic replace. */
const BAK_SUFFIX = '.bak';

// ---------------------------------------------------------------------------
// Write lock — serialises concurrent saveScore() calls
// ---------------------------------------------------------------------------

/**
 * Per-session write locks. Keyed by absolute sessionFilePath so different
 * output folders get independent lock chains.
 */
const _writeLocks = new Map<string, Promise<void>>();

/**
 * Acquires the write lock for `filePath`, runs `fn`, then releases.
 * Errors in `fn` are propagated to the caller but do NOT break the lock chain
 * (subsequent calls will still run).
 */
async function withWriteLock(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = _writeLocks.get(filePath) ?? Promise.resolve();

  // Build a gate promise whose resolution/rejection we control manually.
  // This lets us: (a) propagate fn's error to the caller, and (b) keep the
  // stored lock chain error-free so subsequent waiters are never blocked.
  let resolveGate!: () => void;
  let rejectGate!: (err: unknown) => void;
  const gate = new Promise<void>((res, rej) => {
    resolveGate = res;
    rejectGate = rej;
  });

  // Chain onto prev: run fn once, then settle the gate.
  // The .catch(() => {}) prevents an unhandled-rejection warning on the stored
  // chain when fn throws (the error is already routed to rejectGate).
  const next = prev
    .then(() => fn())
    .then(resolveGate, rejectGate)
    .catch(() => {});

  _writeLocks.set(filePath, next);

  // Awaiting the gate propagates fn's success or error to the caller.
  await gate;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the absolute path to the session file in `outputFolder`. */
function sessionFilePath(outputFolder: string): string {
  return path.join(path.resolve(outputFolder), SESSION_FILENAME);
}

/**
 * Atomically writes `data` to `targetPath`.
 *
 * Pattern:
 *   1. Write to `targetPath + .tmp`
 *   2. Rename .tmp → target  (near-atomic on all platforms)
 *
 * A pre-existing `.bak` is created from the current target before the rename
 * so manual recovery is possible after a crash between steps 2 and 4.
 */
async function atomicWrite(targetPath: string, data: string): Promise<void> {
  const tmpPath = targetPath + TMP_SUFFIX;
  const bakPath = targetPath + BAK_SUFFIX;

  // Step 1: write to staging file
  await fs.promises.writeFile(tmpPath, data, 'utf8');

  // Step 2: back up current file (best-effort; ignore ENOENT)
  try {
    await fs.promises.copyFile(targetPath, bakPath);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      // Unexpected error — log but don't abort the write
      if (process.env.NODE_ENV === 'development') {
        console.warn('[session-manager] Could not create .bak file:', err.message);
      }
    }
  }

  // Step 3: atomic rename staging → target
  await fs.promises.rename(tmpPath, targetPath);
}

/** Ensures the output folder exists before we try to write into it. */
async function ensureOutputFolder(outputFolder: string): Promise<void> {
  await fs.promises.mkdir(path.resolve(outputFolder), { recursive: true });
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a new Session object in memory and immediately persists it to disk.
 *
 * The caller should check for an existing session with `hasExistingSession()`
 * before calling this — `createSession()` will overwrite any existing file.
 *
 * @param settings     Full AppSettings snapshot for this session.
 * @param totalImages  Number of images to process (after filtering).
 * @returns            The newly created Session.
 */
export async function createSession(
  settings: AppSettings,
  totalImages: number,
): Promise<Session> {
  const session: Session = {
    sessionId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    inputFolder: settings.inputFolder,
    outputFolder: settings.outputFolder,
    totalImages,
    scoredCount: 0,
    status: 'running',
    settings,
    scores: {},
    discoveryContext: '',
  };

  await ensureOutputFolder(settings.outputFolder);
  const filePath = sessionFilePath(settings.outputFolder);
  await atomicWrite(filePath, JSON.stringify(session, null, 2));

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[session-manager] Created session ${session.sessionId} ` +
      `(${totalImages} images → ${filePath})`,
    );
  }

  return session;
}

/**
 * Appends a ScoreRecord to the session stored in `outputFolder` and
 * increments `scoredCount`.
 *
 * Uses the write lock to serialise concurrent calls — safe to call from a
 * parallel scoring pool (Phase 11) without external coordination.
 *
 * @param outputFolder  Absolute path to the output folder.
 * @param imageId       The ImageRecord.id for this score (NOT filename).
 * @param score         The ScoreRecord produced by the AI client.
 */
export async function saveScore(
  outputFolder: string,
  imageId: string,
  score: ScoreRecord,
): Promise<void> {
  const filePath = sessionFilePath(outputFolder);

  await withWriteLock(filePath, async () => {
    const session = await _readSessionUnsafe(filePath);
    if (!session) {
      throw new Error(
        `[session-manager] saveScore: session file not found at ${filePath}`,
      );
    }
    session.scores[imageId] = score;
    session.scoredCount = Object.keys(session.scores).length;
    await atomicWrite(filePath, JSON.stringify(session, null, 2));
  });
}

/**
 * Loads the session file from `outputFolder` and returns the parsed Session,
 * or null if no valid session exists.
 *
 * Tries the main file first; falls back to the .bak on JSON parse errors.
 *
 * @param outputFolder  Absolute path to the output folder.
 * @returns             Parsed Session or null.
 */
export async function loadSession(outputFolder: string): Promise<Session | null> {
  const filePath = sessionFilePath(outputFolder);
  return _readSessionUnsafe(filePath);
}

/**
 * Returns true if a valid session file exists in `outputFolder`.
 */
export async function hasExistingSession(outputFolder: string): Promise<boolean> {
  const session = await loadSession(outputFolder);
  return session !== null;
}

/**
 * Returns the Set of ImageRecord.id values that have already been scored,
 * allowing the orchestrator to skip those images on resume.
 */
export function getScoredIds(session: Session): Set<string> {
  return new Set(Object.keys(session.scores));
}

/**
 * Marks the session as completed and persists the status.
 */
export async function markSessionComplete(outputFolder: string): Promise<void> {
  await _updateSessionStatus(outputFolder, 'completed');
}

/**
 * Marks the session as cancelled and persists the status.
 */
export async function markSessionCancelled(outputFolder: string): Promise<void> {
  await _updateSessionStatus(outputFolder, 'cancelled');
}

/**
 * Marks the session as crashed and persists the status.
 */
export async function markSessionCrashed(outputFolder: string): Promise<void> {
  await _updateSessionStatus(outputFolder, 'crashed');
}

/**
 * Stores the discovery-pass context string in the session.
 */
export async function saveDiscoveryContext(
  outputFolder: string,
  context: string,
): Promise<void> {
  const filePath = sessionFilePath(outputFolder);
  const session = await _readSessionUnsafe(filePath);
  if (!session) return;
  session.discoveryContext = context;
  await atomicWrite(filePath, JSON.stringify(session, null, 2));
}

/**
 * Stores the shortfall reasons summary in the session.
 */
export async function saveShortfallReasons(
  outputFolder: string,
  reasons: ShortfallReasons,
): Promise<void> {
  const filePath = sessionFilePath(outputFolder);
  const session = await _readSessionUnsafe(filePath);
  if (!session) return;
  session.outputShortfallReasons = reasons;
  await atomicWrite(filePath, JSON.stringify(session, null, 2));
}

/**
 * Deletes the session file (and .bak if present) from `outputFolder`.
 * No-op if no session file exists.
 */
export async function clearSession(outputFolder: string): Promise<void> {
  const filePath = sessionFilePath(outputFolder);
  const bakPath = filePath + BAK_SUFFIX;
  const tmpPath = filePath + TMP_SUFFIX;

  await Promise.all([
    fs.promises.unlink(filePath).catch(() => {}),
    fs.promises.unlink(bakPath).catch(() => {}),
    fs.promises.unlink(tmpPath).catch(() => {}),
  ]);

  // Release the write lock for this path
  _writeLocks.delete(filePath);

  if (process.env.NODE_ENV === 'development') {
    console.log(`[session-manager] Cleared session at ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Reads and parses the session file at `filePath`.
 * On JSON parse error, attempts the .bak file before returning null.
 * Does NOT acquire the write lock — callers must do that if needed.
 */
async function _readSessionUnsafe(filePath: string): Promise<Session | null> {
  // Try main file
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Session;
  } catch (mainErr: any) {
    if (mainErr?.code === 'ENOENT') return null;

    // JSON parse error or unexpected read error — try .bak
    const bakPath = filePath + BAK_SUFFIX;
    if (process.env.NODE_ENV === 'development') {
      console.warn('[session-manager] Main session file corrupt, trying .bak:', mainErr.message);
    }
    try {
      const raw = await fs.promises.readFile(bakPath, 'utf8');
      const session = JSON.parse(raw) as Session;
      if (process.env.NODE_ENV === 'development') {
        console.log('[session-manager] Recovered from .bak file');
      }
      return session;
    } catch {
      // Both files unreadable
      return null;
    }
  }
}

/**
 * Reads the session, updates its status, and writes it back atomically.
 */
async function _updateSessionStatus(
  outputFolder: string,
  status: SessionStatus,
): Promise<void> {
  const filePath = sessionFilePath(outputFolder);
  const session = await _readSessionUnsafe(filePath);
  if (!session) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[session-manager] _updateSessionStatus: no session found at ${filePath}`);
    }
    return;
  }
  session.status = status;
  await atomicWrite(filePath, JSON.stringify(session, null, 2));

  if (process.env.NODE_ENV === 'development') {
    console.log(`[session-manager] Session ${session.sessionId} → ${status}`);
  }
}