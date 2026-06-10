"use strict";
/**
 * src/shared/license.ts
 *
 * Shared license types and constants. Safe to import in both main and renderer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEATURES = exports.TIER_LABELS = exports.TIER_LIMITS = void 0;
exports.isAllowed = isAllowed;
exports.getAllowedFeatures = getAllowedFeatures;
exports.TIER_LIMITS = {
    free: 500,
    pro: 5000,
    lifetime: Infinity,
};
exports.TIER_LABELS = {
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
exports.FEATURES = [
    'rawFormats', // RAW file processing (CR3, NEF, ARW, …)
    'xmpExport', // Lightroom / Capture One sidecar export
    'unlimitedImages', // >500 images/month (Free cap enforced by usage-tracker)
    'unlimitedProfiles', // >2 saved style profiles
    'autoTagging', // AI keyword tagging — Phase 13b
];
/**
 * Minimum tier required for each feature.
 * 'free'     → everyone gets it.
 * 'pro'      → Pro and Lifetime only.
 * 'lifetime' → Lifetime only (reserved for future use).
 */
const FEATURE_TIER_MAP = {
    rawFormats: 'pro',
    xmpExport: 'pro',
    unlimitedImages: 'pro',
    unlimitedProfiles: 'pro',
    autoTagging: 'pro',
};
/** Numeric rank used for tier comparisons. Higher = more access. */
const TIER_RANK = {
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
function isAllowed(feature, tier) {
    return TIER_RANK[tier] >= TIER_RANK[FEATURE_TIER_MAP[feature]];
}
/**
 * Returns every feature the given tier can access.
 * Useful for building capability summaries in UI or for logging on startup.
 */
function getAllowedFeatures(tier) {
    return exports.FEATURES.filter(f => isAllowed(f, tier));
}
//# sourceMappingURL=license.js.map