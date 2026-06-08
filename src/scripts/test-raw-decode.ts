/**
 * src/scripts/test-raw-decode.ts
 *
 * Manual test script for Phase 4.3 — RAW decoder validation.
 *
 * For each RAW fixture found in tests/fixtures/ (or a custom path), this
 * script:
 *   1. Decodes the file to a full-quality JPEG buffer via decodeRaw().
 *   2. Writes the output JPEG to tests/fixtures/output/ for visual inspection.
 *   3. Records decode time, output size, and pass/fail status.
 *   4. Prints a formatted summary table.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.main.json src/scripts/test-raw-decode.ts
 *   npx tsx --tsconfig tsconfig.main.json src/scripts/test-raw-decode.ts /path/to/raw/files
 *
 * The optional path argument lets you point at any folder of RAW files — useful
 * when testing against your own camera's output before moving to fixtures.
 *
 * Prerequisites:
 *   • Run `npm run download-fixtures` first to populate tests/fixtures/, OR
 *   • Drop your own RAW files into tests/fixtures/ manually.
 *   • The native lightdrift-libraw addon must be built: `npm run postinstall`
 *
 * This script runs in plain Node via tsx — no Electron context required.
 * lightdrift-libraw has no Electron dependency (only node-addon-api + sharp).
 */

import * as fs   from 'fs';
import * as path from 'path';
import { decodeRaw, isRawFile, RawDecodeError, RAW_EXTENSIONS } from '../main/raw-decoder';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT  = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'tests', 'fixtures');
const OUTPUT_DIR    = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'output');

// ---------------------------------------------------------------------------
// ANSI colour helpers (no chalk dep — keeps this script zero-dependency)
// ---------------------------------------------------------------------------
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

function green (s: string) { return `${C.green}${s}${C.reset}`; }
function red   (s: string) { return `${C.red}${s}${C.reset}`; }
function yellow(s: string) { return `${C.yellow}${s}${C.reset}`; }
function cyan  (s: string) { return `${C.cyan}${s}${C.reset}`; }
function bold  (s: string) { return `${C.bold}${s}${C.reset}`; }
function dim   (s: string) { return `${C.dim}${s}${C.reset}`; }

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface DecodeResult {
  filename:    string;
  ext:         string;
  status:      'pass' | 'fail';
  elapsedMs:   number;
  outputBytes: number;
  outputPath:  string | null;
  error:       string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pad a string to a fixed width, truncating with '…' if too long. */
function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const truncated = s.length > width ? s.slice(0, width - 1) + '…' : s;
  const padded = align === 'right'
    ? truncated.padStart(width)
    : truncated.padEnd(width);
  return padded;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(0)} ms`;
}

/**
 * Collect all RAW files in `dir` (non-recursive, skipping hidden files and
 * the output/ subdirectory).
 */
function collectRawFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(e =>
      e.isFile() &&
      !e.name.startsWith('.') &&
      isRawFile(e.name),
    )
    .map(e => path.join(dir, e.name))
    .sort();
}

// ---------------------------------------------------------------------------
// Core decode loop
// ---------------------------------------------------------------------------

async function decodeFile(
  filePath: string,
  outputDir: string,
): Promise<DecodeResult> {
  const filename = path.basename(filePath);
  const ext      = path.extname(filename).toLowerCase();
  const stem     = path.basename(filename, path.extname(filename));
  const outputFilename = `${stem}__decoded.jpg`;
  const outputPath     = path.join(outputDir, outputFilename);

  const start = process.hrtime.bigint();

  try {
    const buffer = await decodeRaw(filePath);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    fs.writeFileSync(outputPath, buffer);

    return {
      filename,
      ext,
      status:      'pass',
      elapsedMs,
      outputBytes: buffer.length,
      outputPath,
      error:       null,
    };
  } catch (err) {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const message   = err instanceof RawDecodeError
      ? err.reason
      : err instanceof Error
        ? err.message
        : String(err);

    return {
      filename,
      ext,
      status:      'fail',
      elapsedMs,
      outputBytes: 0,
      outputPath:  null,
      error:       message,
    };
  }
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function printSummary(results: DecodeResult[], inputDir: string): void {
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);

  // Column widths
  const W = { file: 32, ext: 6, status: 8, time: 10, size: 10, note: 40 };

  const divider = dim('─'.repeat(
    W.file + W.ext + W.status + W.time + W.size + W.note + 15,
  ));

  console.log('');
  console.log(bold('  CullAI — RAW Decode Test Results'));
  console.log(dim(`  Input:  ${inputDir}`));
  console.log(dim(`  Output: ${OUTPUT_DIR}`));
  console.log('');
  console.log(divider);
  console.log(
    `  ${bold(pad('File', W.file))}  ` +
    `${bold(pad('Ext', W.ext))}  ` +
    `${bold(pad('Status', W.status))}  ` +
    `${bold(pad('Time', W.time, 'right'))}  ` +
    `${bold(pad('Size', W.size, 'right'))}  ` +
    `${bold(pad('Note', W.note))}`,
  );
  console.log(divider);

  for (const r of results) {
    const statusStr = r.status === 'pass' ? green(pad('PASS', W.status)) : red(pad('FAIL', W.status));
    const timeStr   = pad(formatMs(r.elapsedMs), W.time, 'right');
    const sizeStr   = r.status === 'pass'
      ? pad(formatBytes(r.outputBytes), W.size, 'right')
      : pad('—', W.size, 'right');
    const noteStr   = r.status === 'fail'
      ? red(pad(r.error ?? '', W.note))
      : r.outputPath
        ? dim(pad(path.basename(r.outputPath), W.note))
        : '';

    console.log(
      `  ${cyan(pad(r.filename, W.file))}  ` +
      `${pad(r.ext, W.ext)}  ` +
      `${statusStr}  ` +
      `${timeStr}  ` +
      `${sizeStr}  ` +
      `${noteStr}`,
    );
  }

  console.log(divider);

  // Per-format timing breakdown
  if (passed.length > 0) {
    console.log('');
    console.log(bold('  Timing by format:'));
    const byExt: Record<string, DecodeResult[]> = {};
    for (const r of passed) {
      (byExt[r.ext] ??= []).push(r);
    }
    for (const [ext, group] of Object.entries(byExt).sort()) {
      const avg = group.reduce((s, r) => s + r.elapsedMs, 0) / group.length;
      const min = Math.min(...group.map(r => r.elapsedMs));
      const max = Math.max(...group.map(r => r.elapsedMs));
      const label = group.length > 1
        ? `avg ${formatMs(avg)}  min ${formatMs(min)}  max ${formatMs(max)}`
        : formatMs(avg);
      console.log(`    ${cyan(pad(ext, 8))} ${label}  ${dim(`(${group.length} file${group.length > 1 ? 's' : ''})`)}`);
    }
  }

  // Footer
  console.log('');
  const overallStatus = failed.length === 0
    ? green(`✓ All ${passed.length} file${passed.length !== 1 ? 's' : ''} passed`)
    : red(`✗ ${failed.length} failed`) + dim(` / `) + green(`${passed.length} passed`);

  console.log(`  ${overallStatus}   ${dim(`total: ${formatMs(totalMs)}`)}`);

  if (passed.length > 0) {
    console.log('');
    console.log(bold(`  Next step:`));
    console.log(dim(`  Open the output JPEGs in a viewer and check:`));
    console.log(dim(`    • Correct colours (not green/magenta cast)`));
    console.log(dim(`    • No banding, corruption, or solid-colour blocks`));
    console.log(dim(`    • Correct orientation (matches camera EXIF rotation)`));
    console.log(dim(`    • Reasonable exposure (not clipped black or white)`));
    console.log(dim(`    Output folder: ${OUTPUT_DIR}`));
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const inputDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_INPUT;

  console.log('');
  console.log(bold('  CullAI — Phase 4.3 RAW Decode Manual Test'));
  console.log(dim(`  Supported extensions: ${RAW_EXTENSIONS.join('  ')}`));
  console.log('');

  // Validate input directory
  if (!fs.existsSync(inputDir)) {
    console.error(red(`  Error: input directory not found: ${inputDir}`));
    console.error(dim('  Run `npm run download-fixtures` to populate tests/fixtures/,'));
    console.error(dim('  or pass a custom folder: npx tsx src/scripts/test-raw-decode.ts /path/to/raws'));
    process.exit(1);
  }

  const files = collectRawFiles(inputDir);

  if (files.length === 0) {
    console.error(yellow(`  No RAW files found in: ${inputDir}`));
    console.error(dim(`  Supported extensions: ${RAW_EXTENSIONS.join('  ')}`));
    console.error(dim('  Run `npm run download-fixtures` to populate tests/fixtures/,'));
    console.error(dim('  or drop RAW files into the folder manually.'));
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(dim(`  Found ${files.length} RAW file${files.length !== 1 ? 's' : ''} in ${inputDir}`));
  console.log(dim(`  Writing output JPEGs to ${OUTPUT_DIR}`));
  console.log('');

  // Decode each file sequentially (manual test — throughput not the goal here)
  const results: DecodeResult[] = [];

  for (const filePath of files) {
    const filename = path.basename(filePath);
    process.stdout.write(dim(`  Decoding ${filename}...`));

    const result = await decodeFile(filePath, OUTPUT_DIR);
    results.push(result);

    if (result.status === 'pass') {
      process.stdout.write(`\r  ${green('✓')} ${pad(filename, 40)} ${dim(formatMs(result.elapsedMs))}  ${dim(formatBytes(result.outputBytes))}\n`);
    } else {
      process.stdout.write(`\r  ${red('✗')} ${pad(filename, 40)} ${red(result.error ?? 'unknown error')}\n`);
    }
  }

  printSummary(results, inputDir);

  const exitCode = results.some(r => r.status === 'fail') ? 1 : 0;
  process.exit(exitCode);
}

main().catch(err => {
  console.error(red('\n  Unexpected error:'), err);
  process.exit(1);
});