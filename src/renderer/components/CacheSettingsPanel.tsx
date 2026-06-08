import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database,
  Trash2,
  Check,
  Clock,
  HardDrive,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface CacheStats {
  sizeBytes: number;
  fileCount: number;
  oldestEntry: string | null;
}

interface CacheSettingsPanelProps {
  inputFolder: string;
  maxSizeGb: number;
  maxAgeDays: number;
  disabled: boolean;
  onMaxSizeChange: (val: number) => void;
  onMaxAgeChange: (val: number) => void;
  onDisabledChange: (val: boolean) => void;
}

export default function CacheSettingsPanel({
  inputFolder,
  maxSizeGb,
  maxAgeDays,
  disabled,
  onMaxSizeChange,
  onMaxAgeChange,
  onDisabledChange,
}: CacheSettingsPanelProps) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [clearState, setClearState] = useState<'idle' | 'confirm' | 'clearing' | 'success'>('idle');

  // References for clear confirmation timer
  const confirmTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Skip the limits sync on the very first render — values are already
  // persisted; firing setRawCacheLimits immediately on mount is a no-op
  // that wastes an IPC round-trip and a redundant cache-cleaner pass.
  const isFirstRender = useRef(true);

  // Fetch cache statistics for the current input folder
  const fetchStats = useCallback(async () => {
    if (!inputFolder) {
      setStats(null);
      return;
    }
    setIsLoadingStats(true);
    try {
      // @ts-expect-error - electronAPI bridge
      const res = await window.electronAPI.getRawCacheStats(inputFolder);
      setStats(res);
    } catch (err) {
      console.warn('[CacheSettingsPanel] Failed to fetch cache stats:', err);
    } finally {
      setIsLoadingStats(false);
    }
  }, [inputFolder]);

  // Fetch stats when folder or disabled state changes
  useEffect(() => {
    fetchStats();
  }, [fetchStats, disabled]);

  // Synchronise limits to the main process (debounced to avoid spamming disk/IPC while dragging).
  // Skipped on the initial mount because the values are already persisted — no write needed.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      // @ts-expect-error - electronAPI bridge
      window.electronAPI.setRawCacheLimits({
        maxSizeGB: maxSizeGb,
        maxAgeDays: maxAgeDays
      }).catch((err: unknown) => {
        console.warn('[CacheSettingsPanel] Failed to save cache limits:', err);
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [maxSizeGb, maxAgeDays]);

  // Cleanup confirmation timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  // Handler for clearing folder cache
  const handleClearCache = async () => {
    if (!inputFolder) return;

    if (clearState === 'idle') {
      setClearState('confirm');
      // Cancel previous timer if any
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      // Revert to idle after 4 seconds if they don't confirm
      confirmTimerRef.current = setTimeout(() => {
        setClearState('idle');
      }, 4000);
      return;
    }

    if (clearState === 'confirm') {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      setClearState('clearing');
      try {
        // @ts-expect-error - electronAPI bridge
        await window.electronAPI.clearRawCache(inputFolder);
        setClearState('success');
        fetchStats();
        setTimeout(() => setClearState('idle'), 2000);
      } catch (err) {
        console.error('[CacheSettingsPanel] Failed to clear RAW cache:', err);
        setClearState('idle');
      }
    }
  };

  // Format statistics into readable text
  const getStatsString = () => {
    if (isLoadingStats && !stats) {
      return 'Loading cache statistics...';
    }
    if (!inputFolder) {
      return 'Select an input folder to view cache stats.';
    }
    if (!stats) {
      return 'No statistics available.';
    }

    const { sizeBytes, fileCount, oldestEntry } = stats;
    
    // Format size
    let sizeStr = '0 B';
    if (sizeBytes >= 1024 * 1024 * 1024) {
      sizeStr = `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (sizeBytes >= 1024 * 1024) {
      sizeStr = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (sizeBytes > 0) {
      sizeStr = `${Math.round(sizeBytes / 1024)} KB`;
    }

    // Format age
    let ageStr = 'no cached previews';
    if (oldestEntry) {
      const msDiff = Date.now() - new Date(oldestEntry).getTime();
      const days = Math.round(msDiff / (1000 * 60 * 60 * 24));
      if (days <= 0) {
        ageStr = 'oldest entry: today';
      } else if (days === 1) {
        ageStr = 'oldest entry: 1 day ago';
      } else {
        ageStr = `oldest entry: ${days} days ago`;
      }
    }

    return `RAW preview cache: ${sizeStr} / ${maxSizeGb} GB • ${fileCount} files • ${ageStr}`;
  };

  return (
    <div className="space-y-5">
      {/* Caching Status Panel */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            RAW Smart Caching
          </label>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Decoded RAW previews are cached to disk to speed up culling and subsequent runs
          </p>
        </div>
      </div>

      {/* Cache statistics / state warning */}
      <div className={`p-4 rounded-xl border transition-colors ${
        disabled
          ? 'bg-gray-50 dark:bg-[#0f1117]/30 border-gray-200 dark:border-[#1e2535] text-gray-400 dark:text-gray-500'
          : 'bg-amber-500/5 dark:bg-amber-500/5 border-amber-500/20 text-gray-600 dark:text-gray-300'
      }`}>
        <div className="flex items-start gap-3">
          {disabled ? (
            <AlertCircle className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          ) : (
            <Database className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <span className="text-xs font-semibold uppercase tracking-wider block opacity-70">
              Cache Status
            </span>
            <span className="text-sm font-medium mt-1 block">
              {disabled ? 'Caching is disabled. New previews will not be cached.' : getStatsString()}
            </span>
          </div>
          {isLoadingStats && (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0 mt-1" />
          )}
        </div>
      </div>

      {/* Disable caching checkbox */}
      <div className="flex items-center">
        <label className="flex items-start gap-3 cursor-pointer group select-none">
          <div className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={disabled}
              onChange={(e) => onDisabledChange(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                disabled
                  ? 'bg-amber-500 border-amber-500'
                  : 'border-gray-300 dark:border-gray-600 group-hover:border-amber-400'
              }`}
            >
              {disabled && <Check className="w-3 h-3 text-white" />}
            </div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Disable RAW preview caching
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Turn off cache reading and writing. Useful only if disk space is extremely limited.
            </p>
          </div>
        </label>
      </div>

      {/* Size limit slider */}
      <div className={`space-y-2 transition-opacity duration-200 ${disabled ? 'opacity-40 pointer-events-none select-none' : ''}`}>
        <div className="flex justify-between items-center text-sm font-medium text-gray-700 dark:text-gray-300">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-amber-500" /> Cache Size Limit:
          </span>
          <span className="font-semibold text-amber-500 dark:text-amber-400">
            {maxSizeGb} GB
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={maxSizeGb}
          disabled={disabled}
          onChange={(e) => onMaxSizeChange(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-[11px] text-gray-400 select-none">
          <span>1 GB</span>
          <span>10 GB</span>
          <span>25 GB</span>
          <span>50 GB</span>
        </div>
      </div>

      {/* Age limit slider */}
      <div className={`space-y-2 transition-opacity duration-200 ${disabled ? 'opacity-40 pointer-events-none select-none' : ''}`}>
        <div className="flex justify-between items-center text-sm font-medium text-gray-700 dark:text-gray-300">
          <span className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-500" /> Cache Retention Period:
          </span>
          <span className="font-semibold text-amber-500 dark:text-amber-400">
            {maxAgeDays} days
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={365}
          step={1}
          value={maxAgeDays}
          disabled={disabled}
          onChange={(e) => onMaxAgeChange(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-[11px] text-gray-400 select-none">
          <span>1 day</span>
          <span>30 days</span>
          <span>90 days</span>
          <span>1 year</span>
        </div>
      </div>

      {/* Clear Cache Action */}
      {inputFolder && (
        <div className="pt-2">
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearState === 'clearing' || isLoadingStats}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-all w-full sm:w-auto ${
              clearState === 'idle'
                ? 'border-red-200 hover:border-red-300 dark:border-red-900/30 hover:bg-red-50 dark:hover:bg-red-950/10 text-red-600 dark:text-red-400'
                : clearState === 'confirm'
                ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white animate-pulse'
                : clearState === 'clearing'
                ? 'bg-gray-100 dark:bg-[#0f1117] border-gray-200 dark:border-[#1e2535] text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 border-emerald-600 text-white'
            }`}
          >
            {clearState === 'idle' && (
              <>
                <Trash2 className="w-4 h-4" />
                Clear Local RAW Cache
              </>
            )}
            {clearState === 'confirm' && (
              <>
                <AlertCircle className="w-4 h-4" />
                Click again to confirm! (Will delete all cached RAW previews in .cullai_cache)
              </>
            )}
            {clearState === 'clearing' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Clearing local cache...
              </>
            )}
            {clearState === 'success' && (
              <>
                <Check className="w-4 h-4" />
                Local Cache Cleared Successfully
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}