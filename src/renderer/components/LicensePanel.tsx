import React, { useState, useCallback } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Crown,
} from 'lucide-react';
import type { LicenseTier } from '../../shared/license';
import { TIER_LIMITS, TIER_LABELS } from '../../shared/license';

interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  deviceBound: boolean;
  checksumOk: boolean;
  usage: {
    current: number;
    limit: number;
    remaining: number;
    monthKey: string;
  };
}

interface LicensePanelProps {
  status: LicenseStatus | null;
  onStatusChange: () => Promise<void>;
}

const TIER_BADGE: Record<LicenseTier, string> = {
  free: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  pro: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  lifetime: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export default function LicensePanel({ status, onStatusChange }: LicensePanelProps) {
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleActivate = useCallback(async () => {
    if (!keyInput.trim()) return;
    setIsActivating(true);
    setError('');
    setSuccess('');
    try {
      // @ts-expect-error
      const result = await window.electronAPI.licenseActivate(keyInput.trim());
      if (result.success) {
        setSuccess(`${TIER_LABELS[result.tier]} activated`);
        setKeyInput('');
        await onStatusChange();
      } else {
        setError(result.error || 'Invalid key');
      }
    } catch (e: any) {
      setError(e?.message || 'Activation failed');
    } finally {
      setIsActivating(false);
    }
  }, [keyInput, onStatusChange]);

  const handleRemove = useCallback(async () => {
    setIsRemoving(true);
    setError('');
    try {
      // @ts-expect-error
      await window.electronAPI.licenseDeactivate();
      setSuccess('License removed — reverted to Free');
      await onStatusChange();
    } catch (e: any) {
      setError(e?.message || 'Removal failed');
    } finally {
      setIsRemoving(false);
    }
  }, [onStatusChange]);

  const pct =
    status && status.usage.limit > 0
      ? Math.min(100, (status.usage.current / status.usage.limit) * 100)
      : 0;

  const nearLimit = pct > 80 && status?.tier === 'free';
  const overLimit = pct >= 100;

  return (
    <div className="space-y-4">
      {/* Tier + usage header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${TIER_BADGE[status?.tier || 'free']}`}
          >
            <Crown className="w-3 h-3" />
            {TIER_LABELS[status?.tier || 'free']}
          </span>
          {status && !status.valid && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs">
              <AlertTriangle className="w-3 h-3" />
              Invalid
            </span>
          )}
        </div>
        {status?.tier !== 'lifetime' && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {status?.usage.current ?? 0} /{' '}
            {status?.usage.limit === -1 ? '∞' : status?.usage.limit ?? TIER_LIMITS.free}{' '}
            this month
          </span>
        )}
      </div>

      {/* Progress bar */}
      {status?.tier !== 'lifetime' && (
        <div className="space-y-1">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                overLimit ? 'bg-red-500' : nearLimit ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {nearLimit && !overLimit && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {Math.round(pct)}% used — upgrade to Pro for 5,000/month
            </p>
          )}
          {overLimit && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Limit reached. Upgrade to continue.
            </p>
          )}
        </div>
      )}

      {/* Key input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          License Key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Enter key…"
              className="w-full bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 pr-10 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={handleActivate}
            disabled={isActivating || !keyInput.trim()}
            className="shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            {isActivating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Key className="w-4 h-4" />
            )}
            Activate
          </button>
        </div>
      </div>

      {/* Remove */}
      {status && status.tier !== 'free' && (
        <button
          onClick={handleRemove}
          disabled={isRemoving}
          className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          {isRemoving ? 'Removing…' : 'Remove License'}
        </button>
      )}

      {/* Feedback */}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          {success}
        </p>
      )}
    </div>
  );
}