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