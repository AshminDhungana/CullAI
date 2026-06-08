/**
 * src/shared/license.ts
 *
 * Shared license types and constants. Safe to import in both main and renderer.
 */

export type LicenseTier = 'free' | 'pro' | 'lifetime';

export interface LicenseFile {
  tier: LicenseTier;
  issuedAt: string;      // ISO-8601
  deviceId: string;      // SHA-256 truncated fingerprint
  signature: string;     // HMAC-SHA256 of the file payload
}

export interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  deviceBound: boolean;
  checksumOk: boolean;
}

export interface UsageRecord {
  monthKey: string;      // 'YYYY-MM'
  count: number;
  lastVerifiedAt: string; // ISO-8601
}

export const TIER_LIMITS: Record<LicenseTier, number> = {
  free: 500,
  pro: 5000,
  lifetime: Infinity,
};

export const TIER_LABELS: Record<LicenseTier, string> = {
  free: 'Free',
  pro: 'Pro',
  lifetime: 'Lifetime',
};

// ---------------------------------------------------------------------------
// Feature gates
// ---------------------------------------------------------------------------

/**
 * All gatable features. Adding a new feature here is the only place a
 * developer needs to touch to register it — the tier map, isAllowed(), and
 * the IPC handler all derive from this tuple automatically.
 */
export const FEATURES = [
  'rawFormats',        // RAW file processing (CR3, NEF, ARW, …)
  'xmpExport',         // Lightroom / Capture One sidecar export
  'unlimitedImages',   // >500 images/month (Free cap enforced by usage-tracker)
  'unlimitedProfiles', // >2 saved style profiles
  'autoTagging',       // AI keyword tagging — Phase 13b
] as const;

export type Feature = typeof FEATURES[number];

/**
 * Minimum tier required for each feature.
 * 'free'     → everyone gets it.
 * 'pro'      → Pro and Lifetime only.
 * 'lifetime' → Lifetime only (reserved for future use).
 */
const FEATURE_TIER_MAP: Record<Feature, LicenseTier> = {
  rawFormats:        'pro',
  xmpExport:         'pro',
  unlimitedImages:   'pro',
  unlimitedProfiles: 'pro',
  autoTagging:       'pro',
};

/** Numeric rank used for tier comparisons. Higher = more access. */
const TIER_RANK: Record<LicenseTier, number> = {
  free: 0,
  pro: 1,
  lifetime: 2,
};

/**
 * Returns true if `tier` is allowed to use `feature`.
 *
 * Pure function — no Electron imports, safe to call in both main and renderer.
 *
 * @example
 * isAllowed('xmpExport', 'free')     // false
 * isAllowed('xmpExport', 'pro')      // true
 * isAllowed('xmpExport', 'lifetime') // true
 */
export function isAllowed(feature: Feature, tier: LicenseTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_TIER_MAP[feature]];
}

/**
 * Returns every feature the given tier can access.
 * Useful for building capability summaries in UI or for logging on startup.
 */
export function getAllowedFeatures(tier: LicenseTier): Feature[] {
  return FEATURES.filter(f => isAllowed(f, tier));
}