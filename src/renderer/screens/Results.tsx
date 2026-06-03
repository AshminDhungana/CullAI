import { motion } from 'framer-motion';
import { ChevronLeft, Star, TrendingDown, Slash, Download, ImageIcon } from 'lucide-react';
import type { AppSettings } from '../../shared/types';

interface ResultsScreenProps {
  settings: AppSettings;
  onBack: () => void;
}

type ResultTab = 'S' | 'A' | 'B' | 'Rejected';

const TABS: { id: ResultTab; label: string; color: string }[] = [
  { id: 'S',        label: 'S — Best',     color: 'text-amber-500' },
  { id: 'A',        label: 'A — Keepers',  color: 'text-emerald-500' },
  { id: 'B',        label: 'B — Maybe',    color: 'text-blue-400' },
  { id: 'Rejected', label: 'Rejected',     color: 'text-red-400' },
];

export default function ResultsScreen({ settings, onBack }: ResultsScreenProps) {
  // Phase 12 replaces this with real result data from the pipeline.
  const activeTab: ResultTab = 'S';

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-[#0f1117] dark:to-[#0a0c10]"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 w-full border-b border-gray-200 dark:border-[#1e2535] shadow-sm backdrop-blur-md bg-gray-50/90 dark:bg-[#0f1117]/90">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex justify-between items-center pt-5 pb-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
                CullAI
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                Culling results
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Export — disabled until Phase 12/13 */}
              <button
                disabled
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] text-gray-400 dark:text-gray-600 text-sm font-medium cursor-not-allowed opacity-50"
                title="Export wires in Phase 13"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <button
                onClick={onBack}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a1f2e] transition-all text-sm font-medium"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Setup
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 pb-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                disabled // Phase 12 enables tab switching
                className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-amber-500 text-amber-500 bg-amber-50/60 dark:bg-amber-900/10'
                    : 'border-transparent text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'
                }`}
              >
                <span className={activeTab === tab.id ? tab.color : ''}>{tab.label}</span>
                {/* count badge — Phase 12 fills these */}
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#1e2535] text-gray-400 dark:text-gray-600">
                  0
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* Summary stat pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatPill icon={Star}         label="Best"     value="0" accent="amber" />
          <StatPill icon={TrendingDown} label="Keepers"  value="0" accent="emerald" />
          <StatPill icon={Slash}        label="Maybe"    value="0" accent="blue" />
          <StatPill icon={ImageIcon}    label="Rejected" value="0" accent="red" />
        </div>

        {/* Empty gallery grid */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-[#1e2535]">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Gallery · S-tier
            </h2>
          </div>

          {/* Empty state */}
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-[#1e2535] flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-500 dark:text-gray-400">
                No results yet
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-600 mt-1">
                Results appear here after processing completes — Phase 12 builds the gallery.
              </p>
            </div>
          </div>
        </div>

        {/* Folder info */}
        <div className="rounded-xl border border-gray-100 dark:border-[#1e2535] bg-gray-50 dark:bg-[#0f1117] px-5 py-4 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-500">
          <ImageIcon className="w-4 h-4 shrink-0 text-amber-500" />
          <span className="truncate">
            <span className="font-medium text-gray-700 dark:text-gray-300">Input: </span>
            {settings.inputFolder || '—'}
          </span>
          <span className="hidden sm:inline text-gray-300 dark:text-gray-700">·</span>
          <span className="hidden sm:block truncate">
            <span className="font-medium text-gray-700 dark:text-gray-300">Output: </span>
            {settings.outputFolder || '—'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Tiny helper ────────────────────────────────────────────────────────────────
function StatPill({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent: 'amber' | 'emerald' | 'blue' | 'red';
}) {
  const iconColor: Record<string, string> = {
    amber:   'text-amber-500',
    emerald: 'text-emerald-500',
    blue:    'text-blue-400',
    red:     'text-red-400',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#1e2535] bg-white dark:bg-[#161b27] px-4 py-3 flex items-center gap-3">
      <Icon className={`w-5 h-5 shrink-0 ${iconColor[accent]}`} />
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}