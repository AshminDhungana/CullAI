/**
 * src/main/benchmark.ts
 *
 * Phase 20.1 — Benchmark Mode
 *
 * Runs a built-in suite of micro-benchmarks against the core pipeline stages,
 * using images from `tests/fixtures/benchmark/` (falls back to `tests/fixtures/`).
 * Prints timings and memory deltas to the console, and optionally writes a JSON
 * report to disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { scanFolder } from './image-processor';
import { isRawFile, decodeRaw } from './raw-decoder';
import { detectFaces } from './face-detector';
import { computeHash, groupDuplicates } from './duplicate-detector';
import { getCacheStats } from './raw-cache';
import { scoreImage } from './ai-client';
import type { ScoreRecord } from '../shared/types'

export interface BenchmarkStageResult {
  name: string;
  durationMs: number;
  itemCount: number;
  details?: Record<string, unknown>;
}

export interface BenchmarkMemorySnapshot {
  rss: number;
  heapUsed: number;
  external: number;
}

export interface BenchmarkReport {
  timestamp: string;
  totalDurationMs: number;
  stages: BenchmarkStageResult[];
  memory: {
    start: BenchmarkMemorySnapshot;
    peak: BenchmarkMemorySnapshot;
  };
  cache: {
    hitRatio: number;
    sizeBytes: number;
    fileCount: number;
  };
  fixtureDir: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function snap(): BenchmarkMemorySnapshot {
  const mem = process.memoryUsage();
  return { rss: mem.rss, heapUsed: mem.heapUsed, external: mem.external };
}

function peakOf(a: BenchmarkMemorySnapshot, b: BenchmarkMemorySnapshot): BenchmarkMemorySnapshot {
  return {
    rss: Math.max(a.rss, b.rss),
    heapUsed: Math.max(a.heapUsed, b.heapUsed),
    external: Math.max(a.external, b.external),
  };
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

// ── Fixture discovery ────────────────────────────────────────────────────────

const BENCHMARK_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'benchmark');
const FALLBACK_DIR = path.join(process.cwd(), 'tests', 'fixtures');

async function discoverFixtures(): Promise<{ dir: string; files: string[] }> {
  if (fs.existsSync(BENCHMARK_DIR)) {
    const entries = await fs.promises.readdir(BENCHMARK_DIR, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => path.join(BENCHMARK_DIR, e.name));
    if (files.length > 0) return { dir: BENCHMARK_DIR, files };
  }

  const entries = await fs.promises.readdir(FALLBACK_DIR, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile())
    .map(e => path.join(FALLBACK_DIR, e.name));
  return { dir: FALLBACK_DIR, files };
}

// ── Main entry ──────────────────────────────────────────────────────────────

/**
 * Runs the full benchmark and returns the report.
 * @param options.includeAiScoring   Whether to include the AI scoring stage (needs an API key).
 */
export async function runBenchmark(includeAiScoring: boolean): Promise<BenchmarkReport> {
  const startTime = performance.now();
  const startMem = snap();
  let peakMem = snap();

  const stages: BenchmarkStageResult[] = [];

  const { dir: fixtureDir, files } = await discoverFixtures();
  const rawFiles = files.filter(isRawFile);
  const imageFiles = files.filter(f => !isRawFile(f));

  // 1. Folder scan ----------------------------------------------------------------
  const stage1 = performance.now();
  const scanned = await scanFolder(fixtureDir, {});
  stages.push({
    name: 'folder_scan',
    durationMs: Math.round(performance.now() - stage1),
    itemCount: scanned.length,
    details: { method: 'scanFolder', fixtureDir },
  });
  peakMem = peakOf(peakMem, snap());

  // 2. RAW decode -------------------------------------------------------------------
  if (rawFiles.length > 0) {
    const stage2 = performance.now();
    const results = await Promise.all(
      rawFiles.map(async (filePath) => {
        try {
          const buf = await decodeRaw(filePath);
          return { success: true, sizeBytes: buf.length };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }),
    );
    stages.push({
      name: 'raw_decode',
      durationMs: Math.round(performance.now() - stage2),
      itemCount: rawFiles.length,
      details: {
        successes: results.filter(r => r.success).length,
        failures: results.filter(r => !r.success).length,
      },
    });
    peakMem = peakOf(peakMem, snap());
  }

  // 3. Face detection --------------------------------------------------------------
  if (imageFiles.length > 0) {
    const stage3 = performance.now();
    const results = await Promise.all(
      imageFiles.map(async (filePath) => {
        try {
          const buf = await fs.promises.readFile(filePath);
          const meta = await detectFaces(buf, 0);
          return { success: true, hasFaces: meta.hasFaces };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }),
    );
    stages.push({
      name: 'face_detection',
      durationMs: Math.round(performance.now() - stage3),
      itemCount: imageFiles.length,
      details: { hasFaces: results.filter(r => r.hasFaces).length },
    });
    peakMem = peakOf(peakMem, snap());
  }

  // 4. Duplicate detection (perceptual hash) ----------------------------------------
  if (imageFiles.length >= 2) {
    const stage4 = performance.now();
    const buffers = await Promise.all(
      imageFiles.map(async (f) => {
        try {
          return await fs.promises.readFile(f);
        } catch {
          return Buffer.alloc(0);
        }
      })
    );
    const hashes = await Promise.all(buffers.map(b => computeHash(b)));
    await groupDuplicates(
      files
        .filter((_, i) => hashes[i])
        .map((f) => ({ filePath: f } as any)),
    );
    stages.push({
      name: 'duplicate_detection',
      durationMs: Math.round(performance.now() - stage4),
      itemCount: imageFiles.length,
    });
    peakMem = peakOf(peakMem, snap());
  }

  // 5. AI scoring (optional, requires API key) ------------------------------------
  if (includeAiScoring && imageFiles.length > 0) {
    const stage5 = performance.now();
    // We'll score the first image if we can
    try {
      const imgBuf = await fs.promises.readFile(imageFiles[0]);
      const base64 = imgBuf.toString('base64');
      const result: any = await scoreImage({
        imageBase64: base64,
        filename: path.basename(imageFiles[0]),
        discoveryContext: 'benchmark test',
        styleProfile: {
          id: 'bench',
          name: 'Benchmark',
          genre: 'general',
          weights: { quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 },
          preferenceText: '',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
        weights: { quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 },
        faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
        provider: 'claude',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: 'claude-sonnet-4-6',
        baseUrl: '',
      });
      stages.push({
        name: 'ai_scoring',
        durationMs: Math.round(performance.now() - stage5),
        itemCount: 1,
        details: { totalScore: result.total },
      });
    } catch (e: any) {
      stages.push({
        name: 'ai_scoring',
        durationMs: Math.round(performance.now() - stage5),
        itemCount: 0,
        details: { skipped: true, reason: e.message },
      });
    }
    peakMem = peakOf(peakMem, snap());
  }

  // 6. Cache stats -----------------------------------------------------------------
  let cacheHitRatio = 0;
  let cacheSizeBytes = 0;
  let cacheFileCount = 0;
  try {
    const stats = await getCacheStats(fixtureDir);
    cacheSizeBytes = stats.sizeBytes || 0;
    cacheFileCount = stats.fileCount || 0;
    // hitRatio is derived from the session, not available globally here
    cacheHitRatio = 0;
  } catch {
    // ignore
  }

  const totalDurationMs = performance.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    totalDurationMs: Math.round(totalDurationMs),
    stages,
    memory: { start: startMem, peak: peakMem },
    cache: { hitRatio: cacheHitRatio, sizeBytes: cacheSizeBytes, fileCount: cacheFileCount },
    fixtureDir,
  };
}

/**
 * Prints a human-readable summary of the benchmark to stdout.
 */
export function printBenchmarkToConsole(report: BenchmarkReport): void {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('              CullAI Benchmark Report                   ');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Timestamp:    ${report.timestamp}`);
  console.log(`Fixture dir:  ${report.fixtureDir}`);
  console.log(`Total time:   ${formatDuration(report.totalDurationMs)}`);
  console.log('\n── Stages ────────────────────────────────────────────');
  for (const stage of report.stages) {
    console.log(`  ${stage.name.padEnd(20)} ${fmtDuration(stage.durationMs).padStart(8)}  (${stage.itemCount} items)`);
    if (stage.details) {
      for (const [k, v] of Object.entries(stage.details)) {
        console.log(`    ${k}: ${v}`);
      }
    }
  }

  const memDelta = {
    rss: report.memory.peak.rss - report.memory.start.rss,
    heapUsed: report.memory.peak.heapUsed - report.memory.start.heapUsed,
    external: report.memory.peak.external - report.memory.start.external,
  };
  console.log('\n── Memory ───────────────────────────────────────────');
  console.log(`  RSS delta:      ${(memDelta.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap delta:     ${(memDelta.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  External delta: ${(memDelta.external / 1024 / 1024).toFixed(1)} MB`);

  if (report.cache.sizeBytes > 0 || report.cache.fileCount > 0) {
    console.log('\n── Cache ────────────────────────────────────────────');
    console.log(`  Size:  ${(report.cache.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Files: ${report.cache.fileCount}`);
  }

  console.log('═══════════════════════════════════════════════════════\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Writes the benchmark JSON report to the output folder.
 * Default filename: `benchmark_YYYYMMDD_HHMMSS.json`
 */
export async function writeBenchmarkReport(report: BenchmarkReport, outputFolder?: string): Promise<string> {
  const dir = outputFolder || process.cwd();
  const date = new Date(report.timestamp);
  const timestamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
  const fileName = `benchmark_${timestamp}.json`;
  const filePath = path.join(dir, fileName);
  await fs.promises.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}