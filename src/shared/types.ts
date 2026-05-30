// =============================================================================
// CullAI — Shared Types
// Used by both the Electron main process and the React renderer.
// =============================================================================

// -----------------------------------------------------------------------------
// Primitives & Filters
// -----------------------------------------------------------------------------

/**
 * Set of file extensions to include during folder scanning.
 * Each entry must include the leading dot, e.g. '.cr3', '.jpg'.
 * An empty Set means "all supported extensions".
 */
export type ExtensionFilter = Set<string>;

/**
 * List of filename prefixes to include during folder scanning.
 * Matching is case-insensitive unless overridden by AppSettings.
 * An empty array means "all filenames".
 * Example: ['IMG_', 'DSC_', '_MG_']
 */
export type PrefixFilter = string[];

/**
 * A single reference image uploaded by the user to guide AI scoring.
 * The base64 string represents a JPEG resized to ≤ 512 px on the longest side.
 * null means no reference image is set.
 */
export type ReferenceImage = {
  filename: string;
  /** JPEG encoded as a plain base64 string (no data-URI prefix). */
  base64: string;
} | null;

// -----------------------------------------------------------------------------
// Scoring
// -----------------------------------------------------------------------------

/**
 * Per-dimension scoring weights. Each value is 0–100 and all six values
 * must sum to exactly 100 when passed to the AI or displayed in the UI.
 */
export type ScoringWeights = {
  quality: number;
  aesthetic: number;
  composition: number;
  sharpness: number;
  exposure: number;
  faceEyes: number;
};

// -----------------------------------------------------------------------------
// Genre Presets
// -----------------------------------------------------------------------------

/**
 * Supported shoot genres. Each maps to a pre-configured ScoringWeights
 * entry in src/shared/genre-presets.ts.
 */
export type GenrePreset =
  | 'general'
  | 'wedding'
  | 'portrait'
  | 'sports'
  | 'landscape'
  | 'street'
  | 'event';

// -----------------------------------------------------------------------------
// AI Provider
// -----------------------------------------------------------------------------

/**
 * Supported AI vision providers.
 * - claude    → Anthropic native API (/v1/messages)
 * - openai    → OpenAI chat completions (/chat/completions)
 * - gemini    → Google Gemini via OpenAI-compatible shim
 * - ollama    → Local Ollama server (no API key required)
 * - custom    → Any OpenAI-compatible endpoint via user-supplied base URL
 */
export type AIProvider = 'claude' | 'openai' | 'gemini' | 'ollama' | 'custom';

// -----------------------------------------------------------------------------
// Style Profile
// -----------------------------------------------------------------------------

/**
 * A saved scoring configuration the user can reuse across sessions.
 */
export type StyleProfile = {
  /** UUID generated at creation time. */
  id: string;
  /** Human-readable label, e.g. "Wedding — Natural Light". */
  name: string;
  genre: GenrePreset;
  weights: ScoringWeights;
  /** Free-text style preference forwarded to the AI prompt. */
  preferenceText: string;
  /** ISO timestamp of when the profile was first created. */
  createdAt: string;
  /** ISO timestamp of the last time this profile was loaded. */
  lastUsedAt: string;
};

// -----------------------------------------------------------------------------
// Image Limiting Strategy
// -----------------------------------------------------------------------------

/**
 * What to do when the culled output falls short of the requested image count.
 * - stop              → Output only available S+A tier images.
 * - fillWithB         → Promote best B-tier images to reach the target.
 * - fillWithRejected  → After B-tier fill, also promote best rejected images.
 */
export type ShortfallStrategy = 'stop' | 'fillWithB' | 'fillWithRejected';

// -----------------------------------------------------------------------------
// Lightroom Integration Mode
// -----------------------------------------------------------------------------

/**
 * How keeper images are delivered after culling.
 * - rateInPlace  → Write XMP ratings next to originals; don't copy files.
 * - copyToOutput → Copy keeper files to the output folder.
 */
export type LightroomMode = 'rateInPlace' | 'copyToOutput';

// -----------------------------------------------------------------------------
// App Settings (all Setup screen fields)
// -----------------------------------------------------------------------------

/**
 * Complete configuration snapshot for a culling session.
 * Persisted via electron-store and restored on app startup.
 */
export type AppSettings = {
  // ── Folders ────────────────────────────────────────────────────────────────
  inputFolder: string;
  outputFolder: string;

  // ── Selection target ───────────────────────────────────────────────────────
  /**
   * How many images to select. 0 means "output all S-tier images" with no
   * count cap.
   */
  numImagesToSelect: number;

  // ── Genre & Scoring ────────────────────────────────────────────────────────
  genre: GenrePreset;
  weights: ScoringWeights;

  // ── Style ──────────────────────────────────────────────────────────────────
  /** ID of the currently loaded StyleProfile, or null if using ad-hoc weights. */
  activeProfileId: string | null;
  /** Free-text description of preferred aesthetics sent to the AI. */
  preferenceText: string;

  // ── AI Provider ────────────────────────────────────────────────────────────
  provider: AIProvider;
  /**
   * API key for the selected provider.
   * The raw value is never stored in AppSettings on disk — it is stored via
   * safeStorage (Phase 3). This field is populated in-memory at runtime after
   * decryption and is cleared before serialisation.
   */
  apiKey: string;
  /** Base URL for Ollama or Custom providers. */
  baseUrl: string;
  /** Model identifier, e.g. 'claude-sonnet-4-20250514' or 'llava'. */
  model: string;
  /** Number of simultaneous API calls (1–10). */
  concurrency: number;

  // ── File Filters ───────────────────────────────────────────────────────────
  /**
   * Extensions to include. Stored as a plain string[] for JSON serialisation;
   * convert to/from Set<string> at the boundary.
   * Empty array = include all supported extensions.
   */
  extensionFilter: string[];
  prefixFilter: PrefixFilter;
  /** Whether prefix matching ignores character case. */
  prefixCaseInsensitive: boolean;

  // ── Reference Image ────────────────────────────────────────────────────────
  referenceImage: ReferenceImage;

  // ── Duplicate / Burst Handling ─────────────────────────────────────────────
  /** If true, every image is scored individually — no burst grouping. */
  disableDuplicateGrouping: boolean;
  /** Hamming-distance threshold for perceptual hash grouping (5–20). */
  duplicateThreshold: number;

  // ── Face Detection ─────────────────────────────────────────────────────────
  /**
   * Images with more than this many detected faces are auto-rejected.
   * 0 = disabled (no limit).
   */
  maxFacesPerImage: number;

  // ── Output & Export ────────────────────────────────────────────────────────
  lightroomMode: LightroomMode;
  /** Write .xmp sidecar files alongside originals. */
  enableXmpExport: boolean;
  /** When output falls short of numImagesToSelect, apply this strategy. */
  shortfallStrategy: ShortfallStrategy;

  // ── Folder Processing ──────────────────────────────────────────────────────
  /** Recurse into subfolders of inputFolder. */
  processSubfolders: boolean;
  /** Mirror subfolder structure in outputFolder (only used when processSubfolders is true). */
  preserveSubfolderStructure: boolean;

  // ── Auto-Tagging (Phase 13b, Pro feature) ──────────────────────────────────
  /** Generate AI keyword tags for S/A-tier keepers. */
  enableAutoTagging: boolean;
  /** Percentage of top S+A keepers to tag (10–100). */
  tagTopPercent: number;

  // ── Dry-Run & Cost ─────────────────────────────────────────────────────────
  /** Estimate token cost and show confirmation before processing. */
  dryRun: boolean;

  // ── RAW Cache (Phase 5b) ───────────────────────────────────────────────────
  /** Maximum disk space for decoded RAW preview cache, in GB. */
  rawCacheMaxSizeGb: number;
  /** Maximum age of a cached preview before it is evicted, in days. */
  rawCacheMaxAgeDays: number;
  /** Disable RAW preview caching entirely. */
  disableRawCache: boolean;
};

// -----------------------------------------------------------------------------
// Default AppSettings factory
// -----------------------------------------------------------------------------

/**
 * Returns a fresh AppSettings object with sensible defaults.
 * Spread-merge with persisted values to upgrade stored settings gracefully.
 */
export function defaultAppSettings(): AppSettings {
  return {
    inputFolder: '',
    outputFolder: '',
    numImagesToSelect: 20,

    genre: 'general',
    weights: {
      quality: 25,
      aesthetic: 20,
      composition: 15,
      sharpness: 15,
      exposure: 10,
      faceEyes: 15,
    },

    activeProfileId: null,
    preferenceText: '',

    provider: 'claude',
    apiKey: '',
    baseUrl: '',
    model: 'claude-sonnet-4-20250514',
    concurrency: 5,

    extensionFilter: [],
    prefixFilter: [],
    prefixCaseInsensitive: true,

    referenceImage: null,

    disableDuplicateGrouping: false,
    duplicateThreshold: 10,

    maxFacesPerImage: 0,

    lightroomMode: 'copyToOutput',
    enableXmpExport: false,
    shortfallStrategy: 'stop',

    processSubfolders: false,
    preserveSubfolderStructure: false,

    enableAutoTagging: false,
    tagTopPercent: 20,

    dryRun: false,

    rawCacheMaxSizeGb: 5,
    rawCacheMaxAgeDays: 30,
    disableRawCache: false,
  };
}

// -----------------------------------------------------------------------------
// Face Detection (populated in Phase 6)
// -----------------------------------------------------------------------------

export type FaceBoundingBox = {
  /** Left edge as a fraction of image width (0–1). */
  x: number;
  /** Top edge as a fraction of image height (0–1). */
  y: number;
  /** Width as a fraction of image width (0–1). */
  width: number;
  /** Height as a fraction of image height (0–1). */
  height: number;
};

export type FaceMetadata = {
  hasFaces: boolean;
  faceCount: number;
  /** true if ALL detected faces have open eyes. */
  eyesOpen: boolean;
  /** true if ANY face shows a blink (eye openness below threshold). */
  blinkDetected: boolean;
  expressionNeutral: boolean;
  boundingBoxes: FaceBoundingBox[];
  /** true when faceCount > AppSettings.maxFacesPerImage (and limit > 0). */
  exceedsFaceLimit: boolean;
};

// -----------------------------------------------------------------------------
// Image Record (populated in Phase 5)
// -----------------------------------------------------------------------------

export type ImageRecord = {
  /** Unique identifier — typically a hash of the absolute file path. */
  id: string;
  /** Absolute path to the original file on disk. */
  filePath: string;
  /** Basename with extension, e.g. 'IMG_0042.CR3'. */
  filename: string;
  isRaw: boolean;
  /**
   * 1024 px JPEG preview encoded as a plain base64 string (no data-URI prefix).
   * Used as the payload sent to the AI API.
   */
  base64: string;
  /** Width of the resized preview in pixels. */
  width: number;
  /** Height of the resized preview in pixels. */
  height: number;
  /**
   * Populated after Phase 6 face detection runs.
   * Optional so the type is valid before face scanning completes.
   */
  faceMetadata?: FaceMetadata;
};

// -----------------------------------------------------------------------------
// Duplicate Detection (Phase 7)
// -----------------------------------------------------------------------------

export type DuplicateGroup = {
  /** The single image that proceeds to AI scoring. */
  representative: ImageRecord;
  /** All other images in the burst cluster — skipped from scoring. */
  duplicates: ImageRecord[];
};

// -----------------------------------------------------------------------------
// Session & Scoring (Phase 8)
// -----------------------------------------------------------------------------

export type ScoreRecord = {
  filename: string;
  /** Per-dimension AI scores, each 0–100. */
  scores: ScoringWeights;
  /** Composite weighted score, 0–100 to 2 decimal places. */
  total: number;
  tier: 'S' | 'A' | 'B' | 'rejected';
  /** Plain-text explanation from the AI. */
  reasoning: string;
  faceMetadata: FaceMetadata;
  /** AI-generated keywords (Phase 13b, Pro feature). */
  keywords?: string[];
  /** Token usage reported by the provider (if available). */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type SessionStatus = 'running' | 'completed' | 'cancelled' | 'crashed';

/**
 * Reasons why the final selected count may have fallen short of the target.
 */
export type ShortfallReasons = {
  duplicatesSkipped: number;
  belowThreshold: number;
  faceDetectionFailed: number;
  exceededFaceLimit: number;
  burstGrouped: number;
};

export type Session = {
  sessionId: string;
  /** ISO timestamp of when this session was created. */
  createdAt: string;
  inputFolder: string;
  outputFolder: string;
  totalImages: number;
  scoredCount: number;
  status: SessionStatus;
  settings: AppSettings;
  /** Map of filename → ScoreRecord, written incrementally. */
  scores: Record<string, ScoreRecord>;
  /** Summary produced by the AI discovery pass. */
  discoveryContext: string;
  outputShortfallReasons?: ShortfallReasons;
};

// -----------------------------------------------------------------------------
// AI Client Types (Phase 9)
// -----------------------------------------------------------------------------

export type AICallParams = {
  imageBase64: string;
  filename: string;
  discoveryContext: string;
  styleProfile: StyleProfile;
  weights: ScoringWeights;
  faceMetadata: FaceMetadata;
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type AIRawResponse = {
  scores: ScoringWeights;
  reasoning: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

// -----------------------------------------------------------------------------
// Pipeline Events (Phase 10)
// -----------------------------------------------------------------------------

export type PipelineEvent =
  | { type: 'pipeline-started'; totalImages: number }
  | { type: 'pipeline-image-scored'; filename: string; score: ScoreRecord; scoredCount: number }
  | { type: 'pipeline-cost-update'; totalInputTokens: number; totalOutputTokens: number }
  | { type: 'pipeline-output-summary'; shortfallReasons: ShortfallReasons; finalSelectedCount: number }
  | { type: 'pipeline-complete'; session: Session }
  | { type: 'pipeline-error'; code: string; message: string; recoverable: boolean };