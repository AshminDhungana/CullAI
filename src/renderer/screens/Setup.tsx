import React, { useEffect, useState, useCallback } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import {
  FolderOpen,
  Save,
  Sliders,
  Key,
  Eye,
  EyeOff,
  Cpu,
  FileJson,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Info,
  Layers,
  Zap,
  Download,
  ChevronRight,
  ChevronLeft,
  Check,
  Image,
  Settings,
  Send,
  Loader2,
} from 'lucide-react';
import GenrePresetSelector from '../components/GenrePresetSelector';
import ScoringWeightsPanel from '../components/ScoringWeightsPanel';
import type { AppSettings, AIProvider } from '../../shared/types';
import { defaultAppSettings } from '../../shared/types';
import { GENRE_PRESETS } from '../../shared/genre-presets';

// -----------------------------------------------------------------------------
// Provider defaults
// -----------------------------------------------------------------------------
const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; defaultModel: string }> = {
  claude: { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
  ollama: { baseUrl: 'http://localhost:11434/v1', defaultModel: 'llava' },
  custom: { baseUrl: '', defaultModel: '' },
};

// -----------------------------------------------------------------------------
// Zod validation schema
// -----------------------------------------------------------------------------
const setupSchema = z.object({
  inputFolder: z.string().min(1, 'Input folder is required'),
  outputFolder: z.string().min(1, 'Output folder is required'),
  numImagesToSelect: z.number().min(0).max(999),
  genre: z.enum(['general', 'wedding', 'portrait', 'sports', 'landscape', 'street', 'event']),
  weights: z.object({
    quality: z.number().min(0).max(100),
    aesthetic: z.number().min(0).max(100),
    composition: z.number().min(0).max(100),
    sharpness: z.number().min(0).max(100),
    exposure: z.number().min(0).max(100),
    faceEyes: z.number().min(0).max(100),
  }),
  preferenceText: z.string().optional(),
  provider: z.enum(['claude', 'openai', 'gemini', 'ollama', 'custom']),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().min(1, 'Model name is required'),
  concurrency: z.number().min(1).max(10),
  enableXmpExport: z.boolean(),
  lightroomMode: z.enum(['rateInPlace', 'copyToOutput']),
  dryRun: z.boolean(),
  shortfallStrategy: z.enum(['stop', 'fillWithB', 'fillWithRejected']),
  extensionFilter: z.array(z.string()).optional(),
  prefixFilter: z.array(z.string()).optional(),
  disableDuplicateGrouping: z.boolean().optional(),
  duplicateThreshold: z.number().optional(),
  maxFacesPerImage: z.number().optional(),
});

type SetupFormValues = z.infer<typeof setupSchema>;

// -----------------------------------------------------------------------------
// Helper: debounced save
// -----------------------------------------------------------------------------
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: NodeJS.Timeout;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

// -----------------------------------------------------------------------------
// Wizard steps
// -----------------------------------------------------------------------------
type WizardStep = 0 | 1 | 2 | 3;

const STEPS = [
  { id: 0, label: 'Project', icon: FolderOpen, description: 'Folders & output' },
  { id: 1, label: 'Scoring', icon: Sliders, description: 'Genre & weights' },
  { id: 2, label: 'AI Engine', icon: Cpu, description: 'Provider & model' },
  { id: 3, label: 'Review', icon: CheckCircle2, description: 'Confirm & start' },
] as const;

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------
interface SetupScreenProps {
  onStart: (settings: AppSettings) => void;
  themeToggle: React.ReactNode;
}

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------
export default function SetupScreen({ onStart, themeToggle }: SetupScreenProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [folderScanCount, setFolderScanCount] = useState<number | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [step, setStep] = useState<WizardStep>(0);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    trigger,
    formState: { errors, isValid, isDirty },
    reset,
  } = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      ...defaultAppSettings(),
      weights: { ...defaultAppSettings().weights },
      extensionFilter: [],
      prefixFilter: [],
      disableDuplicateGrouping: false,
      duplicateThreshold: 10,
      maxFacesPerImage: 0,
    },
    mode: 'onChange',
  });

  const watchedProvider = useWatch({ control, name: 'provider' });
  const watchedInputFolder = useWatch({ control, name: 'inputFolder' });
  const watchedGenre = useWatch({ control, name: 'genre' });
  const watchedWeights = useWatch({ control, name: 'weights' });
  const watchedNumImages = useWatch({ control, name: 'numImagesToSelect' });
  const watchedDryRun = useWatch({ control, name: 'dryRun' });

  // Load persisted settings
  useEffect(() => {
    async function load() {
      try {
        // @ts-expect-error - electronAPI
        const stored = await window.electronAPI.getSettings();
        if (stored) {
          reset({
            ...defaultAppSettings(),
            ...stored,
            weights: { ...defaultAppSettings().weights, ...stored.weights },
            extensionFilter: stored.extensionFilter ? Array.from(stored.extensionFilter) : [],
            prefixFilter: stored.prefixFilter || [],
          });
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [reset]);

  // Auto-save debounced
  const saveSettings = useCallback(
    debounce(async (values: SetupFormValues) => {
      try {
        const toStore = {
          ...values,
          extensionFilter: values.extensionFilter || [],
          prefixFilter: values.prefixFilter || [],
        };
        // @ts-expect-error
        await window.electronAPI.saveSettings(toStore);
      } catch (err) {
        console.error('Failed to save settings', err);
      }
    }, 500),
    []
  );

  // Trigger auto-save on any change
  useEffect(() => {
    if (!isLoading && isDirty) {
      const subscription = watch((values) => {
        if (values) saveSettings(values as SetupFormValues);
      });
      return () => subscription.unsubscribe();
    }
  }, [watch, isLoading, isDirty, saveSettings]);

  // When genre changes, update weights
  useEffect(() => {
    if (watchedGenre) {
      const newWeights = GENRE_PRESETS[watchedGenre];
      setValue('weights', newWeights, { shouldDirty: true });
    }
  }, [watchedGenre, setValue]);

  // When provider changes, update baseUrl and model defaults
  useEffect(() => {
    if (watchedProvider) {
      const defaults = PROVIDER_DEFAULTS[watchedProvider];
      setValue('baseUrl', defaults.baseUrl, { shouldDirty: true });
      setValue('model', defaults.defaultModel, { shouldDirty: true });
    }
  }, [watchedProvider, setValue]);

  // Validate input folder
  const validateInputFolder = async (folder: string) => {
    if (!folder) return false;
    try {
      // @ts-expect-error
      const exists = await window.electronAPI.folderExists(folder);
      if (!exists) return false;
      // @ts-expect-error
      const scan = await window.electronAPI.scanFolder(folder, [], []);
      setFolderScanCount(scan.count);
      return scan.count > 0;
    } catch {
      return false;
    }
  };

  const handleBrowseInput = async () => {
    // @ts-expect-error
    const folder = await window.electronAPI.openFolderDialog();
    if (folder) {
      setValue('inputFolder', folder, { shouldDirty: true, shouldValidate: true });
      await validateInputFolder(folder);
    }
  };

  const handleBrowseOutput = async () => {
    // @ts-expect-error
    const folder = await window.electronAPI.openFolderDialog();
    if (folder) {
      setValue('outputFolder', folder, { shouldDirty: true, shouldValidate: true });
    }
  };

  const testConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    try {
      // @ts-expect-error
      const result = await window.electronAPI.testConnection?.({
        provider: watchedProvider,
        baseUrl: watch('baseUrl'),
        apiKey: watch('apiKey'),
        model: watch('model'),
      });
      if (result?.success) {
        setConnectionStatus('success');
      } else {
        setConnectionStatus('error');
        setConnectionError(result?.error || 'Connection failed');
      }
    } catch (err) {
      setConnectionStatus('error');
      setConnectionError('Unable to test connection');
    }
  };

  const onSubmit = async (data: SetupFormValues) => {
    setIsStarting(true);
    const inputValid = await validateInputFolder(data.inputFolder);
    if (!inputValid) {
      setIsStarting(false);
      setStep(0);
      return;
    }
    const fullSettings: AppSettings = {
      ...data,
      extensionFilter: new Set(data.extensionFilter || []),
      prefixFilter: data.prefixFilter || [],
      prefixCaseInsensitive: true,
      referenceImage: null,
      disableDuplicateGrouping: data.disableDuplicateGrouping || false,
      duplicateThreshold: data.duplicateThreshold || 10,
      maxFacesPerImage: data.maxFacesPerImage || 0,
      enableAutoTagging: false,
      tagTopPercent: 20,
      rawCacheMaxSizeGb: 5,
      rawCacheMaxAgeDays: 30,
      disableRawCache: false,
      activeProfileId: null,
    };
    onStart(fullSettings);
  };

  const canProceed = async () => {
    const fields: Record<WizardStep, string[]> = {
      0: ['inputFolder', 'outputFolder'],
      1: ['genre'],
      2: ['provider', 'model'],
      3: [],
    };
    const result = await trigger(fields[step] as any);
    return result;
  };

  const handleNext = async () => {
    const valid = await canProceed();
    if (valid && step < 3) setStep((s) => (s + 1) as WizardStep);
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => (s - 1) as WizardStep);
  };

  // Step validation status
  const getStepStatus = (s: number): 'complete' | 'current' | 'pending' => {
    if (s < step) return 'complete';
    if (s === step) return 'current';
    return 'pending';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors">
        <div className="animate-pulse text-amber-600 dark:text-amber-500 text-xl">Loading configuration…</div>
      </div>
    );
  }

  // Shared input classes
  const inputBaseClass =
    'w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none transition-all duration-150';
  const inputErrorClass = 'border-red-300 dark:border-red-500/50 focus:ring-2 focus:ring-red-500/30 focus:border-red-500';
  const inputNormalClass = 'border-gray-300 dark:border-[#1e2535] focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-500/70';

  // Step content components
  const renderStep0 = () => (
    <div className="space-y-6">
      {/* Project & Folders Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] shadow-sm overflow-hidden transition-colors"
      >
        <div className="border-b border-gray-200 dark:border-[#1e2535] px-6 py-4 flex items-center gap-2 transition-colors">
          <FolderOpen className="w-5 h-5 text-amber-500" />
          <h2 className="text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">Project & Folders</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Input folder</label>
            <div className="flex gap-2">
              <Controller
                name="inputFolder"
                control={control}
                render={({ field }) => (
                  <input
                    {...field}
                    type="text"
                    readOnly
                    className={`${inputBaseClass} ${errors.inputFolder ? inputErrorClass : inputNormalClass} flex-1`}
                    placeholder="/path/to/photos"
                  />
                )}
              />
              <button
                type="button"
                onClick={handleBrowseInput}
                className="px-4 py-2.5 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1a1f2e] transition flex items-center gap-2"
              >
                <FolderOpen className="w-4 h-4" />
                Browse
              </button>
            </div>
            {errors.inputFolder && (
              <p className="text-red-500 dark:text-red-400 text-xs mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {errors.inputFolder.message}
              </p>
            )}
            {folderScanCount !== null && !errors.inputFolder && watchedInputFolder && (
              <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {folderScanCount} supported images found
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Output folder</label>
            <div className="flex gap-2">
              <Controller
                name="outputFolder"
                control={control}
                render={({ field }) => (
                  <input
                    {...field}
                    type="text"
                    readOnly
                    className={`${inputBaseClass} ${errors.outputFolder ? inputErrorClass : inputNormalClass} flex-1`}
                  />
                )}
              />
              <button
                type="button"
                onClick={handleBrowseOutput}
                className="px-4 py-2.5 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1a1f2e] transition flex items-center gap-2"
              >
                <FolderOpen className="w-4 h-4" />
                Browse
              </button>
            </div>
            {errors.outputFolder && (
              <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.outputFolder.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Number of images to select
              <span className="text-gray-400 dark:text-gray-600 ml-2 text-[10px]">(0 = all S-tier)</span>
            </label>
            <Controller
              name="numImagesToSelect"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      {...field}
                      type="number"
                      min={0}
                      max={999}
                      step={1}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                      className="w-28 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                    <span className="text-gray-500 dark:text-gray-500 text-xs">images</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={999}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <p className="text-gray-400 dark:text-gray-600 text-[10px]">
                    {field.value === 0
                      ? 'Will output all S‑tier images (no limit)'
                      : `Will select ${field.value} best images`}
                  </p>
                </div>
              )}
            />
          </div>
        </div>
      </motion.div>

      {/* Shortfall Strategy */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-6 transition-colors"
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h2 className="text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">When output falls short</h2>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <Controller
              name="shortfallStrategy"
              control={control}
              render={({ field }) => (
                <input
                  type="radio"
                  value="stop"
                  checked={field.value === 'stop'}
                  onChange={() => field.onChange('stop')}
                  className="accent-amber-500"
                />
              )}
            />
            Stop (output only S+A)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Controller
              name="shortfallStrategy"
              control={control}
              render={({ field }) => (
                <input
                  type="radio"
                  value="fillWithB"
                  checked={field.value === 'fillWithB'}
                  onChange={() => field.onChange('fillWithB')}
                />
              )}
            />
            Fill with B‑tier
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Controller
              name="shortfallStrategy"
              control={control}
              render={({ field }) => (
                <input
                  type="radio"
                  value="fillWithRejected"
                  checked={field.value === 'fillWithRejected'}
                  onChange={() => field.onChange('fillWithRejected')}
                />
              )}
            />
            Fill with Rejected if needed
          </label>
        </div>
      </motion.div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-6">
      {/* Genre & Weights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Controller
          name="genre"
          control={control}
          render={({ field }) => <GenrePresetSelector value={field.value} onChange={field.onChange} />}
        />
      </motion.div>

      {/* Style Profile Selector (Stub for Phase 2.5) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-6 transition-colors"
      >
        <div className="flex items-center gap-2 mb-3">
          <Save className="w-5 h-5 text-amber-500" />
          <h2 className="text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">Style Profile</h2>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="flex-1 px-4 py-2 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            disabled
          >
            <option>No profiles yet</option>
          </select>
          <button
            type="button"
            disabled
            className="px-4 py-2 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-sm text-gray-500 cursor-not-allowed flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Create New
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          Pro feature – save and load scoring presets
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <Controller
          name="weights"
          control={control}
          render={({ field }) => <ScoringWeightsPanel weights={field.value} onChange={field.onChange} />}
        />
      </motion.div>

      {/* Style Preference */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-6 transition-colors"
      >
        <label className="block text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
          <Info className="w-4 h-4" />
          Style preference (optional)
        </label>
        <Controller
          name="preferenceText"
          control={control}
          render={({ field }) => (
            <textarea
              {...field}
              rows={3}
              placeholder="e.g. sharp, well-lit portraits with natural light, candid moments"
              className="w-full bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
            />
          )}
        />
      </motion.div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      {/* AI Provider Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] overflow-hidden transition-colors"
      >
        <div className="border-b border-gray-200 dark:border-[#1e2535] px-6 py-4 flex items-center gap-2 transition-colors">
          <Cpu className="w-5 h-5 text-amber-500" />
          <h2 className="text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">AI Provider</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Provider</label>
            <Controller
              name="provider"
              control={control}
              render={({ field }) => (
                <select
                  {...field}
                  className="w-full bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                >
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="ollama">Ollama (local)</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                </select>
              )}
            />
          </div>

          <AnimatePresence>
            {watchedProvider !== 'ollama' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key</label>
                <div className="flex gap-2">
                  <Controller
                    name="apiKey"
                    control={control}
                    render={({ field }) => (
                      <input
                        {...field}
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="sk-..."
                        className={`${inputBaseClass} ${inputNormalClass} flex-1`}
                      />
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="px-3 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1a1f2e] transition"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {(watchedProvider === 'ollama' || watchedProvider === 'custom') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Base URL</label>
              <Controller
                name="baseUrl"
                control={control}
                render={({ field }) => (
                  <input
                    {...field}
                    type="text"
                    className={`${inputBaseClass} ${inputNormalClass} w-full`}
                    placeholder={watchedProvider === 'ollama' ? 'http://localhost:11434/v1' : 'https://your-endpoint/v1'}
                  />
                )}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Model name</label>
            <Controller
              name="model"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  type="text"
                  className={`${inputBaseClass} ${errors.model ? inputErrorClass : inputNormalClass} w-full`}
                />
              )}
            />
            {errors.model && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.model.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Concurrency (parallel API calls)</label>
            <Controller
              name="concurrency"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  type="number"
                  min={1}
                  max={10}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                  className="w-24 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              )}
            />
          </div>

          {/* Test Connection */}
          <div className="pt-2 border-t border-gray-200 dark:border-[#1e2535] transition-colors">
            <button
              type="button"
              onClick={testConnection}
              disabled={connectionStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1a1f2e] transition disabled:opacity-50"
            >
              {connectionStatus === 'testing' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : connectionStatus === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {connectionStatus === 'testing' ? 'Testing...' : connectionStatus === 'success' ? 'Connected' : connectionStatus === 'error' ? 'Retry Connection' : 'Test Connection'}
            </button>
            {connectionStatus === 'success' && (
              <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-2 flex items-center gap-1">
                <Check className="w-3 h-3" /> API key validated successfully
              </p>
            )}
            {connectionStatus === 'error' && (
              <p className="text-red-500 dark:text-red-400 text-xs mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {connectionError}
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );

  const renderStep3 = () => {
    const totalWeight = Object.values(watchedWeights || {}).reduce((a, b) => a + b, 0);
    const estimatedCost = watchedDryRun ? 'Calculating...' : '~$0.42'; // Placeholder

    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-6 transition-colors"
        >
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">Review & Confirm</h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-50 dark:bg-[#0f1117] rounded-lg p-3 border border-gray-200 dark:border-[#1e2535] transition-colors">
                <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Input</p>
                <p className="text-gray-700 dark:text-gray-300 truncate">{watchedInputFolder || 'Not set'}</p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">{folderScanCount ?? '?'} images</p>
              </div>
              <div className="bg-gray-50 dark:bg-[#0f1117] rounded-lg p-3 border border-gray-200 dark:border-[#1e2535] transition-colors">
                <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Output</p>
                <p className="text-gray-700 dark:text-gray-300 truncate">{watch('outputFolder') || 'Not set'}</p>
              </div>
              <div className="bg-gray-50 dark:bg-[#0f1117] rounded-lg p-3 border border-gray-200 dark:border-[#1e2535] transition-colors">
                <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">Genre</p>
                <p className="text-gray-700 dark:text-gray-300 capitalize">{watchedGenre}</p>
              </div>
              <div className="bg-gray-50 dark:bg-[#0f1117] rounded-lg p-3 border border-gray-200 dark:border-[#1e2535] transition-colors">
                <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">AI Provider</p>
                <p className="text-gray-700 dark:text-gray-300 capitalize">{watchedProvider}</p>
                <p className="text-gray-400 dark:text-gray-500 text-xs truncate">{watch('model')}</p>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-[#0f1117] rounded-lg p-3 border border-gray-200 dark:border-[#1e2535] transition-colors">
              <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider mb-2">Scoring Weights</p>
              <div className="flex flex-wrap gap-2">
                {watchedWeights && Object.entries(watchedWeights).map(([key, val]) => (
                  <span key={key} className="text-xs px-2 py-1 bg-white dark:bg-[#161b27] border border-gray-200 dark:border-[#1e2535] rounded text-gray-600 dark:text-gray-400 transition-colors">
                    {key}: <span className="text-amber-600 dark:text-amber-400 font-medium">{val}%</span>
                  </span>
                ))}
                <span className={`text-xs px-2 py-1 rounded font-medium ${totalWeight === 100 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30'}`}>
                  Total: {totalWeight}%
                </span>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg p-4 transition-colors">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Ready to start</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    {watchedNumImages === 0
                      ? 'Will output all S‑tier images (no limit)'
                      : `Will select top ${watchedNumImages} images from ${folderScanCount ?? '?'} total`}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                    Estimated cost: {estimatedCost} · Strategy: {watch('shortfallStrategy')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Export Options */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-6 transition-colors"
        >
          <div className="flex items-center gap-2 mb-4">
            <Download className="w-5 h-5 text-amber-500" />
            <h2 className="text-sm font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">Export & Integration</h2>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <Controller
                name="enableXmpExport"
                control={control}
                render={({ field }) => (
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="accent-amber-500"
                  />
                )}
              />
              Write XMP sidecars (Lightroom/Capture One)
            </label>

            <div>
              <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Lightroom mode</span>
              <div className="flex gap-4 text-sm text-gray-700 dark:text-gray-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Controller
                    name="lightroomMode"
                    control={control}
                    render={({ field }) => (
                      <input
                        type="radio"
                        value="rateInPlace"
                        checked={field.value === 'rateInPlace'}
                        onChange={() => field.onChange('rateInPlace')}
                      />
                    )}
                  />
                  Rate originals in‑place
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Controller
                    name="lightroomMode"
                    control={control}
                    render={({ field }) => (
                      <input
                        type="radio"
                        value="copyToOutput"
                        checked={field.value === 'copyToOutput'}
                        onChange={() => field.onChange('copyToOutput')}
                      />
                    )}
                  />
                  Copy keepers to output folder
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <Controller
                name="dryRun"
                control={control}
                render={({ field }) => (
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="accent-amber-500"
                  />
                )}
              />
              Dry‑run (estimate token cost before processing)
            </label>
          </div>
        </motion.div>

        {/* Start Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <button
            onClick={handleSubmit(onSubmit)}
            disabled={!isValid || isStarting || totalWeight !== 100}
            className="w-full px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 dark:disabled:text-gray-500 text-white dark:text-black font-bold rounded-xl shadow-lg shadow-amber-900/20 dark:shadow-amber-900/30 transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
          >
            {isStarting ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white dark:border-black border-t-transparent rounded-full" />
                Starting…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Start Culling
              </>
            )}
          </button>
          {totalWeight !== 100 && (
            <p className="text-red-500 dark:text-red-400 text-xs mt-2 text-center">Scoring weights must total 100%</p>
          )}
        </motion.div>
      </div>
    );
  };

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Sticky Header with Stepper */}
        <div className="sticky top-0 z-10 backdrop-blur-md bg-white/80 dark:bg-[#0f1117]/80 border-b border-gray-200 dark:border-[#1e2535] py-4 px-4 -mx-4 rounded-b-xl mb-8 transition-colors">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-amber-600 dark:from-amber-400 dark:to-amber-500 bg-clip-text text-transparent">
                CullAI
              </h1>
              <p className="text-gray-500 dark:text-gray-500 text-sm mt-0.5">Configure your AI culling pipeline</p>
            </div>
            <div className="flex items-center gap-3">
              {themeToggle}
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, idx) => {
              const status = getStepStatus(s.id);
              const Icon = s.icon;
              return (
                <React.Fragment key={s.id}>
                  <button
                    onClick={() => status === 'complete' && setStep(s.id as WizardStep)}
                    disabled={status === 'pending'}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      status === 'current'
                        ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                        : status === 'complete'
                        ? 'bg-gray-100 dark:bg-[#1a1f2e] text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-[#1e2535] hover:bg-gray-200 dark:hover:bg-[#252b3b]'
                        : 'bg-gray-50 dark:bg-[#0f1117] text-gray-400 dark:text-gray-600 border border-gray-200 dark:border-[#1e2535] cursor-not-allowed'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{s.label}</span>
                    {status === 'complete' && <Check className="w-3 h-3 text-emerald-500" />}
                  </button>
                  {idx < STEPS.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-700" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <form className="space-y-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {step === 0 && renderStep0()}
              {step === 1 && renderStep1()}
              {step === 2 && renderStep2()}
              {step === 3 && renderStep3()}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-[#1e2535] transition-colors">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 0}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1a1f2e] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            {step < 3 && (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg text-sm transition"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}