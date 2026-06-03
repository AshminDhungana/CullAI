import { motion } from 'framer-motion';
import { XCircle, Cpu, FolderOpen, ImageIcon, Settings2 } from 'lucide-react';
import type { AppSettings } from '../../shared/types';

interface ProcessingScreenProps {
  settings: AppSettings;
  onCancel: () => void;
  onComplete: () => void; // dev shortcut — Phase 10 will drive this from the pipeline
}

export default function ProcessingScreen({ settings, onCancel, onComplete }: ProcessingScreenProps) {
  const providerLabel: Record<string, string> = {
    claude: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    ollama: 'Ollama',
    custom: 'Custom',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-[#0f1117] dark:to-[#0a0c10]"
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 w-full border-b border-gray-200 dark:border-[#1e2535] shadow-sm backdrop-blur-md bg-gray-50/90 dark:bg-[#0f1117]/90">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex justify-between items-center pt-5 pb-5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
                CullAI
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                Processing your photos…
              </p>
            </div>
            <button
              onClick={onCancel}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a1f2e] hover:border-red-400/50 hover:text-red-500 dark:hover:text-red-400 transition-all text-sm font-medium"
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* Progress card */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] p-8">
          <div className="flex flex-col items-center text-center gap-5">
            {/* Animated ring placeholder */}
            <div className="relative w-24 h-24">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                {/* Track */}
                <circle
                  cx="48" cy="48" r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-gray-200 dark:text-[#1e2535]"
                />
                {/* Progress arc — static at 0 for Phase 2.9; Phase 10 drives this */}
                <circle
                  cx="48" cy="48" r="40"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 40}`}
                  strokeDashoffset={`${2 * Math.PI * 40}`}
                  className="text-amber-500 transition-all duration-700"
                  stroke="currentColor"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Cpu className="w-8 h-8 text-amber-500 animate-pulse" />
              </div>
            </div>

            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">0%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Waiting to start — pipeline wires in Phase 10
              </p>
            </div>

            {/* Stats row */}
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">0</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Processed</p>
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
                <p className="text-lg font-semibold text-gray-900 dark:text-white">0</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Errors</p>
              </div>
            </div>
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

        {/* Log panel — empty for Phase 2.9, Phase 10 streams lines here */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-[#1e2535] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Log
            </h2>
            <span className="text-xs text-gray-400 dark:text-gray-600">Phase 10 streams output here</span>
          </div>
          <div className="h-40 overflow-y-auto px-6 py-4 font-mono text-xs text-gray-400 dark:text-gray-600">
            <p>— awaiting pipeline —</p>
          </div>
        </div>

        {/* DEV shortcut — remove or guard with import.meta.env.DEV in Phase 10 */}
        <div className="rounded-xl border border-dashed border-amber-400/40 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-900/10 px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            Dev shortcut — simulate pipeline complete to test Results routing
          </p>
          <button
            onClick={onComplete}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition"
          >
            Simulate Complete →
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Tiny helper ────────────────────────────────────────────────────────────────
function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
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