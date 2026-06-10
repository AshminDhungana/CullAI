/**
 * src/renderer/screens/Results.tsx
 *
 * Phase 12 — Results Screen (Enhanced)
 *
 * Renders the culling pipeline results. Provides:
 *   - Tabbed filtering (S / A / B / Rejected) with item counts.
 *   - Stat cards showing selection breakdown and token cost.
 *   - Collapsible Pipeline Filtering/Shortfall Stats banner.
 *   - Responsive gallery grid rendering ImageTiles.
 *   - Floating Multi-select Comparison bar (compare 2-4 images side-by-side).
 *   - Quick rating controls via button click or global keyboard culling shortcuts.
 *   - High-fidelity toast notifications for exports.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  Star,
  Sparkles,
  Camera,
  Focus,
  Sun,
  Eye,
  Download,
  FolderOpen,
  ArrowRight,
  TrendingDown,
  Slash,
  ImageIcon,
  Maximize2,
  Check,
  AlertTriangle,
  Info
} from 'lucide-react';
import type { AppSettings, Session, ScoreRecord } from '../../shared/types';
import ImageTile from '../components/ImageTile';
import CompareView from '../components/CompareView';
import KeyboardCuller from '../components/KeyboardCuller';

interface ResultsScreenProps {
  settings: AppSettings;
  session: Session | null;
  onBack: () => void;
}

type TabType = 'S' | 'A' | 'B' | 'rejected';

const TABS: { id: TabType; label: string; color: string; activeBorder: string; activeBg: string }[] = [
  { id: 'S', label: 'S — Best (90+)', color: 'text-amber-500 dark:text-amber-400', activeBorder: 'border-amber-500', activeBg: 'bg-amber-500/10' },
  { id: 'A', label: 'A — Keepers', color: 'text-emerald-500 dark:text-emerald-400', activeBorder: 'border-emerald-500', activeBg: 'bg-emerald-500/10' },
  { id: 'B', label: 'B — Maybe', color: 'text-sky-500 dark:text-sky-400', activeBorder: 'border-sky-500', activeBg: 'bg-sky-500/10' },
  { id: 'rejected', label: 'Rejected', color: 'text-red-500 dark:text-red-400', activeBorder: 'border-red-500', activeBg: 'bg-red-500/10' },
];

export default function ResultsScreen({ settings, session: initialSession, onBack }: ResultsScreenProps) {
  const [activeTab, setActiveTab] = useState<TabType>('S');
  const [scoresState, setScoresState] = useState<Record<string, ScoreRecord>>({});
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [shortfallReasons, setShortfallReasons] = useState<Session['outputShortfallReasons'] | undefined>(undefined);

  // Export status
  const [exporting, setExporting] = useState(false);
  const [exportToast, setExportToast] = useState<{ filePath: string; count: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load session scores
  useEffect(() => {
    const loadData = async () => {
      if (initialSession) {
        setScoresState(initialSession.scores || {});
        setShortfallReasons(initialSession.outputShortfallReasons);
      } else if (settings.outputFolder) {
        try {
          const loaded = await window.electronAPI.sessionLoad({ outputFolder: settings.outputFolder });
          if (loaded) {
            setScoresState(loaded.scores || {});
            setShortfallReasons(loaded.outputShortfallReasons);
          }
        } catch (err: any) {
          console.error('[results] Failed to load session from output folder:', err);
        }
      }
    };
    loadData();
  }, [initialSession, settings.outputFolder]);

  // Compute tier counts dynamically
  const stats = useMemo(() => {
    const sRecords = Object.values(scoresState);
    return {
      total: sRecords.length,
      S: sRecords.filter(r => r.tier === 'S').length,
      A: sRecords.filter(r => r.tier === 'A').length,
      B: sRecords.filter(r => r.tier === 'B').length,
      rejected: sRecords.filter(r => r.tier === 'rejected').length,
    };
  }, [scoresState]);

  // Sum token counts and estimate costs if available
  const costStats = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    Object.values(scoresState).forEach(r => {
      if (r.usage) {
        inputTokens += r.usage.inputTokens || 0;
        outputTokens += r.usage.outputTokens || 0;
      }
    });

    // Simple cost estimation helper ($3/1M in, $15/1M out as blended defaults)
    const cost = (inputTokens * 3 + outputTokens * 15) / 1000000;
    return {
      inputTokens,
      outputTokens,
      totalCost: cost.toFixed(3),
    };
  }, [scoresState]);

  // List of images filtered by the active tab
  const filteredImages = useMemo(() => {
    return Object.entries(scoresState)
      .filter(([_, record]) => record.tier === activeTab)
      .sort((a, b) => b[1].total - a[1].total); // Sort by composite score desc
  }, [scoresState, activeTab]);

  // Auto-clamp and adjust focus when list shrinks
  useEffect(() => {
    if (focusedIndex !== null) {
      if (filteredImages.length === 0) {
        setFocusedIndex(null);
      } else if (focusedIndex >= filteredImages.length) {
        setFocusedIndex(filteredImages.length - 1);
      }
    }
  }, [filteredImages.length, focusedIndex]);

  // Scroll focused element into view
  useEffect(() => {
    if (focusedIndex !== null && filteredImages[focusedIndex]) {
      const id = filteredImages[focusedIndex][0];
      const element = document.getElementById(`tile-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [focusedIndex, filteredImages]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleUpdateTier = useCallback(async (imageId: string, newTier: 'S' | 'A' | 'B' | 'rejected') => {
    setScoresState(prev => {
      if (!prev[imageId]) return prev;
      return {
        ...prev,
        [imageId]: {
          ...prev[imageId],
          tier: newTier,
        },
      };
    });

    try {
      await window.electronAPI.sessionUpdateTier({
        outputFolder: settings.outputFolder,
        imageId,
        newTier,
      });
    } catch (err: any) {
      console.error('[results] Failed to persist manual tier change:', err);
    }
  }, [settings.outputFolder]);

  // Toggle selection for comparison
  const handleToggleSelect = useCallback((imageId: string) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        // limit comparison selection to max 4 images
        if (next.size >= 4) {
          setErrorMsg('You can select a maximum of 4 images for comparison.');
          setTimeout(() => setErrorMsg(null), 3000);
          return prev;
        }
        next.add(imageId);
      }
      return next;
    });
  }, []);

  // Keyboard culling handlers
  const handleKeyboardNavigate = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    if (filteredImages.length === 0) return;
    if (focusedIndex === null) {
      setFocusedIndex(0);
      return;
    }

    const cols = 4; // grid-cols-4 layout
    let newIndex = focusedIndex;

    switch (direction) {
      case 'left':
        newIndex = Math.max(0, focusedIndex - 1);
        break;
      case 'right':
        newIndex = Math.min(filteredImages.length - 1, focusedIndex + 1);
        break;
      case 'up':
        newIndex = Math.max(0, focusedIndex - cols);
        break;
      case 'down':
        newIndex = Math.min(filteredImages.length - 1, focusedIndex + cols);
        break;
    }
    setFocusedIndex(newIndex);
  }, [filteredImages, focusedIndex]);

  const handleKeyboardAssignTier = useCallback((newTier: 'S' | 'A' | 'B' | 'rejected') => {
    if (focusedIndex === null || !filteredImages[focusedIndex]) return;
    const [imageId] = filteredImages[focusedIndex];
    handleUpdateTier(imageId, newTier);
  }, [focusedIndex, filteredImages, handleUpdateTier]);

  const handleKeyboardToggleSelect = useCallback(() => {
    if (focusedIndex === null || !filteredImages[focusedIndex]) return;
    const [imageId] = filteredImages[focusedIndex];
    handleToggleSelect(imageId);
  }, [focusedIndex, filteredImages, handleToggleSelect]);

  const handleCompareSelected = useCallback(() => {
    if (selectedImageIds.size >= 2 && selectedImageIds.size <= 4) {
      setIsCompareOpen(true);
    } else {
      setErrorMsg('Please select between 2 and 4 images to compare.');
      setTimeout(() => setErrorMsg(null), 3500);
    }
  }, [selectedImageIds]);

  const handleEscape = useCallback(() => {
    if (isCompareOpen) {
      setIsCompareOpen(false);
    } else {
      setSelectedImageIds(new Set());
    }
  }, [isCompareOpen]);

  const handleExportJson = async () => {
    if (stats.total === 0) return;
    setExporting(true);
    try {
      const res = await window.electronAPI.exportResultsJson({ outputFolder: settings.outputFolder });
      if (res && res.filePath) {
        setExportToast({ filePath: res.filePath, count: res.imageCount });
        setTimeout(() => setExportToast(null), 7000);
      }
    } catch (err: any) {
      setErrorMsg(`Export failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setExporting(false);
    }
  };

  const handleOpenOutputFolder = async () => {
    try {
      await window.electronAPI.shellShowItem(settings.outputFolder);
    } catch (err: any) {
      setErrorMsg(`Could not open output folder: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    }
  };

  // Build items array formatted for CompareView
  const compareItems = useMemo(() => {
    return Array.from(selectedImageIds)
      .map(id => ({ id, record: scoresState[id] }))
      .filter(item => item.record !== undefined);
  }, [selectedImageIds, scoresState]);

  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-[#0c0e14] text-gray-900 dark:text-white pb-24 transition-colors duration-200">
      {/* Global Keyboard Shortcut Agent */}
      <KeyboardCuller
        enabled={!isCompareOpen}
        onNavigate={handleKeyboardNavigate}
        onAssignTier={handleKeyboardAssignTier}
        onToggleSelect={handleKeyboardToggleSelect}
        onCompare={handleCompareSelected}
        onEscape={handleEscape}
      />

      {/* Side-by-side comparison screen */}
      <AnimatePresence>
        {isCompareOpen && (
          <CompareView
            selectedItems={compareItems}
            outputFolder={settings.outputFolder}
            onClose={() => setIsCompareOpen(false)}
            onUpdateTier={handleUpdateTier}
          />
        )}
      </AnimatePresence>

      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 w-full border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-[#0c0e14]/80 backdrop-blur-md transition-colors">
        <div className="max-w-7xl mx-auto px-6 flex flex-col">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 bg-clip-text text-transparent">
                CullAI Results
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 font-medium">
                Pipeline completed successfully · Review & Adjust
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenOutputFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white/80 hover:bg-gray-200 dark:hover:bg-white/10 transition"
                title="Open Output Folder in Explorer/Finder"
              >
                <FolderOpen size={14} />
                <span>Open Folder</span>
              </button>

              <button
                onClick={handleExportJson}
                disabled={exporting || stats.total === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Download size={14} />
                <span>{exporting ? 'Exporting...' : 'Export JSON'}</span>
              </button>

              <button
                onClick={onBack}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white/80 hover:bg-gray-200 dark:hover:bg-white/10 transition"
              >
                <ChevronLeft size={14} />
                <span>Back</span>
              </button>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="flex gap-2 border-t border-gray-100 dark:border-white/5 pt-2">
            {TABS.map(tab => {
              const count = stats[tab.id];
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setFocusedIndex(null);
                  }}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all relative ${
                    isActive
                      ? `${tab.activeBorder} ${tab.color}`
                      : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-white/80'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {tab.label}
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      isActive ? `${tab.activeBg} ${tab.color}` : 'bg-gray-100 dark:bg-white/5 text-gray-400'
                    }`}>
                      {count}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Main Container ────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Dynamic Statistics Cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Star}
            title="S-Tier (Best)"
            value={stats.S}
            colorClass="text-amber-500"
            subtext="Rated 90+ overall quality"
          />
          <StatCard
            icon={TrendingDown}
            title="A-Tier (Keepers)"
            value={stats.A}
            colorClass="text-emerald-500"
            subtext="Select keepers for final culls"
          />
          <StatCard
            icon={Slash}
            title="B-Tier (Maybe)"
            value={stats.B}
            colorClass="text-sky-500"
            subtext="Promotable on shortfall"
          />
          <StatCard
            icon={ImageIcon}
            title="Total Processed"
            value={stats.total}
            colorClass="text-white/60"
            subtext={
              costStats.inputTokens > 0
                ? `${costStats.inputTokens + costStats.outputTokens} tokens (~$${costStats.totalCost})`
                : 'No cost logs recorded'
            }
          />
        </section>

        {/* Shortfall & Pipeline Filter Summary Banner */}
        {shortfallReasons &&
          (shortfallReasons.duplicatesSkipped > 0 ||
            shortfallReasons.belowThreshold > 0 ||
            shortfallReasons.exceededFaceLimit > 0) && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
              <Info size={16} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Pipeline Filter Statistics</span>
                <p>
                  To reach your target count, the culling engine filtered out:
                  {shortfallReasons.duplicatesSkipped > 0 && ` ${shortfallReasons.duplicatesSkipped} burst duplicate(s)`}
                  {shortfallReasons.belowThreshold > 0 && `, ${shortfallReasons.belowThreshold} image(s) below rating threshold`}
                  {shortfallReasons.exceededFaceLimit > 0 && `, ${shortfallReasons.exceededFaceLimit} image(s) exceeding face limit setting`}.
                </p>
              </div>
            </div>
          )}

        {/* Active Tab Header & Selection Action Toolbar */}
        <div className="flex justify-between items-center border-b border-gray-100 dark:border-white/5 pb-2">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Gallery · {TABS.find(t => t.id === activeTab)?.label}
          </h3>

          {selectedImageIds.size > 0 && (
            <div className="flex items-center gap-2 animate-fade-in">
              <span className="text-[11px] text-gray-400 mr-1">
                {selectedImageIds.size} {selectedImageIds.size === 1 ? 'image' : 'images'} selected
              </span>

              <button
                onClick={handleCompareSelected}
                disabled={selectedImageIds.size < 2 || selectedImageIds.size > 4}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Maximize2 size={12} />
                <span>Compare side-by-side</span>
              </button>

              <button
                onClick={() => setSelectedImageIds(new Set())}
                className="px-2 py-1 text-[10px] font-semibold text-gray-400 hover:text-white transition"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Gallery Grid */}
        {filteredImages.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredImages.map(([id, record], index) => {
              const isSelected = selectedImageIds.has(id);
              const isFocused = focusedIndex === index;

              return (
                <div key={id} id={`tile-${id}`} className="scroll-mt-24 relative">
                  {/* Select Floating Handle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSelect(id);
                    }}
                    className={`absolute top-2.5 right-2.5 z-10 w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                      isSelected
                        ? 'bg-amber-500 border-amber-400 text-black font-extrabold'
                        : 'bg-black/60 border-white/20 text-transparent hover:border-white/50 hover:bg-black/80'
                    }`}
                    title={isSelected ? 'Deselect image' : 'Select image for comparison'}
                  >
                    <Check size={12} className={isSelected ? 'stroke-[3]' : 'stroke-[1]'} />
                  </button>

                  <ImageTile
                    score={record}
                    imageId={id}
                    outputFolder={settings.outputFolder}
                    isSelected={isSelected}
                    isFocused={isFocused}
                    onClick={() => {
                      setFocusedIndex(index);
                      handleToggleSelect(id);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-2xl border border-dashed border-gray-200 dark:border-white/10 bg-white/5 dark:bg-white/[0.02]">
            <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-400">
              <ImageIcon size={24} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                No images in this tier
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                You can rate other images as '{activeTab === 'rejected' ? 'R' : activeTab}' to place them here.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer Metadata ── */}
      <footer className="border-t border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-black/30 py-4 text-[10px] text-gray-500 dark:text-gray-500">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
          <div className="truncate max-w-[60%] flex gap-3">
            <span>Input: {settings.inputFolder}</span>
            <span>·</span>
            <span>Output: {settings.outputFolder}</span>
          </div>
          <span>CullAI Photo Culling Assistant</span>
        </div>
      </footer>

      {/* Toast notifications */}
      <AnimatePresence>
        {exportToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-6 z-50 max-w-md bg-[#10131e] border border-emerald-500/30 rounded-xl p-4 shadow-xl backdrop-blur-md text-white"
          >
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                <Check size={18} />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <h4 className="text-xs font-bold text-emerald-400">Results Exported Successfully!</h4>
                <p className="text-[11px] text-white/70 leading-normal truncate">
                  {exportToast.count} items written to results.json
                </p>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={async () => {
                      try {
                        await window.electronAPI.shellShowItem(exportToast.filePath);
                      } catch {
                        /* non-fatal */
                      }
                    }}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition"
                  >
                    <span>Show in Folder</span>
                    <ArrowRight size={10} />
                  </button>
                  <button
                    onClick={() => setExportToast(null)}
                    className="text-[10px] font-medium text-white/40 hover:text-white/60 transition"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-6 z-50 bg-[#161217] border border-red-500/30 text-red-200 text-xs px-4 py-3 rounded-lg shadow-xl flex items-center gap-2"
          >
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── StatCard Subcomponent ──────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  title,
  value,
  colorClass,
  subtext,
}: {
  icon: React.ElementType;
  title: string;
  value: number | string;
  colorClass: string;
  subtext: string;
}) {
  return (
    <div className="bg-white/50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 rounded-xl p-4 flex gap-4 items-center transition-colors">
      <div className={`p-2.5 rounded-lg bg-gray-100 dark:bg-white/5 ${colorClass}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</p>
        <h4 className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</h4>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{subtext}</p>
      </div>
    </div>
  );
}