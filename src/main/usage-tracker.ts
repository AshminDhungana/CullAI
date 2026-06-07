/**
 * src/main/usage-tracker.ts
 *
 * Quota enforcement with month rollover and clock-rollback protection.
 */

import type { LicenseTier, UsageRecord } from '../shared/license';
import { TIER_LIMITS } from '../shared/license';
import { getLicenseTier } from './license-manager';
import { getTrustedTime, getCurrentMonthKeyFromDate } from './time-sync';

interface AppStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

let _store: AppStore | null = null;

export function initUsageTracker(store: AppStore): void {
  _store = store;
}

function getStore(): AppStore {
  if (!_store) throw new Error('usage-tracker: store not initialised');
  return _store;
}

function getUsageRecord(): UsageRecord {
  const stored = getStore().get('license.usage') as UsageRecord | undefined;
  const now = new Date();
  const currentMonth = getCurrentMonthKeyFromDate(now);

  if (!stored || stored.monthKey !== currentMonth) {
    return {
      monthKey: currentMonth,
      count: 0,
      lastVerifiedAt: now.toISOString(),
    };
  }
  return stored;
}

function saveUsageRecord(r: UsageRecord): void {
  getStore().set('license.usage', r);
}

export async function resetUsageIfNewMonth(): Promise<void> {
  // Side effect: getUsageRecord already resets if month changed
  const record = getUsageRecord();
  saveUsageRecord(record);
}

export async function incrementUsage(
  count: number,
): Promise<{ success: boolean; remaining: number; error?: 'QUOTA_EXCEEDED' | 'CLOCK_TAMPER' }> {
  const tier = getLicenseTier();
  const limit = TIER_LIMITS[tier];
  if (limit === Infinity) {
    return { success: true, remaining: Number.MAX_SAFE_INTEGER };
  }

  const time = await getTrustedTime();
  const record = getUsageRecord();

  // Clock rollback > 1 hour
  const last = new Date(record.lastVerifiedAt);
  if (time.date.getTime() < last.getTime() - 3600000) {
    return { success: false, remaining: 0, error: 'CLOCK_TAMPER' };
  }

  const next = record.count + count;
  if (next > limit) {
    return {
      success: false,
      remaining: Math.max(0, limit - record.count),
      error: 'QUOTA_EXCEEDED',
    };
  }

  record.count = next;
  record.lastVerifiedAt = time.date.toISOString();
  saveUsageRecord(record);

  return { success: true, remaining: limit - next };
}

export async function preloadUsageForSession(
  requestedCount: number,
): Promise<{ allowed: boolean; remaining: number; error?: string }> {
  const tier = getLicenseTier();
  const limit = TIER_LIMITS[tier];
  if (limit === Infinity) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER };

  await resetUsageIfNewMonth();
  const record = getUsageRecord();
  const remaining = limit - record.count;

  if (remaining <= 0) return { allowed: false, remaining: 0, error: 'QUOTA_EXCEEDED' };
  if (requestedCount > remaining) {
    return {
      allowed: false,
      remaining,
      error: `QUOTA_PARTIAL: Only ${remaining} of ${requestedCount} allowed`,
    };
  }
  return { allowed: true, remaining: remaining - requestedCount };
}

export async function getUsageStatus(): Promise<{
  current: number;
  limit: number;
  remaining: number;
  monthKey: string;
}> {
  const tier = getLicenseTier();
  const limit = TIER_LIMITS[tier] === Infinity ? -1 : TIER_LIMITS[tier];
  const record = getUsageRecord();
  const remaining = limit === -1 ? -1 : Math.max(0, limit - record.count);

  return {
    current: record.count,
    limit,
    remaining,
    monthKey: record.monthKey,
  };
}