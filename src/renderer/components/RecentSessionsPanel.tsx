/**
 * src/renderer/components/RecentSessionsPanel.tsx
 *
 * Phase 14.3 — Recent Sessions
 *
 * Renders a collapsible card on the Setup scoring step that shows the last
 * 10 completed culling sessions. Each entry displays:
 *   • Input folder basename + date
 *   • Image count, top score, genre badge
 *   • Profile name (if one was active)
 *   • "Load settings" button — restores genre, weights, preferenceText
 *
 * IPC bridge (window.electronAPI):
 *   sessionHistoryGet() → Promise<SessionHistoryEntry[]>
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
  ArrowDownToLine,
  Bookmark,
  Star,
} from 'lucide-react';
import type { SessionHistoryEntry, GenrePreset } from '../../shared/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RecentSessionsPanelProps {
  onLoad: (entry: SessionHistoryEntry) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GENRE_COLORS: Record<GenrePreset, string> = {
  general:   'bg-gray-500/15 text-gray-400 border-gray-500/20',
  wedding:   'bg-pink-500/15 text-pink-400 border-pink-500/20',
  portrait:  'bg-violet-500/15 text-violet-400 border-violet-500/20',
  sports:    'bg-orange-500/15 text-orange-400 border-orange-500/20',
  landscape: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  street:    'bg-sky-500/15 text-sky-400 border-sky-500/20',
  event:     'bg-amber-500/15 text-amber-400 border-amber-500/20',
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7)  return `${diffDays} days ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function folderBasename(absPath: string): string {
  // Works for both Unix (/a/b/c) and Windows (C:\a\b\c)
  return absPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? absPath;
}

function scoreColor(score: number): string {
  if (score >= 90) return 'text-amber-400';
  if (score >= 75) return 'text-emerald-400';
  if (score >= 60) return 'text-sky-400';
  return 'text-gray-400';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RecentSessionsPanel({ onLoad }: RecentSessionsPanelProps) {
  const [isOpen,    setIsOpen]    = useState(false);
  const [history,   setHistory]   = useState<SessionHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedId,  setLoadedId]  = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      // @ts-expect-error — electronAPI bridge
      const entries: SessionHistoryEntry[] = await window.electronAPI.sessionHistoryGet();
      setHistory(entries);
    } catch (err) {
      console.error('[RecentSessionsPanel] sessionHistoryGet failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchHistory();
  }, [isOpen, fetchHistory]);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const handleLoad = useCallback((entry: SessionHistoryEntry) => {
    onLoad(entry);
    setLoadedId(entry.sessionId);
    // Clear the "loaded" indicator after a moment
    setTimeout(() => setLoadedId(null), 3000);
  }, [onLoad]);

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] overflow-hidden">
      {/* ── Header / toggle ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-100 dark:bg-sky-900/25 rounded-xl shrink-0">
            <History className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
              Recent Sessions
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {history.length > 0 && !isOpen
                ? `${history.length} recent session${history.length !== 1 ? 's' : ''}`
                : 'Reload settings from a previous run'}
            </p>
          </div>
        </div>
        <div className="text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="history-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 dark:border-white/5 px-5 pt-4 pb-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-5">
                  <History className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 dark:text-gray-400">No completed sessions yet.</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    Completed sessions will appear here so you can reload their settings.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {history.map((entry) => {
                    const justLoaded = loadedId === entry.sessionId;
                    return (
                      <li
                        key={entry.sessionId}
                        className="rounded-xl border border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-white/[0.02] px-3.5 py-3"
                      >
                        {/* ── Top row: folder + date ─────────────────── */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FolderOpen className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                            <span
                              className="text-xs font-semibold text-gray-900 dark:text-white truncate"
                              title={entry.inputFolder}
                            >
                              {folderBasename(entry.inputFolder)}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                            {formatDate(entry.completedAt)}
                          </span>
                        </div>

                        {/* ── Meta row: count, score, genre, profile ──── */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                          {/* Image count */}
                          <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">
                            {entry.imageCount.toLocaleString()} images
                          </span>

                          <span className="text-gray-300 dark:text-white/10">·</span>

                          {/* Top score */}
                          <span className={`flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${scoreColor(entry.topScore)}`}>
                            <Star className="w-2.5 h-2.5" />
                            {entry.topScore.toFixed(1)}
                          </span>

                          <span className="text-gray-300 dark:text-white/10">·</span>

                          {/* Genre badge */}
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${GENRE_COLORS[entry.genre] ?? GENRE_COLORS.general}`}>
                            {entry.genre}
                          </span>

                          {/* Profile name (if any) */}
                          {entry.profileName && (
                            <>
                              <span className="text-gray-300 dark:text-white/10">·</span>
                              <span className="flex items-center gap-1 text-[10px] text-amber-400/80">
                                <Bookmark className="w-2.5 h-2.5" />
                                {entry.profileName}
                              </span>
                            </>
                          )}
                        </div>

                        {/* ── Load button ───────────────────────────── */}
                        <button
                          type="button"
                          onClick={() => handleLoad(entry)}
                          className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${
                            justLoaded
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 cursor-default'
                              : 'bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20'
                          }`}
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                          {justLoaded ? 'Settings loaded' : 'Load settings'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}