/**
 * src/scripts/download-fixtures.ts
 *
 * Downloads a set of CC0-licensed RAW sample files into tests/fixtures/.
 * Run this once before running the manual decode test.
 *
 * Usage:
 *   npm run download-fixtures
 *   npx tsx --tsconfig tsconfig.main.json src/scripts/download-fixtures.ts
 *
 * Sources:
 *   All files are sourced from raw.pixls.us, a community-maintained archive
 *   of CC0-licensed RAW samples donated by camera manufacturers and users.
 *   See https://raw.pixls.us for licence details.
 *
 * These binary files are excluded from git (see tests/fixtures/.gitignore).
 * Re-run this script after a fresh clone to repopulate the fixtures folder.
 *
 * To add more formats: append entries to FIXTURES below following the same
 * shape. URL, expected filename, and brand are all you need.
 */

import * as fs       from 'fs';
import * as path     from 'path';
import * as https    from 'https';
import * as http     from 'http';
import * as crypto   from 'crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT  = path.resolve(__dirname, '..', '..');
const FIXTURES_DIR  = path.join(PROJECT_ROOT, 'tests', 'fixtures');

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const green  = (s: string) => `${C.green}${s}${C.reset}`;
const red    = (s: string) => `${C.red}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const cyan   = (s: string) => `${C.cyan}${s}${C.reset}`;
const bold   = (s: string) => `${C.bold}${s}${C.reset}`;
const dim    = (s: string) => `${C.dim}${s}${C.reset}`;

// ---------------------------------------------------------------------------
// Fixture definitions
//
// One entry per target format. Files are sourced from raw.pixls.us CC0 archive.
// sha256 is the expected hex digest of the downloaded file — used to detect
// corrupted downloads. Leave as empty string '' to skip verification.
//
// To find URLs for additional formats, browse: https://raw.pixls.us/
// ---------------------------------------------------------------------------

interface FixtureSpec {
  /** Friendly brand/model label shown in download progress. */
  label: string;
  /** RAW format this fixture covers. */
  format: string;
  /** Direct download URL. */
  url: string;
  /** Expected output filename in tests/fixtures/. */
  filename: string;
  /** SHA-256 hex digest for integrity check ('' = skip check). */
  sha256: string;
}

const FIXTURES: FixtureSpec[] = [
  // ── Canon CR3 ─────────────────────────────────────────────────────────────
  {
    label:    'Canon EOS R5',
    format:   '.cr3',
    url:      'https://raw.pixls.us/data/Canon/EOS%20R5/Canon_EOS_R5_RAW_ISO_100_nocrop_nodual.CR3',
    filename: 'canon-eos-r5-sample.cr3',
    sha256:   '',
  },
  // ── Nikon NEF ─────────────────────────────────────────────────────────────
  {
    label:    'Nikon Z6 II',
    format:   '.nef',
    url:      'https://raw.pixls.us/data/Nikon/Z%206_2/CZP_0300.NEF',
    filename: 'nikon-z6ii-sample.nef',
    sha256:   '',
  },
  // ── Sony ARW ──────────────────────────────────────────────────────────────
  {
    label:    'Sony A7 III',
    format:   '.arw',
    url:      'https://raw.pixls.us/data/Sony/ILCE-7M3/UNCOMPRESSED_14bit.ARW',
    filename: 'sony-a7iii-sample.arw',
    sha256:   '',
  },
  // ── Fujifilm RAF ──────────────────────────────────────────────────────────
  {
    label:    'Fujifilm X-T4',
    format:   '.raf',
    url:      'https://raw.pixls.us/data/Fujifilm/X-T4/DSCF0267.RAF',
    filename: 'fujifilm-xt4-sample.raf',
    sha256:   '',
  },
  // ── Adobe DNG ─────────────────────────────────────────────────────────────
  {
    label:    'Leica Q2 (DNG)',
    format:   '.dng',
    url:      'https://raw.pixls.us/data/Leica/Q2/L1000750.DNG',
    filename: 'leica-q2-sample.dng',
    sha256:   '',
  },
];

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

interface DownloadResult {
  label:    string;
  format:   string;
  filename: string;
  status:   'downloaded' | 'skipped' | 'failed';
  bytes:    number;
  error:    string | null;
}

/**
 * Download `url` to `destPath`, following up to `maxRedirects` redirects.
 * Streams directly to disk — does not buffer the whole file in memory.
 */
function downloadFile(
  url: string,
  destPath: string,
  maxRedirects = 5,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl: string, redirectsLeft: number) => {
      const client = currentUrl.startsWith('https://') ? https : http;

      const req = client.get(currentUrl, { timeout: 60_000 }, (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectsLeft === 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(res.headers.location, currentUrl).toString();
          res.resume(); // drain
          attempt(next, redirectsLeft - 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
          return;
        }

        // Stream to a temp file, then rename atomically
        const tmpPath = `${destPath}.tmp`;
        const stream  = fs.createWriteStream(tmpPath);
        let bytes = 0;

        res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        res.pipe(stream);

        stream.on('finish', () => {
          fs.renameSync(tmpPath, destPath);
          resolve(bytes);
        });
        stream.on('error', (err) => {
          fs.unlink(tmpPath, () => {});
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 60s'));
      });
    };

    attempt(url, maxRedirects);
  });
}

/** Compute SHA-256 hex digest of a file on disk. */
function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

function printProgress(
  current: number,
  total: number,
  label: string,
  state: 'downloading' | 'verifying' | 'done' | 'skipped' | 'failed',
  extra = '',
): void {
  const states: Record<typeof state, string> = {
    downloading: dim('↓ downloading'),
    verifying:   dim('  verifying  '),
    done:        green('✓ done       '),
    skipped:     yellow('  skipped    '),
    failed:      red('✗ failed     '),
  };
  const counter = dim(`[${String(current).padStart(String(total).length)}/${total}]`);
  process.stdout.write(
    `\r  ${counter} ${states[state]}  ${cyan(label.padEnd(30))}  ${dim(extra)}          `,
  );
  if (state === 'done' || state === 'skipped' || state === 'failed') {
    process.stdout.write('\n');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  console.log('');
  console.log(bold('  CullAI — Fixture Downloader'));
  console.log(dim(`  Destination: ${FIXTURES_DIR}`));
  console.log(dim('  Source: raw.pixls.us (CC0 licensed)'));
  console.log('');

  const results: DownloadResult[] = [];
  let idx = 0;

  for (const fixture of FIXTURES) {
    idx++;
    const destPath = path.join(FIXTURES_DIR, fixture.filename);

    // Skip if already downloaded and (if we have a hash) verified
    if (fs.existsSync(destPath)) {
      if (fixture.sha256) {
        const actual = sha256File(destPath);
        if (actual === fixture.sha256) {
          printProgress(idx, FIXTURES.length, fixture.label, 'skipped', 'already verified');
          results.push({ ...fixture, status: 'skipped', bytes: fs.statSync(destPath).size, error: null });
          continue;
        }
        // Hash mismatch — re-download
        console.log(yellow(`\n  Checksum mismatch for ${fixture.filename} — re-downloading...`));
        fs.unlinkSync(destPath);
      } else {
        printProgress(idx, FIXTURES.length, fixture.label, 'skipped', 'already present');
        results.push({ ...fixture, status: 'skipped', bytes: fs.statSync(destPath).size, error: null });
        continue;
      }
    }

    try {
      printProgress(idx, FIXTURES.length, fixture.label, 'downloading', fixture.format);
      const bytes = await downloadFile(fixture.url, destPath);

      if (fixture.sha256) {
        printProgress(idx, FIXTURES.length, fixture.label, 'verifying', '');
        const actual = sha256File(destPath);
        if (actual !== fixture.sha256) {
          fs.unlinkSync(destPath);
          throw new Error(`SHA-256 mismatch: expected ${fixture.sha256}, got ${actual}`);
        }
      }

      const kb = (bytes / 1024).toFixed(0);
      printProgress(idx, FIXTURES.length, fixture.label, 'done', `${kb} KB`);
      results.push({ ...fixture, status: 'downloaded', bytes, error: null });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printProgress(idx, FIXTURES.length, fixture.label, 'failed', message);
      results.push({ ...fixture, status: 'failed', bytes: 0, error: message });
    }
  }

  // Summary
  const downloaded = results.filter(r => r.status === 'downloaded').length;
  const skipped    = results.filter(r => r.status === 'skipped').length;
  const failed     = results.filter(r => r.status === 'failed').length;

  console.log('');
  console.log(dim(`  ${downloaded} downloaded  ${skipped} skipped  ${failed > 0 ? red(`${failed} failed`) : dim(`${failed} failed`)}`));

  if (failed > 0) {
    console.log('');
    console.log(yellow('  Some downloads failed. This usually means:'));
    console.log(dim('    • raw.pixls.us is temporarily unavailable'));
    console.log(dim('    • The URL path for that camera model has changed'));
    console.log(dim('    • You are behind a proxy — try downloading manually'));
    console.log(dim(''));
    console.log(dim('  Manual alternatives:'));
    console.log(dim('    • Browse https://raw.pixls.us/ and save files to tests/fixtures/'));
    console.log(dim('    • Use your own camera\'s RAW files — any .cr3/.nef/.arw/.raf/.dng works'));
    console.log(dim('    • Check src/scripts/download-fixtures.ts and update the URLs'));

    for (const r of results.filter(r => r.status === 'failed')) {
      console.log(dim(`    ✗ ${r.label}: ${r.error}`));
    }
  }

  if (downloaded + skipped > 0) {
    console.log('');
    console.log(bold('  Next step:'));
    console.log(dim('    npm run test:raw'));
    console.log(dim('    — or —'));
    console.log(dim('    npx tsx --tsconfig tsconfig.main.json src/scripts/test-raw-decode.ts'));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(red('\n  Unexpected error:'), err);
  process.exit(1);
});