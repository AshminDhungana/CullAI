/**
 * src/renderer/screens/Results.tsx
 *
 * Phase 12b — Results Performance & UX
 * Phase 13  — XMP Export
 *
 * Changes vs Phase 12:
 *   12b.1  Virtualized grid via react-window FixedSizeGrid + react-virtualized-auto-sizer
 *   12b.2  Undo stack (Cmd/Ctrl+Z) for manual tier overrides, max 20 entries
 *   12b.4  Re-score selected images with current weights (IPC: 're-score-images')
 *   12b.5  Export CSV  (IPC: 'export-results-csv')
 *   12b.6  Export session bundle as .zip (IPC: 'export-session-zip')
 *   12b.7  Tab badges now show  count / total  (e.g. "12/200")
 *   13.1   Export XMP sidecars button (IPC: 'export-xmp')
 *          — builds imagePathMap from session.settings.inputFolder + score.filename
 *          — "Include AI reasoning" toggle stored in component state (not persisted)
 *          — error count surfaced as warning toast when some sidecars fail
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as ReactWindowModule from 'react-window';
const { FixedSizeGrid } = (ReactWindowModule as any).default ?? ReactWindowModule;
type GridChildComponentProps = import('react-window').GridChildComponentProps;
import * as AutoSizerModule from 'react-virtualized-auto-sizer';
const AutoSizer = (AutoSizerModule as any).default ?? AutoSizerModule;
import {
  ChevronLeft,
  Star,
  TrendingDown,
  Slash,
  ImageIcon,
  Maximize2,
  Check,
  AlertTriangle,
  Info,
  Download,
  FolderOpen,
  ArrowRight,
  RefreshCw,
  FileText,
  Archive,
  RotateCcw,
  Tag,
  Sparkles,
  Bookmark,        // ← Phase 14.4
  X,               // ← Phase 14.4
  Loader2,         // ← Phase 14.4
} from 'lucide-react';
import type { AppSettings, Session, ScoreRecord, PipelineEvent, StyleProfile } from '../../shared/types';
import ImageTile from '../components/ImageTile';
import CompareView from '../components/CompareView';
import KeyboardCuller from '../components/KeyboardCuller';

// ── Grid layout constants ──────────────────────────────────────────────────────
const TILE_WIDTH  = 280;
const TILE_HEIGHT = 385;
const TILE_GAP    = 24;

// ── Types ──────────────────────────────────────────────────────────────────────
interface ResultsScreenProps {
  settings: AppSettings;
  session: Session | null;
  onBack: () => void;
}

type TabType = 'S' | 'A' | 'B' | 'rejected';

type UndoEntry = {
  imageId: string;
  previousTier: 'S' | 'A' | 'B' | 'rejected';
  filename: string;
  timestamp: number;
};

const TABS: { id: TabType; label: string; color: string; activeBorder: string; activeBg: string }[] = [
  { id: 'S',        label: 'S — Best (90+)', color: 'text-amber-500 dark:text-amber-400',    activeBorder: 'border-amber-500',  activeBg: 'bg-amber-500/10'  },
  { id: 'A',        label: 'A — Keepers',    color: 'text-emerald-500 dark:text-emerald-400', activeBorder: 'border-emerald-500', activeBg: 'bg-emerald-500/10' },
  { id: 'B',        label: 'B — Maybe',      color: 'text-sky-500 dark:text-sky-400',         activeBorder: 'border-sky-500',    activeBg: 'bg-sky-500/10'    },
  { id: 'rejected', label: 'Rejected',        color: 'text-red-500 dark:text-red-400',         activeBorder: 'border-red-500',    activeBg: 'bg-red-500/10'    },
];

export default function ResultsScreen({ settings, session: initialSession, onBack }: ResultsScreenProps) {
  // ── Core state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]               = useState<TabType>('S');
  const [scoresState, setScoresState]           = useState<Record<string, ScoreRecord>>({});
  const [focusedIndex, setFocusedIndex]         = useState<number | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [isCompareOpen, setIsCompareOpen]       = useState(false);
  const [shortfallReasons, setShortfallReasons] = useState<Session['outputShortfallReasons'] | undefined>(undefined);

  // ── Undo (12b.2) ──────────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [undoToast, setUndoToast] = useState<string | null>(null);

  // ── Export state ──────────────────────────────────────────────────────────────
  const [exporting,    setExporting]    = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [zipProgress,  setZipProgress]  = useState<number | null>(null);
  const [exportToast,  setExportToast]  = useState<{ filePath: string; count: number } | null>(null);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);

  // ── XMP export state (Phase 13) ───────────────────────────────────────────────
  const [exportingXmp,          setExportingXmp]          = useState(false);
  const [xmpIncludeDescription, setXmpIncludeDescription] = useState(true);

  // ── Auto-tagging state (Phase 13b) ────────────────────────────────────────────
  const [isAutoTagging,    setIsAutoTagging]    = useState(false);
  const [autoTagToast,     setAutoTagToast]     = useState<string | null>(null);

  // ── Save style profile (Phase 14.4) ──────────────────────────────────────────
  const [isSavingProfile,   setIsSavingProfile]   = useState(false);
  const [showProfileSave,   setShowProfileSave]   = useState(false);
  const [profileSaveName,   setProfileSaveName]   = useState('');
  const [profileSaveError,  setProfileSaveError]  = useState<string | null>(null);
  const [profileSaveToast,  setProfileSaveToast]  = useState<string | null>(null);

  // ── Re-score (12b.4) ──────────────────────────────────────────────────────────
  const [isRescoring,     setIsRescoring]     = useState(false);
  const [rescoreProgress, setRescoreProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Virtualized grid (12b.1) ──────────────────────────────────────────────────
  const gridRef     = useRef<import('react-window').FixedSizeGrid>(null);
  const colCountRef = useRef<number>(4);

  // ── Load session scores ───────────────────────────────────────────────────────
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

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const records = Object.values(scoresState);
    return {
      total:    records.length,
      S:        records.filter(r => r.tier === 'S').length,
      A:        records.filter(r => r.tier === 'A').length,
      B:        records.filter(r => r.tier === 'B').length,
      rejected: records.filter(r => r.tier === 'rejected').length,
    };
  }, [scoresState]);

  const costStats = useMemo(() => {
    let inputTokens = 0; let outputTokens = 0;
    Object.values(scoresState).forEach(r => {
      if (r.usage) {
        inputTokens  += r.usage.inputTokens  || 0;
        outputTokens += r.usage.outputTokens || 0;
      }
    });
    const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    return { inputTokens, outputTokens, totalCost: cost.toFixed(3) };
  }, [scoresState]);

  const filteredImages = useMemo(() =>
    Object.entries(scoresState)
      .filter(([, r]) => r.tier === activeTab)
      .sort((a, b) => b[1].total - a[1].total),
    [scoresState, activeTab]);

  // ── Focus clamping ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (focusedIndex !== null) {
      if (filteredImages.length === 0) setFocusedIndex(null);
      else if (focusedIndex >= filteredImages.length) setFocusedIndex(filteredImages.length - 1);
    }
  }, [filteredImages.length, focusedIndex]);

  // ── Scroll focused tile into view via grid API (12b.1) ────────────────────────
  useEffect(() => {
    if (focusedIndex !== null && gridRef.current) {
      gridRef.current.scrollToItem({
        rowIndex: Math.floor(focusedIndex / colCountRef.current),
        align: 'smart',
      });
    }
  }, [focusedIndex]);

  // ── handleUpdateTier (with undo push) ─────────────────────────────────────────
  const handleUpdateTier = useCallback(async (
    imageId: string,
    newTier: 'S' | 'A' | 'B' | 'rejected',
    skipUndo = false,
  ) => {
    const existing = scoresState[imageId];
    if (!existing) return;

    if (!skipUndo) {
      setUndoStack(prev => [
        { imageId, previousTier: existing.tier, filename: existing.filename, timestamp: Date.now() },
        ...prev,
      ].slice(0, 20));
    }

    setScoresState(prev => ({
      ...prev,
      [imageId]: { ...prev[imageId], tier: newTier },
    }));

    try {
      await window.electronAPI.sessionUpdateTier({
        outputFolder: settings.outputFolder,
        imageId,
        newTier,
      });
    } catch (err: any) {
      console.error('[results] Failed to persist manual tier change:', err);
    }
  }, [scoresState, settings.outputFolder]);

  // ── Undo (12b.2) ──────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const [entry, ...rest] = prev;
      handleUpdateTier(entry.imageId, entry.previousTier, true);
      const tierLabel = entry.previousTier === 'rejected' ? 'Rejected' : `${entry.previousTier}-tier`;
      setUndoToast(`Moved ${entry.filename} back to ${tierLabel}`);
      setTimeout(() => setUndoToast(null), 3500);
      return rest;
    });
  }, [handleUpdateTier]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo]);

  // ── Selection ─────────────────────────────────────────────────────────────────
  const handleToggleSelect = useCallback((imageId: string) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
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

  // ── Keyboard culling handlers ─────────────────────────────────────────────────
  const handleKeyboardNavigate = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    if (filteredImages.length === 0) return;
    if (focusedIndex === null) { setFocusedIndex(0); return; }
    const cols = colCountRef.current;
    let newIndex = focusedIndex;
    switch (direction) {
      case 'left':  newIndex = Math.max(0, focusedIndex - 1); break;
      case 'right': newIndex = Math.min(filteredImages.length - 1, focusedIndex + 1); break;
      case 'up':    newIndex = Math.max(0, focusedIndex - cols); break;
      case 'down':  newIndex = Math.min(filteredImages.length - 1, focusedIndex + cols); break;
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
    if (isCompareOpen) setIsCompareOpen(false);
    else setSelectedImageIds(new Set());
  }, [isCompareOpen]);

  // ── Export handlers ───────────────────────────────────────────────────────────
  const handleExportJson = async () => {
    if (stats.total === 0) return;
    setExporting(true);
    try {
      const res = await window.electronAPI.exportResultsJson({ outputFolder: settings.outputFolder });
      if (res?.filePath) {
        setExportToast({ filePath: res.filePath, count: res.imageCount });
        setTimeout(() => setExportToast(null), 7000);
      }
    } catch (err: any) {
      setErrorMsg(`Export failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally { setExporting(false); }
  };

  // 12b.5 — CSV export
  const handleExportCsv = async () => {
    if (stats.total === 0) return;
    setExportingCsv(true);
    try {
      const res = await window.electronAPI.exportResultsCsv({ outputFolder: settings.outputFolder });
      if (res?.filePath) {
        setExportToast({ filePath: res.filePath, count: res.imageCount });
        setTimeout(() => setExportToast(null), 7000);
      }
    } catch (err: any) {
      setErrorMsg(`CSV export failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally { setExportingCsv(false); }
  };

  // 12b.6 — ZIP export
  const handleExportZip = async () => {
    if (stats.total === 0) return;
    setExportingZip(true);
    setZipProgress(0);
    const removeListener = window.electronAPI.onZipProgress((pct: number) => setZipProgress(pct));
    try {
      const res = await window.electronAPI.exportSessionZip({ outputFolder: settings.outputFolder });
      if (res?.filePath) {
        setExportToast({ filePath: res.filePath, count: res.fileCount });
        setTimeout(() => setExportToast(null), 7000);
      }
    } catch (err: any) {
      setErrorMsg(`Zip export failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      removeListener();
      setExportingZip(false);
      setZipProgress(null);
    }
  };

  const handleOpenOutputFolder = async () => {
    try { await window.electronAPI.shellShowItem(settings.outputFolder); }
    catch (err: any) {
      setErrorMsg(`Could not open output folder: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    }
  };

  // Phase 13 — XMP sidecar export
  const handleExportXmp = async () => {
    if (stats.total === 0) return;
    setExportingXmp(true);
    try {
      // Build filename → absolutePath map from the session's input folder.
      // For processSubfolders sessions the session stores the full inputFolder
      // root; score.filename is relative to that root (e.g. "Reception/IMG_001.CR3").
      // For flat sessions, score.filename is just the basename.
      const inputFolder = settings.inputFolder;
      const imagePathMap: Record<string, string> = {};
      for (const score of Object.values(scoresState)) {
        // Handles both flat ("IMG_001.CR3") and subfolder-relative paths
        // ("Reception/IMG_001.CR3") correctly via path.join.
        imagePathMap[score.filename] = `${inputFolder}/${score.filename}`.replace(/\\/g, '/');
      }

      const res = await window.electronAPI.exportXmp({
        outputFolder: settings.outputFolder,
        imagePathMap,
        includeDescription: xmpIncludeDescription,
      });

      if (res) {
        const { written, errors } = res;
        if (errors.length > 0) {
          setErrorMsg(`XMP: ${written} written, ${errors.length} failed. Check the console for details.`);
          setTimeout(() => setErrorMsg(null), 7000);
        } else {
          setExportToast({ filePath: settings.inputFolder, count: written });
          setTimeout(() => setExportToast(null), 7000);
        }
      }
    } catch (err: any) {
      setErrorMsg(`XMP export failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setExportingXmp(false);
    }
  };

  // Phase 13b — AI auto-tagging (on-demand)
  const handleAutoTag = async () => {
    if (isAutoTagging) return;
    setIsAutoTagging(true);
    try {
      // @ts-expect-error — electronAPI is typed in preload.js
      const res = await window.electronAPI.runAutoTagging({
        outputFolder: settings.outputFolder,
        settings,
      });

      if (!res?.success) {
        setErrorMsg(res?.error ?? 'Auto-tagging failed.');
        setTimeout(() => setErrorMsg(null), 7000);
        return;
      }

      if (res.written === 0) {
        setAutoTagToast('No qualifying keepers to tag.');
      } else {
        setAutoTagToast(`${res.written} image${res.written !== 1 ? 's' : ''} tagged with AI keywords.`);
        // Reload session scores so keyword pills appear without a full refresh.
        try {
          const loaded = await window.electronAPI.sessionLoad({ outputFolder: settings.outputFolder });
          if (loaded) setScoresState(loaded.scores || {});
        } catch { /* non-fatal — stale display is acceptable */ }
      }
      setTimeout(() => setAutoTagToast(null), 5000);
    } catch (err: any) {
      setErrorMsg(`Auto-tagging failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setIsAutoTagging(false);
    }
  };

  // Phase 14.4 — Save style profile from Results screen
  const handleOpenProfileSave = useCallback(async () => {
    const genre = settings.genre ?? 'general';
    const month = new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const genreLabel = (genre as string).charAt(0).toUpperCase() + (genre as string).slice(1);
    setProfileSaveName(`${genreLabel} — ${month}`);
    setProfileSaveError(null);
    setShowProfileSave(true);
  }, [settings.genre]);

  const handleSaveProfile = useCallback(async () => {
    const name = profileSaveName.trim();
    if (!name) return;
    setIsSavingProfile(true);
    setProfileSaveError(null);
    try {
      // Check free tier limit
      // @ts-expect-error — electronAPI bridge
      const existing: StyleProfile[] = await window.electronAPI.profilesList();
      // @ts-expect-error — electronAPI bridge
      const tier = await window.electronAPI.licenseGetTier();
      if (tier === 'free' && existing.length >= 2) {
        setProfileSaveError('Free plan allows 2 profiles. Upgrade to Pro for unlimited profiles.');
        return;
      }

      const newProfile: StyleProfile = {
        id: crypto.randomUUID(),
        name,
        genre: settings.genre,
        weights: settings.weights,
        preferenceText: settings.preferenceText ?? '',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      // @ts-expect-error — electronAPI bridge
      await window.electronAPI.profilesSave(newProfile);
      setShowProfileSave(false);
      setProfileSaveName('');
      setProfileSaveToast(`Profile "${name}" saved.`);
      setTimeout(() => setProfileSaveToast(null), 4000);
    } catch (err: any) {
      setProfileSaveError(`Failed to save profile: ${err.message || err}`);
    } finally {
      setIsSavingProfile(false);
    }
  }, [profileSaveName, settings]);

  // 12b.4 — Re-score selected
  const handleRescore = useCallback(async () => {
    if (selectedImageIds.size === 0) return;
    const imageIds = Array.from(selectedImageIds);
    setIsRescoring(true);
    setRescoreProgress({ done: 0, total: imageIds.length });

    const removeListener = window.electronAPI.onPipelineEvent((event: PipelineEvent) => {
      if (event.type === 'pipeline-image-scored') {
        setRescoreProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
        // For re-score calls the main process sends imageId in event.filename
        const id = event.filename;
        setScoresState(prev => {
          if (!prev[id]) return prev;
          return {
            ...prev,
            [id]: {
              ...prev[id],
              scores:    event.score.scores,
              total:     event.score.total,
              tier:      event.score.tier,
              reasoning: event.score.reasoning,
            },
          };
        });
      }
    });

    try {
      await window.electronAPI.rescoreImages({ imageIds, outputFolder: settings.outputFolder, settings });
      setSelectedImageIds(new Set());
    } catch (err: any) {
      setErrorMsg(`Re-score failed: ${err.message || err}`);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      removeListener();
      setIsRescoring(false);
      setRescoreProgress(null);
    }
  }, [selectedImageIds, settings]);

  // ── Compare items ─────────────────────────────────────────────────────────────
  const compareItems = useMemo(() =>
    Array.from(selectedImageIds)
      .map(id => ({ id, record: scoresState[id] }))
      .filter(item => item.record !== undefined),
    [selectedImageIds, scoresState]);

  // ── Virtualized grid cell renderer (12b.1) ────────────────────────────────────
  // Defined with useCallback so FixedSizeGrid doesn't re-render all cells on
  // every keystroke — only cells whose data actually changed will re-paint.
  const CellRenderer = useCallback(({ columnIndex, rowIndex, style }: GridChildComponentProps) => {
    const col   = colCountRef.current;
    const index = rowIndex * col + columnIndex;
    if (index >= filteredImages.length) return null;

    const [id, record] = filteredImages[index];
    const isSelected   = selectedImageIds.has(id);
    const isFocused    = focusedIndex === index;

    return (
      <div
        style={{
          ...style,
          paddingRight:  columnIndex < col - 1 ? TILE_GAP : 0,
          paddingBottom: TILE_GAP,
        }}
      >
        <div id={`tile-${id}`} className="relative h-full">
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleSelect(id); }}
            className={`absolute top-2.5 right-2.5 z-10 w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
              isSelected
                ? 'bg-amber-500 border-amber-400 text-black font-extrabold'
                : 'bg-black/60 border-white/20 text-transparent hover:border-white/50 hover:bg-black/80'
            }`}
            title={isSelected ? 'Deselect image' : 'Select for comparison'}
          >
            <Check size={12} className={isSelected ? 'stroke-[3]' : 'stroke-[1]'} />
          </button>

          <ImageTile
            score={record}
            imageId={id}
            outputFolder={settings.outputFolder}
            isSelected={isSelected}
            isFocused={isFocused}
            onClick={() => { setFocusedIndex(index); handleToggleSelect(id); }}
          />
        </div>
      </div>
    );
  }, [filteredImages, selectedImageIds, focusedIndex, handleToggleSelect, settings.outputFolder]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-[#0c0e14] text-gray-900 dark:text-white pb-24 transition-colors duration-200">

      <KeyboardCuller
        enabled={!isCompareOpen && !isRescoring}
        onNavigate={handleKeyboardNavigate}
        onAssignTier={handleKeyboardAssignTier}
        onToggleSelect={handleKeyboardToggleSelect}
        onCompare={handleCompareSelected}
        onEscape={handleEscape}
      />

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

      {/* Re-score progress modal (12b.4) */}
      <AnimatePresence>
        {rescoreProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              exit={{    scale: 0.9, opacity: 0 }}
              className="bg-[#10131e] border border-white/10 rounded-2xl p-8 shadow-2xl text-white min-w-[320px] space-y-4"
            >
              <div className="flex items-center gap-3">
                <RefreshCw size={20} className="text-violet-400 animate-spin" />
                <h3 className="text-sm font-semibold">
                  Re-scoring {rescoreProgress.total} image{rescoreProgress.total !== 1 ? 's' : ''}…
                </h3>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${(rescoreProgress.done / rescoreProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-white/50 text-right tabular-nums">
                {rescoreProgress.done} / {rescoreProgress.total}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 w-full border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-[#0c0e14]/80 backdrop-blur-md transition-colors">
        <div className="max-w-7xl mx-auto px-6 flex flex-col">
          <div className="flex justify-between items-center py-4 gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 bg-clip-text text-transparent">
                CullAI Results
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 font-medium">
                Pipeline completed successfully · Review & Adjust
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Re-score selected (12b.4) */}
              <button
                onClick={handleRescore}
                disabled={isRescoring || selectedImageIds.size === 0 || stats.total === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Re-score selected images with current weight settings"
              >
                <RefreshCw size={14} className={isRescoring ? 'animate-spin' : ''} />
                <span>Re-score{selectedImageIds.size > 0 ? ` (${selectedImageIds.size})` : ''}</span>
              </button>

              <button
                onClick={handleOpenOutputFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white/80 hover:bg-gray-200 dark:hover:bg-white/10 transition"
              >
                <FolderOpen size={14} />
                <span>Open Folder</span>
              </button>

              {/* Export JSON */}
              <button
                onClick={handleExportJson}
                disabled={exporting || stats.total === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Download size={14} />
                <span>{exporting ? 'Exporting…' : 'Export JSON'}</span>
              </button>

              {/* Export CSV (12b.5) */}
              <button
                onClick={handleExportCsv}
                disabled={exportingCsv || stats.total === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <FileText size={14} />
                <span>{exportingCsv ? 'Exporting…' : 'Export CSV'}</span>
              </button>

              {/* Export ZIP (12b.6) */}
              <button
                onClick={handleExportZip}
                disabled={exportingZip || stats.total === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Archive size={14} className={exportingZip ? 'animate-pulse' : ''} />
                <span>
                  {exportingZip ? `Archiving… ${zipProgress ?? 0}%` : 'Export Bundle (.zip)'}
                </span>
              </button>

              {/* Export XMP sidecars (Phase 13) */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleExportXmp}
                  disabled={exportingXmp || stats.total === 0}
                  title="Write .xmp sidecar files alongside original images — readable by Lightroom Classic and Capture One"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-400 hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Tag size={14} className={exportingXmp ? 'animate-pulse' : ''} />
                  <span>{exportingXmp ? 'Writing XMP…' : 'Export XMP'}</span>
                </button>
                {/* Inline toggle: include AI reasoning in dc:description */}
                <label
                  className="flex items-center gap-1 cursor-pointer select-none"
                  title="Embed AI reasoning text in the XMP dc:description field"
                >
                  <input
                    type="checkbox"
                    checked={xmpIncludeDescription}
                    onChange={e => setXmpIncludeDescription(e.target.checked)}
                    className="w-3 h-3 accent-teal-400 cursor-pointer"
                  />
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                    incl. reasoning
                  </span>
                </label>
              </div>

              {/* AI keyword tagging — Phase 13b */}
              {settings.enableAutoTagging && (
                <button
                  onClick={handleAutoTag}
                  disabled={isAutoTagging || (stats.S === 0 && stats.A === 0)}
                  title="Generate AI keyword tags for S and A-tier keepers and write them to XMP sidecars"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Sparkles size={14} className={isAutoTagging ? 'animate-pulse' : ''} />
                  <span>{isAutoTagging ? 'Tagging…' : 'Generate AI Keywords'}</span>
                </button>
              )}

              {/* Save as Style Profile — Phase 14.4 */}
              <button
                onClick={handleOpenProfileSave}
                disabled={showProfileSave}
                title="Save this session's genre, weights, and style text as a reusable profile"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Bookmark size={14} />
                <span>Save Profile</span>
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

          {/* Tab Selector — 12b.7: count/total badges */}
          <div className="flex gap-2 border-t border-gray-100 dark:border-white/5 pt-2">
            {TABS.map(tab => {
              const count    = stats[tab.id];
              const total    = stats.total;
              const isActive = activeTab === tab.id;
              const pct      = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setFocusedIndex(null); }}
                  title={`${count} of ${total} total images (${pct}%)`}
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
                      <span className="tabular-nums">{count}</span>
                      {total > 0 && <span className="opacity-50">/{total}</span>}
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

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Star}        title="S-Tier (Best)"     value={stats.S}     colorClass="text-amber-500"   subtext="Rated 90+ overall quality" />
          <StatCard icon={TrendingDown} title="A-Tier (Keepers)" value={stats.A}     colorClass="text-emerald-500" subtext="Select keepers for final culls" />
          <StatCard icon={Slash}       title="B-Tier (Maybe)"    value={stats.B}     colorClass="text-sky-500"     subtext="Promotable on shortfall" />
          <StatCard icon={ImageIcon}   title="Total Processed"   value={stats.total} colorClass="text-white/60"    subtext={
            costStats.inputTokens > 0
              ? `${costStats.inputTokens + costStats.outputTokens} tokens (~$${costStats.totalCost})`
              : 'No cost logs recorded'
          } />
        </section>

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

        {/* ── Virtualized Gallery Grid (12b.1) ────────────────────────────── */}
        {filteredImages.length > 0 ? (
          <div style={{ height: '72vh', minHeight: 480 }}>
            <AutoSizer>
              {({ width, height }: { width: number; height: number }) => {
                const colCount = Math.max(1, Math.floor((width + TILE_GAP) / (TILE_WIDTH + TILE_GAP)));
                colCountRef.current = colCount;
                const rowCount = Math.ceil(filteredImages.length / colCount);
                // Distribute width evenly across columns; gap is handled by cell padding
                const colWidth = Math.floor(width / colCount);

                return (
                  <FixedSizeGrid
                    ref={gridRef}
                    width={width}
                    height={height}
                    columnCount={colCount}
                    rowCount={rowCount}
                    columnWidth={colWidth}
                    rowHeight={TILE_HEIGHT + TILE_GAP}
                    overscanRowCount={2}
                  >
                    {CellRenderer}
                  </FixedSizeGrid>
                );
              }}
            </AutoSizer>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-2xl border border-dashed border-gray-200 dark:border-white/10 bg-white/5 dark:bg-white/[0.02]">
            <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-400">
              <ImageIcon size={24} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No images in this tier</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                You can rate other images as '{activeTab === 'rejected' ? 'R' : activeTab}' to place them here.
              </p>
            </div>
          </div>
        )}
      </main>

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

      {/* ── Toast notifications ── */}
      <AnimatePresence>
        {exportToast && (
          <motion.div
            key="export-toast"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: 20,  scale: 0.95 }}
            className="fixed bottom-6 left-6 z-50 max-w-md bg-[#10131e] border border-emerald-500/30 rounded-xl p-4 shadow-xl backdrop-blur-md text-white"
          >
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                <Check size={18} />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <h4 className="text-xs font-bold text-emerald-400">Exported Successfully!</h4>
                <p className="text-[11px] text-white/70 leading-normal truncate">
                  {exportToast.count} {exportToast.count === 1 ? 'file' : 'files'} written
                </p>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={async () => {
                      try { await window.electronAPI.shellShowItem(exportToast.filePath); } catch { /* non-fatal */ }
                    }}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition"
                  >
                    <span>Show in Folder</span>
                    <ArrowRight size={10} />
                  </button>
                  <button onClick={() => setExportToast(null)} className="text-[10px] font-medium text-white/40 hover:text-white/60 transition">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Undo toast (12b.2) */}
        {undoToast && (
          <motion.div
            key="undo-toast"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: 20,  scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 max-w-sm bg-[#10131e] border border-sky-500/30 rounded-xl p-3 shadow-xl backdrop-blur-md text-white flex items-center gap-3"
          >
            <RotateCcw size={16} className="text-sky-400 shrink-0" />
            <span className="text-xs text-white/80">{undoToast}</span>
          </motion.div>
        )}

        {errorMsg && (
          <motion.div
            key="error-toast"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{    opacity: 0, y: 20  }}
            className="fixed bottom-6 left-6 z-50 bg-[#161217] border border-red-500/30 text-red-200 text-xs px-4 py-3 rounded-lg shadow-xl flex items-center gap-2"
          >
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </motion.div>
        )}
        {autoTagToast && (
          <motion.div
            key="autotag-toast"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{    opacity: 0, y: 20  }}
            className="fixed bottom-6 right-6 z-50 bg-[#161217] border border-purple-500/30 text-purple-200 text-xs px-4 py-3 rounded-lg shadow-xl flex items-center gap-2"
          >
            <Sparkles size={14} className="text-purple-400 shrink-0" />
            <span>{autoTagToast}</span>
          </motion.div>
        )}

        {/* Save-profile inline panel — Phase 14.4 */}
        {showProfileSave && (
          <motion.div
            key="profile-save-panel"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: 20,  scale: 0.95 }}
            className="fixed bottom-6 left-6 z-50 w-full max-w-sm bg-[#10131e] border border-amber-500/30 rounded-xl p-4 shadow-xl backdrop-blur-md text-white"
          >
            <div className="flex items-center gap-2 mb-3">
              <Bookmark size={15} className="text-amber-400 shrink-0" />
              <h4 className="text-xs font-bold text-amber-400 flex-1">Save Style Profile</h4>
              <button
                onClick={() => { setShowProfileSave(false); setProfileSaveError(null); }}
                className="p-0.5 text-white/40 hover:text-white/70 transition"
              >
                <X size={14} />
              </button>
            </div>
            <input
              autoFocus
              value={profileSaveName}
              onChange={e => { setProfileSaveName(e.target.value); setProfileSaveError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveProfile(); if (e.key === 'Escape') setShowProfileSave(false); }}
              placeholder="Profile name…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-500 mb-2"
            />
            {profileSaveError && (
              <p className="text-[11px] text-red-400 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={11} className="shrink-0" />
                {profileSaveError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveProfile}
                disabled={isSavingProfile || !profileSaveName.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black text-xs font-bold rounded-lg transition"
              >
                {isSavingProfile
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Check size={12} />
                }
                Save
              </button>
              <p className="text-[10px] text-white/40">
                Genre: <span className="text-white/60 capitalize">{settings.genre}</span>
              </p>
            </div>
          </motion.div>
        )}

        {/* Profile saved toast — Phase 14.4 */}
        {profileSaveToast && (
          <motion.div
            key="profile-save-toast"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{    opacity: 0, y: 20  }}
            className="fixed bottom-6 right-6 z-50 bg-[#161217] border border-amber-500/30 text-amber-300 text-xs px-4 py-3 rounded-lg shadow-xl flex items-center gap-2"
          >
            <Bookmark size={13} className="text-amber-400 shrink-0" />
            <span>{profileSaveToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── StatCard ───────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, title, value, colorClass, subtext,
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