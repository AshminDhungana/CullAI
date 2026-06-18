/**
 * src/main/duplicate-detector.ts
 *
 *
 * ── Library choice ────────────────────────────────────────────────────────────
 * Primary: `imghash` — DCT-based perceptual hashing with a straightforward
 * Node.js API. Operates on file paths and returns a hex hash string.
 *
 * Fallback (if `imghash` cannot hash from a Buffer directly): we write the
 * buffer to a temp file, hash it, then clean up. This keeps the caller API
 * stable regardless of imghash internals.
 *
 * If `imghash` is unavailable at runtime (MODULE_NOT_FOUND), the module
 * gracefully degrades: every image gets a unique random hash, which means
 * no grouping occurs — identical to `disableDuplicateGrouping = true`.
 * This prevents a missing optional dependency from crashing the app.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────────
 * 1. Compute a perceptual hash (pHash) for every ImageRecord via its base64
 *    JPEG preview (already in memory — no extra disk I/O needed).
 * 2. Build a Hamming-distance adjacency: images within `threshold` differing
 *    bits are considered "similar".
 * 3. Use Union-Find (disjoint set) to cluster similar images in O(n·α(n)) time.
 * 4. Within each cluster, sort by filename (lexicographic = chronological for
 *    burst sequences like IMG_0041–IMG_0045) and designate index 0 as the
 *    representative.
 * 5. Singletons (images with no near-duplicate) each become their own
 *    single-member DuplicateGroup with an empty `duplicates` array.
 *
 * ── Exported surface ──────────────────────────────────────────────────────────
 *   computeHash(buffer)            → Promise<string>
 *   hammingDistance(hashA, hashB)  → number
 *   groupDuplicates(images, threshold) → Promise<DuplicateGroup[]>
 *   DEFAULT_SIMILARITY_THRESHOLD   = 10
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { ImageRecord, DuplicateGroup } from '../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default Hamming-distance threshold for perceptual-hash grouping.
 *
 * Two images whose pHash strings differ in ≤ 10 bits are considered duplicates
 * (burst shots, nearly identical exposures). Empirically:
 *   0–5   → pixel-identical or nearly identical
 *   6–10  → same scene, minor exposure/framing differences (typical burst)
 *   11–20 → similar composition but clearly different shots
 *   > 20  → different images
 *
 * Users can override this via AppSettings.duplicateThreshold (range 5–20).
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 10;

/**
 * Maximum number of hex characters we read when computing Hamming distance.
 * imghash returns a 64-bit DCT hash as a 16-char hex string by default.
 * We cap at 64 hex chars (256 bits) to handle any hash width safely.
 */
const MAX_HASH_HEX_CHARS = 64;

// ---------------------------------------------------------------------------
// imghash lazy loader
// ---------------------------------------------------------------------------

type ImghashModule = {
  hash: (input: string, bits?: number, format?: string) => Promise<string>;
};

let _imghash: ImghashModule | null | undefined = undefined; // undefined = not yet probed

async function getImghash(): Promise<ImghashModule | null> {
  if (_imghash !== undefined) return _imghash;
  try {
    const mod = await import('imghash');
    // imghash is a CJS module — grab .default when wrapped by ESM import
    _imghash = (mod as any).default || mod;
    if (process.env.NODE_ENV === 'development') {
      console.log('[duplicate-detector] imghash loaded successfully');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      '[duplicate-detector] imghash not available — duplicate grouping disabled:',
      msg,
    );
    _imghash = null;
  }
  return _imghash ?? null;
}

// ---------------------------------------------------------------------------
// Public: computeHash
// ---------------------------------------------------------------------------

/**
 * Computes a perceptual DCT hash of a JPEG (or PNG) image buffer.
 *
 * Strategy:
 *   1. Write `imageBuffer` to a temp file (imghash requires a file path).
 *   2. Call `imghash.hash()` on that path to get a hex hash string.
 *   3. Delete the temp file.
 *
 * If imghash is unavailable, returns a random 16-char hex string so the
 * caller still gets a unique (non-matching) hash and grouping is effectively
 * disabled without throwing.
 *
 * @param imageBuffer  JPEG or PNG buffer — typically the 1024 px preview
 *                     already produced by image-processor.ts.
 * @returns            Hex perceptual hash string (e.g. "d5c86c4f8a3b1e2d").
 */
export async function computeHash(imageBuffer: Buffer): Promise<string> {
  const imghash = await getImghash();

  if (!imghash) {
    // Graceful degradation: return a guaranteed-unique hash so no two images
    // are ever grouped when the library is absent.
    return crypto.randomBytes(8).toString('hex');
  }

  // Write buffer to a uniquely named temp file so imghash can open it.
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `cullai_hash_${crypto.randomBytes(6).toString('hex')}.jpg`);

  try {
    await fs.promises.writeFile(tmpFile, imageBuffer);
    // imghash.hash(path, bits, format):
    //   bits=8 → 8×8 DCT = 64-bit hash → 16-char hex (default, good balance)
    //   format='hex' → returns lowercase hex string
    const hash = await imghash.hash(tmpFile, 8, 'hex');
    return hash;
  } finally {
    // Always clean up — failure to delete is non-fatal (OS will reclaim on next boot)
    fs.promises.unlink(tmpFile).catch(() => {/* non-fatal */});
  }
}

// ---------------------------------------------------------------------------
// Public: hammingDistance
// ---------------------------------------------------------------------------

/**
 * Counts the number of differing bits between two hex-encoded hash strings.
 *
 * Converts each pair of hex characters to a byte, XORs them, then counts
 * the set bits with a lookup table. Handles hashes of unequal length by
 * treating the shorter one as if zero-padded on the right.
 *
 * @param hashA  Hex hash string, e.g. "d5c86c4f8a3b1e2d"
 * @param hashB  Hex hash string of the same or similar length.
 * @returns      Number of differing bits (0 = identical, higher = more different).
 */
export function hammingDistance(hashA: string, hashB: string): number {
  // Normalise to same length, capped at MAX_HASH_HEX_CHARS
  const len = Math.min(
    Math.max(hashA.length, hashB.length),
    MAX_HASH_HEX_CHARS,
  );

  let distance = 0;

  for (let i = 0; i < len; i += 2) {
    const byteA = parseInt(hashA.slice(i, i + 2) || '00', 16);
    const byteB = parseInt(hashB.slice(i, i + 2) || '00', 16);
    const xor = byteA ^ byteB;
    // Brian Kernighan bit-count
    let v = xor;
    while (v) {
      distance += v & 1;
      v >>>= 1;
    }
  }

  return distance;
}

// ---------------------------------------------------------------------------
// Union-Find (Disjoint Set Union) — internal clustering helper
// ---------------------------------------------------------------------------

/**
 * Minimal Union-Find implementation using path compression and union-by-rank.
 * Used to cluster images into groups based on pairwise Hamming distance.
 */
class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    // Path compression
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;

    // Union by rank
    if (this.rank[rx] < this.rank[ry]) {
      this.parent[rx] = ry;
    } else if (this.rank[rx] > this.rank[ry]) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
  }
}

// ---------------------------------------------------------------------------
// Public: groupDuplicates
// ---------------------------------------------------------------------------

/**
 * Groups a list of ImageRecords into duplicate clusters using perceptual hashing.
 *
 * Steps:
 *  1. Compute a pHash for each image (decoding from the in-memory base64 preview).
 *  2. Compare every pair — O(n²) which is acceptable for typical burst-shot counts
 *     (< 5 000 images per folder). For very large sets (Phase 20) a kd-tree or
 *     BK-tree over the Hamming space would reduce this to O(n log n).
 *  3. Use Union-Find to form clusters: images A and B are in the same cluster if
 *     hammingDistance(A, B) ≤ threshold.
 *  4. Within each cluster, sort by filename (lexicographic order corresponds to
 *     chronological capture order for standard camera naming conventions like
 *     IMG_0041, IMG_0042 …).
 *  5. The cluster member at sorted index 0 becomes the `representative`; all
 *     others are `duplicates` (skipped from AI scoring).
 *  6. Single-image clusters get an empty `duplicates` array.
 *
 * @param images     Array of ImageRecords to analyse. May be empty.
 * @param threshold  Hamming-distance threshold (0–64). Images within this
 *                   many differing bits are considered duplicates.
 *                   Defaults to DEFAULT_SIMILARITY_THRESHOLD (10).
 * @returns          Array of DuplicateGroup objects. Length ≤ images.length.
 *                   If images is empty, returns [].
 */
export async function groupDuplicates(
  images: ImageRecord[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
  _hashFn?: (record: ImageRecord) => Promise<string>,
): Promise<DuplicateGroup[]> {
  const devMode = process.env.NODE_ENV === 'development';
  const n = images.length;

  if (n === 0) return [];

  // ── 1. Compute hashes ──────────────────────────────────────────────────────
  const startMs = devMode ? Date.now() : 0;

  const hashes: string[] = await Promise.all(
    images.map(async (record) => {
      try {
        if (_hashFn) {
          return await _hashFn(record);
        }
        const buffer = Buffer.from(record.base64, 'base64');
        return await computeHash(buffer);
      } catch (err: unknown) {
        // Hash failure — give the image a unique random hash so it forms its
        // own singleton group and is not accidentally grouped with anything.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[duplicate-detector] Hash failed for ${record.filename} — treating as unique: ${msg}`,
        );
        return crypto.randomBytes(8).toString('hex');
      }
    }),
  );

  if (devMode) {
    console.log(
      `[duplicate-detector] Hashed ${n} images in ${Date.now() - startMs} ms ` +
      `(threshold=${threshold})`,
    );
  }

  // ── 2. Build clusters with Union-Find ─────────────────────────────────────
  const uf = new UnionFind(n);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = hammingDistance(hashes[i], hashes[j]);
      if (dist <= threshold) {
        uf.union(i, j);
      }
    }
  }

  // ── 3. Collect members into clusters keyed by root ────────────────────────
  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(i);
  }

  // ── 4 & 5. Build DuplicateGroup array ─────────────────────────────────────
  const groups: DuplicateGroup[] = [];

  for (const [, indices] of clusterMap) {
    // Sort members by filename for stable, chronological ordering.
    indices.sort((a, b) => images[a].filename.localeCompare(images[b].filename));

    const [repIdx, ...dupIdxs] = indices;
    groups.push({
      representative: images[repIdx],
      duplicates: dupIdxs.map((i) => images[i]),
    });
  }

  if (devMode) {
    const totalDupes = groups.reduce((acc, g) => acc + g.duplicates.length, 0);
    console.log(
      `[duplicate-detector] ${n} images → ${groups.length} group(s), ` +
      `${totalDupes} duplicate(s) suppressed`,
    );
  }

  return groups;
}