/**
 * src/main/face-detector.ts
 *
 * Phase 6 — Face & Eye Detection
 *
 * Primary library : @vladmandic/human v3 (vladmandic/human on GitHub)
 *   Entry point   : @vladmandic/human/dist/human.node.js  (CommonJS, Node.js-only build)
 *   Backend       : 'tensorflow'  →  @tensorflow/tfjs-node (CPU, no GPU required)
 *   Fallback      : 'wasm'        →  pure-WASM, no native binaries (slower, broad compat)
 *   Last resort   : modern-face-api (already in package.json as emergency fallback)
 *
 * Model files ship inside node_modules/@vladmandic/human/models/ and are
 * excluded from the .asar archive via asarUnpack in electron-builder.config.ts
 * so file:// paths work in packaged builds.
 *
 * Privacy guarantee: zero face data is logged, stored, or transmitted.
 * All detection results are held in memory and discarded after the caller
 * consumes the returned FaceMetadata object.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

import * as path from 'path';
import { app } from 'electron';
import type { FaceMetadata, FaceBoundingBox } from '../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Eye openness score below which a face is considered blinking.
 * Human's iris detector returns a per-eye score in [0, 1].
 * Empirically, fully open ≈ 0.6–1.0, half-open ≈ 0.3–0.6, closed/blink < 0.3.
 */
const BLINK_THRESHOLD = 0.3;

/**
 * Minimum image dimension (width AND height) in pixels required to attempt
 * detection. Images smaller than this are returned as no-face immediately.
 * Human's face detector needs at least 64×64 px of content to be reliable.
 */
const MIN_DIMENSION_PX = 64;

/**
 * Timeout in milliseconds for a single detectFaces() call.
 * Prevents a single large image from hanging the pipeline indefinitely.
 */
const DETECTION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Lazy-initialised Human instance
// ---------------------------------------------------------------------------

type HumanInstance = {
  detect: (input: Buffer | Uint8Array) => Promise<any>;
  load: () => Promise<void>;
};

let _human: HumanInstance | null = null;
let _initPromise: Promise<HumanInstance> | null = null;
let _activeLibrary: 'human' | 'face-api' | 'none' = 'none';

// ---------------------------------------------------------------------------
// Model path resolution
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the @vladmandic/human models directory.
 *
 * In development  : resolves from node_modules next to the project root.
 * In packaged app : resolves from the extraResources destination, which is
 *                   <resources>/models/human (see electron-builder.config.ts).
 */
function getModelsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'models', 'human');
  }
  // Development: walk up from dist/main/ → project root → node_modules
  // __dirname is dist/main/ when compiled, or src/main/ when run via tsx.
  return path.join(__dirname, '..', '..', 'node_modules', '@vladmandic', 'human', 'models');
}

// ---------------------------------------------------------------------------
// Human initialisation
// ---------------------------------------------------------------------------

/**
 * Builds the Human configuration object.
 * Only face-related modules are enabled; body/hand/object/gesture are all off.
 * This reduces model download size and detection time significantly.
 */
function buildHumanConfig(backend: 'tensorflow' | 'wasm', modelsPath: string): object {
  const modelBasePath = `file://${modelsPath}/`;

  return {
    // ── Runtime ──────────────────────────────────────────────────────────────
    backend,
    wasmPath: backend === 'wasm'
      ? path.join(__dirname, '..', '..', 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'wasm-out') + '/'
      : undefined,
    modelBasePath,
    debug: false,
    async: false,           // synchronous mode; we await the promise ourselves
    warmup: 'none',         // skip warmup — we call human.load() explicitly

    // ── Face modules (only what Phase 6 needs) ────────────────────────────────
    face: {
      enabled: true,
      detector: {
        enabled: true,
        rotation: true,     // detect rotated/tilted faces
        maxDetected: 20,    // upper bound; actual limit enforced via maxFacesPerImage
        minConfidence: 0.3,
        iouThreshold: 0.1,
      },
      mesh: {
        enabled: true,      // 468-point 3D face mesh — needed for eye geometry
      },
      iris: {
        enabled: true,      // per-eye openness scores — needed for blink detection
      },
      description: {
        enabled: false,     // age / gender / emotion — not needed, saves ~25 MB
      },
      emotion: {
        enabled: true,      // neutral expression detection
        minConfidence: 0.4,
      },
      antispoof: { enabled: false },
      liveness:  { enabled: false },
    },

    // ── All other detectors off ───────────────────────────────────────────────
    body:        { enabled: false },
    hand:        { enabled: false },
    object:      { enabled: false },
    gesture:     { enabled: false },
    segmentation:{ enabled: false },
  };
}

/**
 * Attempts to initialise @vladmandic/human with the given backend.
 * Returns a Human instance on success, null on failure.
 */
async function tryInitHuman(backend: 'tensorflow' | 'wasm'): Promise<HumanInstance | null> {
  const modelsPath = getModelsPath();
  const devMode = process.env.NODE_ENV === 'development';

  try {
    // Dynamic import so vitest can intercept the module in tests.
    const mod = await import('@vladmandic/human');
    const HumanModule = (mod as any).default || mod;
    const HumanClass = HumanModule.default ?? HumanModule;

    const cfg = buildHumanConfig(backend, modelsPath);
    const instance = new HumanClass(cfg) as HumanInstance;

    if (devMode) {
      console.log(`[face-detector] Initialising Human with backend="${backend}", modelsPath="${modelsPath}"`);
    }

    await instance.load();

    if (devMode) {
      console.log(`[face-detector] Human initialised successfully (backend="${backend}")`);
    }

    _activeLibrary = 'human';
    return instance;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (devMode) {
      console.warn(`[face-detector] Human init failed (backend="${backend}"):`, msg);
    }
    return null;
  }
}

/**
 * Attempts to initialise modern-face-api as an emergency fallback.
 * Returns a thin Human-compatible wrapper, or null on failure.
 *
 * modern-face-api uses its own bundled TF.js and does not need tfjs-node,
 * making it a viable option when the native backend is unavailable.
 */
async function tryInitFaceApi(): Promise<HumanInstance | null> {
  const devMode = process.env.NODE_ENV === 'development';

  try {
    const faceapi = require('modern-face-api') as any;
    const tf      = require('@tensorflow/tfjs-node') as any;

    // modern-face-api needs a canvas module in Node.js to decode images.
    // We'll handle buffer → tensor conversion ourselves, so we just need
    // the detection nets loaded.
    await faceapi.nets.tinyFaceDetector.loadFromUri(
      path.join(__dirname, '..', '..', 'node_modules', 'modern-face-api', 'weights'),
    );
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(
      path.join(__dirname, '..', '..', 'node_modules', 'modern-face-api', 'weights'),
    );

    if (devMode) {
      console.log('[face-detector] modern-face-api fallback initialised');
    }

    // Return a thin wrapper shaped like a Human instance.
    _activeLibrary = 'face-api';
    return {
      load: async () => {},
      detect: async (input: Buffer | Uint8Array) => {
        // Decode image buffer to a tf.Tensor3D that face-api can consume.
        const tensor = tf.node.decodeImage(input, 3) as any;
        try {
          const detections = await faceapi
            .detectAllFaces(tensor, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks(true);
          return { faceApiDetections: detections };
        } finally {
          tensor.dispose();
        }
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (devMode) {
      console.warn('[face-detector] modern-face-api fallback init failed:', msg);
    }
    return null;
  }
}

/**
 * Returns the singleton Human (or face-api) instance, initialising on first call.
 * Tries: tensorflow backend → wasm backend → modern-face-api → throws.
 *
 * The result is cached so subsequent calls return the already-warmed instance.
 */
async function getDetector(): Promise<HumanInstance> {
  if (_human) return _human;

  // Coalesce concurrent first-call initialisations.
  if (_initPromise) return _initPromise;

  _initPromise = (async (): Promise<HumanInstance> => {
    // 1. Try primary backend: @tensorflow/tfjs-node (CPU)
    let instance = await tryInitHuman('tensorflow');

    // 2. Try WASM backend (no native binaries required)
    if (!instance) {
      instance = await tryInitHuman('wasm');
    }

    // 3. Try modern-face-api emergency fallback
    if (!instance) {
      instance = await tryInitFaceApi();
    }

    if (!instance) {
      throw new Error(
        '[face-detector] All face detection backends failed to initialise. ' +
        'Ensure @tensorflow/tfjs-node is installed and model files are present. ' +
        'Run: npm install @tensorflow/tfjs-node',
      );
    }

    _human = instance;
    return instance;
  })();

  return _initPromise;
}

// ---------------------------------------------------------------------------
// Result extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the per-eye openness score from a Human detection result.
 * Returns [leftScore, rightScore] in the range [0, 1].
 * Falls back to [1, 1] (eyes open) if iris data is unavailable.
 */
function getEyeScores(face: any): [number, number] {
  try {
    // Human v3: face.iris is an array of iris data; indices 0=left, 1=right.
    // Each entry has an .openScore property after mesh + iris processing.
    const iris = face.iris as any[] | undefined;
    if (!iris || iris.length < 2) {
      // Iris not detected — check mesh landmarks for eye geometry fallback
      return [1, 1];
    }
    const left  = typeof iris[0]?.openScore === 'number' ? iris[0].openScore as number : 1;
    const right = typeof iris[1]?.openScore === 'number' ? iris[1].openScore as number : 1;
    return [left, right];
  } catch {
    return [1, 1];
  }
}

/**
 * Returns true if the dominant detected emotion is 'neutral'.
 * Falls back to true (neutral) when emotion data is absent.
 */
function isExpressionNeutral(face: any): boolean {
  try {
    const emotion = face.emotion as Array<{ score: number; emotion: string }> | undefined;
    if (!emotion || emotion.length === 0) return true;
    // Sorted descending by score — first entry is the dominant emotion.
    const dominant = emotion[0]?.emotion;
    return dominant === 'neutral';
  } catch {
    return true;
  }
}

/**
 * Extracts a normalised bounding box from a Human face detection result.
 * Human returns box coordinates as fractions of image dimensions when using
 * normalized:true, or as pixel values otherwise. We normalise here.
 */
function extractBoundingBox(face: any, imageWidth: number, imageHeight: number): FaceBoundingBox {
  try {
    const box = face.box ?? face.boxRaw ?? face.detection?.box;
    if (!box) return { x: 0, y: 0, width: 1, height: 1 };

    // Human v3 box: { x, y, width, height } in pixels
    // boxRaw: same values normalised to [0,1]
    if (face.boxRaw) {
      const r = face.boxRaw as { x: number; y: number; width: number; height: number };
      return {
        x:      Math.max(0, Math.min(1, r.x)),
        y:      Math.max(0, Math.min(1, r.y)),
        width:  Math.max(0, Math.min(1, r.width)),
        height: Math.max(0, Math.min(1, r.height)),
      };
    }

    // Normalise pixel box
    const w = imageWidth  || 1;
    const h = imageHeight || 1;
    return {
      x:      Math.max(0, Math.min(1, (box.x      ?? 0) / w)),
      y:      Math.max(0, Math.min(1, (box.y      ?? 0) / h)),
      width:  Math.max(0, Math.min(1, (box.width  ?? w) / w)),
      height: Math.max(0, Math.min(1, (box.height ?? h) / h)),
    };
  } catch {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
}

// ---------------------------------------------------------------------------
// face-api result extraction (fallback path)
// ---------------------------------------------------------------------------

function extractFaceApiResult(
  result: any,
  maxFacesPerImage: number,
): FaceMetadata {
  const detections = result.faceApiDetections as any[] ?? [];
  const faceCount = detections.length;

  if (faceCount === 0) {
    return {
      hasFaces: false,
      faceCount: 0,
      eyesOpen: true,
      blinkDetected: false,
      expressionNeutral: true,
      boundingBoxes: [],
      exceedsFaceLimit: false,
    };
  }

  // modern-face-api returns { detection: { box: {...} }, landmarks: {...} }
  const boundingBoxes: FaceBoundingBox[] = detections.map((d: any) => {
    const box = d?.detection?._box ?? d?.detection?.box ?? {};
    const iw  = d?.detection?._imageDims?.width  || 1;
    const ih  = d?.detection?._imageDims?.height || 1;
    return {
      x:      Math.max(0, Math.min(1, (box.x      ?? 0) / iw)),
      y:      Math.max(0, Math.min(1, (box.y      ?? 0) / ih)),
      width:  Math.max(0, Math.min(1, (box.width  ?? iw) / iw)),
      height: Math.max(0, Math.min(1, (box.height ?? ih) / ih)),
    };
  });

  return {
    hasFaces: true,
    faceCount,
    eyesOpen: true,           // face-api fallback: no iris; assume open
    blinkDetected: false,
    expressionNeutral: true,
    boundingBoxes,
    exceedsFaceLimit: maxFacesPerImage > 0 && faceCount > maxFacesPerImage,
  };
}

// ---------------------------------------------------------------------------
// Image dimension extraction
// ---------------------------------------------------------------------------

/**
 * Reads the image dimensions from a JPEG/PNG buffer without full decode.
 * Uses a minimal header-parsing approach so we avoid an extra sharp call.
 * Falls back to { width: 0, height: 0 } on parse failure.
 */
function readImageDimensions(buffer: Buffer): { width: number; height: number } {
  try {
    // JPEG: FF D8 FF ... SOF0/SOF2 marker contains width/height
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i < buffer.length - 8) {
        if (buffer[i] !== 0xff) break;
        const marker = buffer[i + 1];
        const length = buffer.readUInt16BE(i + 2);
        // SOF markers: C0, C1, C2 contain precision, height, width
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          const height = buffer.readUInt16BE(i + 5);
          const width  = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
        i += 2 + length;
      }
    }

    // PNG: 8-byte signature, then IHDR chunk at offset 8, width at 16, height at 20
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width  = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    return { width: 0, height: 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs face & eye detection on an image buffer.
 *
 * @param imageBuffer       JPEG (or PNG) buffer — typically the 1024px preview
 *                          already produced by image-processor.ts.
 * @param maxFacesPerImage  When > 0, sets `exceedsFaceLimit = true` if the
 *                          detected face count exceeds this value.
 *                          0 = disabled (no limit check).
 * @returns                 A populated FaceMetadata object. Never throws —
 *                          detection failures return a safe empty result.
 */
export async function detectFaces(
  imageBuffer: Buffer,
  maxFacesPerImage = 0,
): Promise<FaceMetadata> {
  const devMode = process.env.NODE_ENV === 'development';

  const EMPTY: FaceMetadata = {
    hasFaces: false,
    faceCount: 0,
    eyesOpen: true,
    blinkDetected: false,
    expressionNeutral: true,
    boundingBoxes: [],
    exceedsFaceLimit: false,
  };

  // ── Input guard: minimum dimension ────────────────────────────────────────
  const { width: imgW, height: imgH } = readImageDimensions(imageBuffer);
  if (imgW > 0 && imgH > 0 && (imgW < MIN_DIMENSION_PX || imgH < MIN_DIMENSION_PX)) {
    if (devMode) {
      console.log(`[face-detector] Skipping detection: image too small (${imgW}×${imgH})`);
    }
    return EMPTY;
  }

  // ── Timeout wrapper ───────────────────────────────────────────────────────
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`[face-detector] Detection timed out after ${DETECTION_TIMEOUT_MS}ms`)),
      DETECTION_TIMEOUT_MS,
    );
  });

  try {
    const detector = await getDetector();

    const result = await Promise.race([
      detector.detect(imageBuffer),
      timeoutPromise,
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    // ── face-api fallback path ─────────────────────────────────────────────
    if (_activeLibrary === 'face-api') {
      return extractFaceApiResult(result, maxFacesPerImage);
    }

    // ── Human result path ──────────────────────────────────────────────────
    const faces = (result?.face as any[]) ?? [];
    const faceCount = faces.length;

    if (faceCount === 0) {
      if (devMode) console.log('[face-detector] No faces detected');
      return EMPTY;
    }

    // Per-face analysis
    let allEyesOpen = true;
    let anyBlink    = false;
    let allNeutral  = true;
    const boundingBoxes: FaceBoundingBox[] = [];

    for (const face of faces) {
      const [leftScore, rightScore] = getEyeScores(face);
      const faceEyesOpen = leftScore > BLINK_THRESHOLD && rightScore > BLINK_THRESHOLD;
      const faceBlink    = leftScore <= BLINK_THRESHOLD || rightScore <= BLINK_THRESHOLD;

      if (!faceEyesOpen) allEyesOpen = false;
      if (faceBlink)     anyBlink    = true;
      if (!isExpressionNeutral(face)) allNeutral = false;

      boundingBoxes.push(extractBoundingBox(face, imgW, imgH));
    }

    const metadata: FaceMetadata = {
      hasFaces: true,
      faceCount,
      eyesOpen: allEyesOpen,
      blinkDetected: anyBlink,
      expressionNeutral: allNeutral,
      boundingBoxes,
      exceedsFaceLimit: maxFacesPerImage > 0 && faceCount > maxFacesPerImage,
    };

    if (devMode) {
      console.log(
        `[face-detector] ${faceCount} face(s) | ` +
        `eyesOpen=${metadata.eyesOpen} | blink=${metadata.blinkDetected} | ` +
        `neutral=${metadata.expressionNeutral} | exceeds=${metadata.exceedsFaceLimit}`,
      );
    }

    return metadata;
  } catch (err: unknown) {
    if (timeoutId) clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    // Detection errors are non-fatal — log and return safe empty result.
    // The pipeline marks such images with faceDetectionFailed counter (Phase 10).
    console.warn('[face-detector] Detection failed (returning empty result):', msg);
    return EMPTY;
  }
}

/**
 * Returns which library is currently active.
 * Useful for logging / diagnostic purposes in Phase 17 tests.
 * Returns 'none' before the first detectFaces() call.
 */
export function getActiveLibrary(): 'human' | 'face-api' | 'none' {
  return _activeLibrary;
}

/**
 * Disposes the active detector instance and releases model memory.
 * Call on app quit to clean up TensorFlow resources gracefully.
 */
export function disposeDetector(): void {
  if (_human) {
    try {
      // Human exposes tf for cleanup
      const h = _human as any;
      if (typeof h.tf?.disposeVariables === 'function') {
        h.tf.disposeVariables();
      }
    } catch {
      // non-fatal
    }
    _human = null;
    _initPromise = null;
    _activeLibrary = 'none';
  }
}