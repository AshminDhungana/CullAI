import { motion } from 'framer-motion';
import { XCircle, Cpu, FolderOpen, ImageIcon, Settings2, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import type { AppSettings, PipelineEvent, ShortfallReasons, ScoreRecord } from '../../shared/types';
import { estimateCost } from '../../shared/constants';

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
  const [logLines, setLogLines] = useState<Array<{ filename: string; total: number; tier: string; reasoning?: string; isMessage?: boolean; message?: string }>>([]);
  const [totalInputTokens, setTotalInputTokens] = useState(0);
  const [totalOutputTokens, setTotalOutputTokens] = useState(0);
  const [inputCountWarning, setInputCountWarning] = useState<{ requested: number; available: number } | null>(null);
  const [shortfallSummary, setShortfallSummary] = useState<{ reasons: ShortfallReasons; finalSelectedCount: number; requestedCount: number } | null>(null);
  const [shortfallDismissed, setShortfallDismissed] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [startTime] = useState(Date.now());
  const estimatedCost = estimateCost(settings.provider, totalInputTokens, totalOutputTokens);

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

  // Resume states & refs
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [showCompletedBanner, setShowCompletedBanner] = useState(false);
  const [loadedSession, setLoadedSession] = useState<any | null>(null);
  const [errorRecoverable, setErrorRecoverable] = useState(false);
  const [zeroFacesDetected, setZeroFacesDetected] = useState(false);

  const pipelineStartTimeRef = useRef<number | null>(null);
  const lastEtaUpdateRef = useRef<number>(0);
  const previouslyScoredCountRef = useRef<number>(0);

  // Auto-scroll log panel
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines]);

  // ── Helper: trigger start culling ──────────────────────────────────────────
  const triggerStart = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    pipelineStartTimeRef.current = Date.now();
    lastEtaUpdateRef.current = 0;

    // Subscribing to events
    // @ts-expect-error
    const unsub = window.electronAPI.onPipelineEvent((event: PipelineEvent) => {
      switch (event.type) {
        case 'pipeline-started':
          setTotalImages(event.totalImages);
          setScoredCount(0);
          setEtaSeconds(null);
          setLogLines([
            {
              isMessage: true,
              message: `Starting pipeline... Scoring with ${settings.concurrency} parallel API calls`,
              filename: '',
              total: 0,
              tier: '',
            },
          ]);
          setShortfallSummary(null);
          setShortfallDismissed(false);
          setPipelineError(null);
          break;

        case 'pipeline-image-scored':
          setScoredCount(event.scoredCount);
          setCurrentFilename(event.filename);

          // Calculate and throttle ETA updates to once every 5 seconds
          const now = Date.now();
          if (now - lastEtaUpdateRef.current >= 5000) {
            lastEtaUpdateRef.current = now;
            if (pipelineStartTimeRef.current) {
              const elapsedSeconds = (now - pipelineStartTimeRef.current) / 1000;
              const scoredInThisRun = event.scoredCount - previouslyScoredCountRef.current;
              if (scoredInThisRun > 0) {
                const avgSecPerImage = elapsedSeconds / scoredInThisRun;
                const remainingImages = (totalImages || event.scoredCount) - event.scoredCount;
                const eta = Math.round(remainingImages * avgSecPerImage);
                setEtaSeconds(eta);
              }
            }
          }

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
          // 16.6 — Zero faces detected: if Face & Eyes weight is part of the
          // scoring profile but no image in this session had any faces found,
          // surface an info banner suggesting the user set the weight to 0%.
          if ((settings.weights?.faceEyes ?? 0) > 0) {
            const scoreRecords = Object.values(event.session?.scores ?? {}) as ScoreRecord[];
            const anyFacesFound = scoreRecords.some(
              (record) => (record.faceMetadata?.faceCount ?? 0) > 0,
            );
            setZeroFacesDetected(scoreRecords.length > 0 && !anyFacesFound);
          }
          onComplete(event.session);
          break;

        case 'pipeline-error':
          setPipelineError(event.message || 'An unexpected error occurred');
          setErrorRecoverable((event as any).recoverable ?? false);
          break;

        case 'pipeline-batch-started':
          setBatchProgress({
            currentBatch: event.batchIndex,
            totalBatches: event.totalBatches,
            currentFolderName: event.folderName,
            completedBatches: event.batchIndex - 1,
          });
          setTotalImages(event.batchImageCount);
          setScoredCount(0);
          setEtaSeconds(null);
          setCurrentFilename('');
          setLogLines((prev) => [
            ...prev,
            {
              isMessage: true,
              message: event.totalBatches > 1
                ? `Scoring batch ${event.batchIndex}/${event.totalBatches} ("${event.folderName}", ${event.batchImageCount} images) with ${settings.concurrency} parallel calls...`
                : `Scoring ${event.batchImageCount} images with ${settings.concurrency} parallel calls...`,
              filename: '',
              total: 0,
              tier: '',
            },
          ]);
          break;

        case 'pipeline-batch-complete':
          setBatchProgress((prev) =>
            prev
              ? { ...prev, completedBatches: event.batchIndex }
              : { currentBatch: event.batchIndex, totalBatches: event.totalBatches, currentFolderName: '', completedBatches: event.batchIndex }
          );
          break;

        default:
          break;
      }
    });

    unsubscribeRef.current = unsub;

    try {
      // @ts-expect-error
      await window.electronAPI.startPipeline(settings);
    } catch (err: any) {
      setPipelineError(err.message || 'Failed to start pipeline');
    }
  };

  // ── Session checking on mount ──────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    if (!settings.inputFolder || !settings.outputFolder) {
      setPipelineError("Missing input or output folder. Please go back and select folders.");
      setIsCheckingSession(false);
      return;
    }

    const checkSession = async () => {
      try {
        // @ts-expect-error
        const hasExisting = await window.electronAPI.sessionHasExisting({ outputFolder: settings.outputFolder });
        if (!active) return;
        if (hasExisting) {
          // @ts-expect-error
          const session = await window.electronAPI.sessionLoad({ outputFolder: settings.outputFolder });
          if (!active) return;
          if (session) {
            if (session.status === 'completed') {
              setLoadedSession(session);
              setShowCompletedBanner(true);
              setIsCheckingSession(false);
              return;
            } else if (session.scoredCount > 0) {
              setLoadedSession(session);
              previouslyScoredCountRef.current = session.scoredCount;
              setShowResumeBanner(true);
              setIsCheckingSession(false);
              return;
            }
          }
        }

        setIsCheckingSession(false);
        triggerStart();
      } catch (err) {
        if (!active) return;
        setIsCheckingSession(false);
        triggerStart();
      }
    };

    checkSession();

    return () => {
      active = false;
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [settings]);

  // ── Action handlers for resume banner ──────────────────────────────────────
  const handleViewResults = () => {
    if (loadedSession) {
      onComplete(loadedSession);
    }
  };

  const handleResume = () => {
    setShowResumeBanner(false);
    triggerStart();
  };

  const handleStartFresh = async () => {
    setShowResumeBanner(false);
    try {
      // @ts-expect-error
      await window.electronAPI.sessionClear({ outputFolder: settings.outputFolder });
    } catch (err) {
      console.warn('Failed to clear session:', err);
    }
    triggerStart();
  };

  const handleRetry = () => {
    // Clean up old listener first to avoid stale error events firing on the new run
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Reset states
    setPipelineError(null);
    setErrorRecoverable(false);
    setIsCancelling(false);
    setIsComplete(false);
    setScoredCount(0);
    setEtaSeconds(null);
    setCurrentFilename('');
    setLogLines([]);
    
    // Reset start time and refs
    startedRef.current = false;
    
    // Call triggerStart again
    triggerStart();
  };

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
        {pipelineError ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full bg-white dark:bg-[#161b27] border border-red-500/20 rounded-3xl p-8 shadow-xl flex flex-col items-center text-center space-y-6"
          >
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center text-red-500">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Culling Pipeline Error
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                {pipelineError}
              </p>
            </div>

            <div className="flex gap-4 w-full max-w-sm">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-2xl transition"
              >
                Back to Setup
              </button>
              {errorRecoverable && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-2xl transition shadow-lg shadow-amber-500/20 animate-bounce"
                >
                  Retry
                </button>
              )}
            </div>
          </motion.div>
        ) : isCheckingSession ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Checking session state...</p>
          </div>
        ) : showResumeBanner && loadedSession ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full bg-white dark:bg-[#161b27] border border-amber-500/20 rounded-3xl p-6 shadow-xl space-y-6"
          >
            <div className="flex gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-500 shrink-0">
                <FolderOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Previous Session Found
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {loadedSession.scoredCount} of {loadedSession.totalImages} images already scored in this folder on {new Date(loadedSession.createdAt).toLocaleDateString()}.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-[#0f1117]/50 p-4 rounded-2xl">
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Estimated Remaining Time</span>
                <span className="text-base font-bold text-gray-950 dark:text-gray-50">
                  {(() => {
                    const remainingCount = loadedSession.totalImages - loadedSession.scoredCount;
                    const avgTimePerImage = (loadedSession.elapsedMs ?? 0) / loadedSession.scoredCount;
                    const remainingTimeMs = remainingCount * (avgTimePerImage > 0 ? avgTimePerImage : 5000);
                    const remainingMins = Math.ceil(remainingTimeMs / 60000);
                    return `~${remainingMins} min${remainingMins !== 1 ? 's' : ''}`;
                  })()}
                </span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Estimated Remaining Cost</span>
                <span className="text-base font-bold text-gray-950 dark:text-gray-50">
                  {(() => {
                    const remainingCount = loadedSession.totalImages - loadedSession.scoredCount;
                    const estCost = estimateCost(settings.provider, remainingCount * 800, remainingCount * 200);
                    return estCost > 0 ? `$${estCost.toFixed(4)}` : 'Free (Local)';
                  })()}
                </span>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={handleStartFresh}
                className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-2xl transition"
              >
                Start Fresh
              </button>
              <button
                type="button"
                onClick={handleResume}
                className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-2xl transition shadow-lg shadow-amber-500/20"
              >
                Resume Run
              </button>
            </div>
          </motion.div>
        ) : showCompletedBanner && loadedSession ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full bg-white dark:bg-[#161b27] border border-emerald-500/20 rounded-3xl p-6 shadow-xl flex flex-col items-center text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                All Images Already Scored
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                All {loadedSession.totalImages} images in this folder were already successfully culled in a previous session.
              </p>
            </div>
            <div className="flex gap-4 w-full max-w-sm pt-2">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-2xl transition"
              >
                Back to Setup
              </button>
              <button
                type="button"
                onClick={handleViewResults}
                className="flex-1 py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-2xl transition shadow-lg shadow-emerald-500/20"
              >
                View Results
              </button>
            </div>
          </motion.div>
        ) : (
          <>
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
                      {formatEta(etaSeconds)}
                    </p>
                  )}
                  {!isComplete && (
                    <div className="mt-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-[#1e2535] shadow-sm">
                        Scoring with {settings.concurrency} parallel API calls
                      </span>
                    </div>
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
                  <div title={`Input: ${totalInputTokens.toLocaleString()} tokens\nOutput: ${totalOutputTokens.toLocaleString()} tokens`}>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {Math.round((totalInputTokens + totalOutputTokens) / 1000)}k
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Tokens</p>
                  </div>
                  <div className="w-px bg-gray-200 dark:bg-[#1e2535]" />
                  <div title={`Input: ${totalInputTokens.toLocaleString()} tokens\nOutput: ${totalOutputTokens.toLocaleString()} tokens`}>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      ${estimatedCost >= 0.01 || estimatedCost === 0 ? estimatedCost.toFixed(2) : estimatedCost.toFixed(4)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Est. Cost</p>
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

            {/* Zero‑target info banner (only when numImagesToSelect === 0) */}
            {shortfallSummary?.requestedCount === 0 && (
              <div className="rounded-xl border border-blue-400/40 bg-blue-50/80 dark:bg-blue-900/20 px-6 py-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  No target quantity set → exported all S‑tier images ({shortfallSummary.finalSelectedCount} total).
                </p>
              </div>
            )}

            {/* Zero faces detected info banner (16.6) */}
            {isComplete && zeroFacesDetected && (
              <div className="rounded-xl border border-blue-400/40 bg-blue-50/80 dark:bg-blue-900/20 px-6 py-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  No faces detected. Consider setting Face &amp; Eyes weight to 0% for this genre.
                </p>
              </div>
            )}

            {/* Shortfall banner (if applicable) */}
            {renderShortfallBanner()}

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
                {logLines.length === 0 && (
                  <p className="text-gray-400 dark:text-gray-600">— awaiting pipeline —</p>
                )}
                {logLines.map((line, idx) => {
                  if (line.isMessage) {
                    return (
                      <div key={idx} className="flex items-center gap-3 text-gray-500 dark:text-gray-400 italic py-0.5 border-b border-gray-100 dark:border-[#1e2535] last:border-0">
                        <span className="w-8 shrink-0 text-left">—</span>
                        <span className="truncate flex-1">{line.message}</span>
                      </div>
                    );
                  }
                  return (
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
                  );
                })}
              </div>
            </div>
          </>
        )}
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

function formatEta(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds}s remaining`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) {
    return `~${mins} min remaining`;
  }
  return `~${mins} min ${secs}s remaining`;
}