/**
 * src/shared/license.ts
 *
 * Shared license types and constants. Safe to import in both main and renderer.
 */
export type LicenseTier = 'free' | 'pro' | 'lifetime';
export interface LicenseFile {
    tier: LicenseTier;
    issuedAt: string;
    deviceId: string;
    signature: string;
}
export interface LicenseStatus {
    tier: LicenseTier;
    valid: boolean;
    deviceBound: boolean;
    checksumOk: boolean;
}
export interface UsageRecord {
    monthKey: string;
    count: number;
    lastVerifiedAt: string;
}
export declare const TIER_LIMITS: Record<LicenseTier, number>;
export declare const TIER_LABELS: Record<LicenseTier, string>;
/**
 * All gatable features. Adding a new feature here is the only place a
 * developer needs to touch to register it — the tier map, isAllowed(), and
 * the IPC handler all derive from this tuple automatically.
 */
export declare const FEATURES: readonly ["rawFormats", "xmpExport", "unlimitedImages", "unlimitedProfiles", "autoTagging"];
export type Feature = typeof FEATURES[number];
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
export declare function isAllowed(feature: Feature, tier: LicenseTier): boolean;
/**
 * Returns every feature the given tier can access.
 * Useful for building capability summaries in UI or for logging on startup.
 */
export declare function getAllowedFeatures(tier: LicenseTier): Feature[];
