import { motion } from 'framer-motion';
import { XCircle, Cpu, FolderOpen, ImageIcon, Settings2, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import type { AppSettings, PipelineEvent, ShortfallReasons, ScoreRecord } from '../../shared/types';

interface ProcessingScreenProps {
  settings: AppSettings;
  onCancel: () => void;
  onComplete: (session?: any) => void; // Phase 10 expects session data on completion
}

export default function ProcessingScreen({ settings, onCancel, onComplete }: ProcessingScreenProps) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [totalImages, setTotalImages] = useState(0);
  const [scoredCount, setScoredCount] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [currentFilename, setCurrentFilename] = useState('');
  const [logLines, setLogLines] = useState<Array<{ filename: string; total: number; tier: string; reasoning?: string }>>([]);
  const [totalInputTokens, setTotalInputTokens] = useState(0);
  const [totalOutputTokens, setTotalOutputTokens] = useState(0);
  const [inputCountWarning, setInputCountWarning] = useState<{ requested: number; available: number } | null>(null);
  const [shortfallSummary, setShortfallSummary] = useState<{ reasons: ShortfallReasons; finalSelectedCount: number; requestedCount: number } | null>(null);
  const [shortfallDismissed, setShortfallDismissed] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [startTime] = useState(Date.now());

  // ── Batch progress (Phase 10b — multi-folder mode) ────────────────────────
  const [batchProgress, setBatchProgress] = useState<{
    currentBatch: number;
    totalBatches: number;
    currentFolderName: string;
    completedBatches: number;
  } | null>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);

  // Auto-scroll log panel
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines]);

  // ── Pipeline event subscription ──────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return;
    if (!settings.inputFolder || !settings.outputFolder) {
      setPipelineError("Missing input or output folder. Please go back and select folders.");
      return;
    }

    startedRef.current = true;

    const start = async () => {
      try {
        await window.electronAPI.startPipeline(settings);
      } catch (err: any) {
        setPipelineError(err.message || 'Failed to start pipeline');
      }
    };

    const unsub = window.electronAPI.onPipelineEvent((event: PipelineEvent) => {
      switch (event.type) {
        case 'pipeline-started':
          setTotalImages(event.totalImages);
          setScoredCount(0);
          setEtaSeconds(null);
          setLogLines([]);
          setShortfallSummary(null);
          setShortfallDismissed(false);
          setPipelineError(null);
          break;

        case 'pipeline-image-scored':
          setScoredCount(event.scoredCount);
          setCurrentFilename(event.filename);
          setEtaSeconds(event.etaSeconds ?? null);
          setLogLines((prev) => [
            ...prev,
            {
              filename: event.filename,
              total: event.score.total,
              tier: event.score.tier,
              reasoning: event.score.reasoning,
            },
          ]);
          break;

        case 'pipeline-cost-update':
          setTotalInputTokens(event.totalInputTokens);
          setTotalOutputTokens(event.totalOutputTokens);
          break;

        case 'pipeline-needs-confirmation':
          setInputCountWarning({ requested: event.requested, available: event.available });
          break;

        case 'pipeline-output-summary':
          setShortfallSummary({
            reasons: event.shortfallReasons,
            finalSelectedCount: event.finalSelectedCount,
            requestedCount: settings.numImagesToSelect,
          });
          break;

        case 'pipeline-complete':
          setIsComplete(true);
          // Optional: pass session data to parent
          onComplete(event.session);
          break;

        case 'pipeline-error':
          setPipelineError(event.message);
          break;

        case 'pipeline-batch-started':
          // Multi-folder mode: a new subfolder batch is beginning.
          // Reset per-batch counters so the progress ring reflects the current folder.
          setBatchProgress({
            currentBatch: event.batchIndex,
            totalBatches: event.totalBatches,
            currentFolderName: event.folderName,
            completedBatches: event.batchIndex - 1,
          });
          // Reset image-level counters for the incoming batch.
          setTotalImages(event.batchImageCount);
          setScoredCount(0);
          setEtaSeconds(null);
          setCurrentFilename('');
          break;

        case 'pipeline-batch-complete':
          // Mark this batch as done in the progress tracker.
          setBatchProgress((prev) =>
            prev
              ? { ...prev, completedBatches: event.batchIndex }
              : { currentBatch: event.batchIndex, totalBatches: event.totalBatches, currentFolderName: '', completedBatches: event.batchIndex }
          );
          break;

        default:
          // unknown event, ignore
          break;
      }
    });

    unsubscribeRef.current = unsub;
        start();

        return () => {
          if (unsubscribeRef.current) unsubscribeRef.current();
        };
      }, [settings, onComplete]);

  // ── Cancel handler ────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (isCancelling || isComplete) return;
    setIsCancelling(true);
    try {
      await window.electronAPI.cancelPipeline({ outputFolder: settings.outputFolder });
    } catch (err) {
      console.error('Cancel failed', err);
    } finally {
      setIsCancelling(false);
      onCancel();
    }
  };

  // ── Confirm continue (after §10.5 warning) ────────────────────────────────
  const handleConfirmContinue = async () => {
    await window.electronAPI.confirmPipelineContinue();
    setInputCountWarning(null);
  };

  // ── Cancel during §10.5 warning ───────────────────────────────────────────
  const handleCancelWarning = () => {
    handleCancel();
    setInputCountWarning(null);
  };

  // ── Dismiss shortfall banner (user chooses not to add excluded) ───────────
  const handleDismissShortfall = () => {
    setShortfallDismissed(true);
  };

  // ── Add excluded images (respect shortfallStrategy) ───────────────────────
  const handleAddExcluded = async () => {
    if (!shortfallSummary) return;
    const { requestedCount } = shortfallSummary;
    setShortfallDismissed(true); // hide banner while working
    try {
      const updatedSession = await window.electronAPI.fillPipelineShortfall({
        outputFolder: settings.outputFolder,
        targetCount: requestedCount,
      });
      // Transition to Results screen with the updated session
      onComplete(updatedSession);
    } catch (err: any) {
      console.error('Fill shortfall failed:', err);
      // Show an error banner (optional)
      setPipelineError(err.message || 'Failed to add excluded images');
      setShortfallDismissed(false); // let user retry
    }
  };

  // ── Progress ring calculation ─────────────────────────────────────────────
  const circumference = 2 * Math.PI * 40; // radius 40
  const progress = totalImages === 0 ? 0 : scoredCount / totalImages;
  const strokeDashoffset = circumference * (1 - progress);

  const providerLabel: Record<string, string> = {
    claude: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    ollama: 'Ollama',
    custom: 'Custom',
  };

  // ── Render shortfall banner (if required) ─────────────────────────────────
  const shouldShowShortfallBanner = () => {
    if (!shortfallSummary || shortfallDismissed || isComplete) return false;
    const { finalSelectedCount, requestedCount, reasons } = shortfallSummary;
    if (finalSelectedCount >= requestedCount) return false;
    // If shortfallStrategy is 'stop', the pipeline would have already errored.
    // So we only show when auto-fill didn't reach the target.
    return true;
  };

  // ── Render §10.5 modal ────────────────────────────────────────────────────
  const renderConfirmationModal = () => {
    if (!inputCountWarning) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-amber-400/30 bg-white dark:bg-[#161b27] p-6 shadow-xl">
          <div className="flex items-center gap-3 text-amber-500">
            <AlertTriangle className="w-6 h-6" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Not enough images</h3>
          </div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            You requested <strong>{inputCountWarning.requested}</strong> keepers,
            but only <strong>{inputCountWarning.available}</strong> images were found in the folder.
          </p>
          <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm">
            Do you want to continue with {inputCountWarning.available} images?
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleCancelWarning}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmContinue}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  };
  const renderZeroTargetInfo = () => {
    if (!shortfallSummary || shortfallSummary.requestedCount !== 0) return null;
    return (
      <div className="rounded-xl border border-blue-400/40 bg-blue-50/80 dark:bg-blue-900/20 px-6 py-4">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          No target quantity set → exported all S‑tier images ({shortfallSummary.finalSelectedCount} total).
        </p>
      </div>
    );
  };
  // ── Render shortfall banner ───────────────────────────────────────────────
  const renderShortfallBanner = () => {
    if (!shouldShowShortfallBanner()) return null;
    const { finalSelectedCount, requestedCount, reasons } = shortfallSummary!;
    const shortfall = requestedCount - finalSelectedCount;
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-50/80 dark:bg-amber-900/20 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Shortfall: {finalSelectedCount} of {requestedCount} keepers selected
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-0.5">
                {reasons.duplicatesSkipped} duplicates, {reasons.belowThreshold} below quality floor,
                {reasons.exceededFaceLimit} face-limit rejects
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddExcluded}
              className="px-3 py-1.5 text-xs rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition"
            >
              Add excluded ({shortfall})
            </button>
            <button
              onClick={handleDismissShortfall}
              className="px-3 py-1.5 text-xs rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/50 transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-[#0f1117] dark:to-[#0a0c10]"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 w-full border-b border-gray-200 dark:border-[#1e2535] shadow-sm backdrop-blur-md bg-gray-50/90 dark:bg-[#0f1117]/90">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex justify-between items-center pt-5 pb-5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
                CullAI
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                {isComplete ? 'Processing complete' : 'Processing your photos…'}
              </p>
            </div>
            <button
              onClick={handleCancel}
              disabled={isCancelling || isComplete}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a1f2e] hover:border-red-400/50 hover:text-red-500 dark:hover:text-red-400 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {isCancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {/* Batch progress strip — only shown in multi-folder mode */}
        {batchProgress && batchProgress.totalBatches > 1 && (
          <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Folder {batchProgress.currentBatch} of {batchProgress.totalBatches}
                  {batchProgress.currentFolderName ? ` — "${batchProgress.currentFolderName}"` : ''}
                </span>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {batchProgress.completedBatches} completed
              </span>
            </div>
            {/* Segmented progress track */}
            <div className="flex gap-1">
              {Array.from({ length: batchProgress.totalBatches }, (_, i) => {
                const idx = i + 1;
                const isDone = idx < batchProgress.currentBatch;
                const isCurrent = idx === batchProgress.currentBatch;
                return (
                  <div
                    key={idx}
                    className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                      isDone
                        ? 'bg-green-500'
                        : isCurrent
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-gray-200 dark:bg-[#1e2535]'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Progress card */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] p-8">
          <div className="flex flex-col items-center text-center gap-5">
            <div className="relative w-24 h-24">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                <circle
                  cx="48" cy="48" r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-gray-200 dark:text-[#1e2535]"
                />
                <circle
                  cx="48" cy="48" r="40"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  className="text-amber-500 transition-all duration-700"
                  stroke="currentColor"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                {isComplete ? (
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                ) : (
                  <Cpu className="w-8 h-8 text-amber-500 animate-pulse" />
                )}
              </div>
            </div>

            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {totalImages === 0 ? 0 : Math.round(progress * 100)}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {isComplete
                  ? 'Pipeline finished'
                  : totalImages > 0
                    ? `${scoredCount} of ${totalImages} scored`
                    : 'Waiting to start…'}
              </p>
              {etaSeconds !== null && etaSeconds > 0 && !isComplete && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  ~{etaSeconds} seconds remaining
                </p>
              )}
            </div>

            {/* Stats row */}
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{scoredCount}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Scored</p>
              </div>
              <div className="w-px bg-gray-200 dark:bg-[#1e2535]" />
              <div>
                <p className="text-lg font-semibold text-amber-500">
                  {settings.numImagesToSelect}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Target keepers</p>
              </div>
              <div className="w-px bg-gray-200 dark:bg-[#1e2535]" />
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {Math.round((totalInputTokens + totalOutputTokens) / 1000)}k
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Tokens</p>
              </div>
            </div>

            {/* Current filename */}
            {currentFilename && !isComplete && (
              <div className="max-w-md truncate text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-[#1e2535] pt-4 mt-2">
                {currentFilename}
              </div>
            )}
          </div>
        </div>

        {/* Session config summary */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Session Config
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoRow icon={FolderOpen} label="Input folder" value={settings.inputFolder || '—'} />
            <InfoRow icon={FolderOpen} label="Output folder" value={settings.outputFolder || '—'} />
            <InfoRow icon={Cpu} label="Provider" value={`${providerLabel[settings.provider] ?? settings.provider} — ${settings.model}`} />
            <InfoRow icon={Settings2} label="Concurrency" value={`${settings.concurrency} parallel`} />
            <InfoRow icon={ImageIcon} label="Genre" value={settings.genre} />
            <InfoRow
              icon={Settings2}
              label="Mode"
              value={settings.dryRun ? 'Dry run (no writes)' : settings.lightroomMode === 'rateInPlace' ? 'Rate in-place' : 'Copy to output'}
            />
          </div>
        </div>
        {/* Error banner */}
        {pipelineError && (
          <div className="rounded-xl border border-red-400/40 bg-red-50/80 dark:bg-red-900/20 px-6 py-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm font-medium">Pipeline error: {pipelineError}</p>
            </div>
          </div>
        )}

        {/* Zero‑target info banner (only when numImagesToSelect === 0) */}
        {shortfallSummary?.requestedCount === 0 && (
          <div className="rounded-xl border border-blue-400/40 bg-blue-50/80 dark:bg-blue-900/20 px-6 py-4">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              No target quantity set → exported all S‑tier images ({shortfallSummary.finalSelectedCount} total).
            </p>
          </div>
        )}

        {/* Shortfall banner (if applicable) */}
        {renderShortfallBanner()}

        {/* Error banner */}
        {pipelineError && (
          <div className="rounded-xl border border-red-400/40 bg-red-50/80 dark:bg-red-900/20 px-6 py-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm font-medium">Pipeline error: {pipelineError}</p>
            </div>
          </div>
        )}

        {/* Log panel */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-[#1e2535] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Log
            </h2>
            <span className="text-xs text-gray-400 dark:text-gray-600">
              {logLines.length} images processed
            </span>
          </div>
          <div
            ref={logContainerRef}
            className="h-48 overflow-y-auto px-6 py-4 font-mono text-xs space-y-1.5"
          >
            {logLines.length === 0 && !pipelineError && (
              <p className="text-gray-400 dark:text-gray-600">— awaiting pipeline —</p>
            )}
            {logLines.map((line, idx) => (
              <div key={idx} className="flex items-center gap-3 border-b border-gray-100 dark:border-[#1e2535] pb-1 last:border-0">
                <span className="text-gray-500 dark:text-gray-500 w-8 shrink-0">{idx + 1}</span>
                <span className="text-gray-700 dark:text-gray-300 truncate flex-1">{line.filename}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${getTierColor(line.tier)}`}>
                  {line.total}
                </span>
                <span className={`text-xs font-mono w-6 text-center ${getTierBadgeColor(line.tier)}`}>
                  {line.tier === 'S' ? 'S' : line.tier === 'A' ? 'A' : line.tier === 'B' ? 'B' : 'R'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal overlay for insufficient images */}
      {renderConfirmationModal()}
    </motion.div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{value}</p>
      </div>
    </div>
  );
}

function getTierColor(tier: string): string {
  switch (tier) {
    case 'S': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    case 'A': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'B': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}

function getTierBadgeColor(tier: string): string {
  switch (tier) {
    case 'S': return 'text-amber-600 dark:text-amber-400 font-bold';
    case 'A': return 'text-green-600 dark:text-green-400 font-bold';
    case 'B': return 'text-blue-600 dark:text-blue-400 font-bold';
    default: return 'text-gray-500 dark:text-gray-500';
  }
}