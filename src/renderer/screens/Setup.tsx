import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  FileImage,
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
  Image as ImageIcon,
  Settings,
  Send,
  Loader2,
  Sparkles,
  Music,
  Camera,
  MapPin,
  Users,
  TrendingUp,
  Globe,
  Star,
  Filter,
} from 'lucide-react';
import ExtensionFilter from '../components/ExtensionFilter';
import PrefixFilter from '../components/PrefixFilter';
import GenrePresetSelector from '../components/GenrePresetSelector';
import ReferenceImageUpload from '../components/ReferenceImageUpload';
import ScoringWeightsPanel from '../components/ScoringWeightsPanel';
import RecentFoldersDropdown from '../components/RecentFoldersDropdown';
import { useRecentFolders } from '../hooks/useRecentFolders';
import type { AppSettings, AIProvider, ReferenceImage } from '../../shared/types';
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
  prefixCaseInsensitive: z.boolean().optional(),
  referenceImage: z.object({
    filename: z.string(),
    base64: z.string(),
  }).nullable().optional(),
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
// Wizard steps (6 steps: welcome, project, scoring, ai, options, review)
// -----------------------------------------------------------------------------
type WizardStep = 'welcome' | 'project' | 'scoring' | 'ai' | 'options' | 'review';

const STEPS: { id: WizardStep; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'welcome', label: 'Welcome', icon: Sparkles, description: 'Get started' },
  { id: 'project', label: 'Project', icon: FolderOpen, description: 'Folders & output' },
  { id: 'scoring', label: 'Scoring', icon: Sliders, description: 'Genre & weights' },
  { id: 'ai', label: 'AI Engine', icon: Cpu, description: 'Provider & model' },
  { id: 'options', label: 'Options', icon: Settings, description: 'Export & run mode' },
  { id: 'review', label: 'Review', icon: CheckCircle2, description: 'Confirm & start' },
];

const STEP_ORDER: WizardStep[] = ['welcome', 'project', 'scoring', 'ai', 'options', 'review'];

// Human-readable labels for enum review display
const SHORTFALL_LABELS: Record<string, string> = {
  stop: 'Stop — output available keepers only',
  fillWithB: 'Fill with B-tier images',
  fillWithRejected: 'Fill with B-tier, then rejected',
};

const LIGHTROOM_MODE_LABELS: Record<string, string> = {
  rateInPlace: 'Rate originals in-place',
  copyToOutput: 'Copy keepers to output folder',
};

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
  const [step, setStep] = useState<WizardStep>('welcome');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');
  const [showAdvancedWeights, setShowAdvancedWeights] = useState(false);
  const [isValidatingStep, setIsValidatingStep] = useState(false);

  // Recent folder history — persisted in electron-store via dedicated IPC channels.
  const { recentInput, recentOutput, addRecentInput, addRecentOutput } = useRecentFolders();

  // Tracks whether the last navigation was forward (+1) or backward (-1).
  // Used to flip the x-axis on step transitions so Back slides right, not left.
  const directionRef = useRef<1 | -1>(1);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    trigger,
    getValues,
    formState: { errors, isValid, isDirty },
    reset,
  } = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      ...defaultAppSettings(),
      weights: { ...defaultAppSettings().weights },
      extensionFilter: [],
      prefixFilter: [],
      prefixCaseInsensitive: true,
      referenceImage: null,
      disableDuplicateGrouping: false,
      duplicateThreshold: 10,
      maxFacesPerImage: 0,
    },
    mode: 'onChange',
  });

  const watchedProvider = useWatch({ control, name: 'provider' });
  const watchedInputFolder = useWatch({ control, name: 'inputFolder' });
  const watchedOutputFolder = useWatch({ control, name: 'outputFolder' });
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
            prefixCaseInsensitive: stored.prefixCaseInsensitive ?? true,
            referenceImage: stored.referenceImage ?? null,
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
          prefixCaseInsensitive: values.prefixCaseInsensitive ?? true,
          referenceImage: values.referenceImage ?? null,
        };
        // @ts-expect-error
        await window.electronAPI.saveSettings(toStore);
      } catch (err) {
        console.error('Failed to save settings', err);
      }
    }, 800),
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

  // When provider changes, update baseUrl and model defaults and reset key visibility
  useEffect(() => {
    if (watchedProvider) {
      const defaults = PROVIDER_DEFAULTS[watchedProvider];
      setValue('baseUrl', defaults.baseUrl, { shouldDirty: true });
      setValue('model', defaults.defaultModel, { shouldDirty: true });
      setShowApiKey(false);
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
    try {
      // @ts-expect-error
      const folder = await window.electronAPI.openFolderDialog();
      if (folder) {
        setValue('inputFolder', folder, { shouldDirty: true, shouldValidate: true });
        await validateInputFolder(folder);
        await addRecentInput(folder);
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  const handleBrowseOutput = async () => {
    try {
      // @ts-expect-error
      const folder = await window.electronAPI.openFolderDialog();
      if (folder) {
        setValue('outputFolder', folder, { shouldDirty: true, shouldValidate: true });
        await addRecentOutput(folder);
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  /**
   * Called when the user picks a path from the "Recent" dropdown on the input
   * card. Fills the field, triggers validation, and moves the path to the top
   * of the recent list (de-duped by the IPC handler).
   */
  const handleSelectRecentInput = async (folder: string) => {
    setValue('inputFolder', folder, { shouldDirty: true, shouldValidate: true });
    await validateInputFolder(folder);
    await addRecentInput(folder);
  };

  /**
   * Called when the user picks a path from the "Recent" dropdown on the output
   * card. Fills the field, triggers validation, and moves the path to the top
   * of the recent list.
   */
  const handleSelectRecentOutput = async (folder: string) => {
    setValue('outputFolder', folder, { shouldDirty: true, shouldValidate: true });
    await addRecentOutput(folder);
  };

  const testConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    try {
      const values = getValues();
      // @ts-expect-error
      const result = await window.electronAPI.testConnection?.({
        provider: values.provider,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        model: values.model,
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
      setStep('project');
      return;
    }
    const fullSettings: AppSettings = {
      ...defaultAppSettings(),
      ...data,
      extensionFilter: data.extensionFilter || [],
      prefixFilter: data.prefixFilter || [],
      prefixCaseInsensitive: data.prefixCaseInsensitive ?? true,
      referenceImage: (data.referenceImage ?? null) as ReferenceImage,
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

  // Step navigation
  const currentIndex = STEP_ORDER.indexOf(step);
  const canGoNext = async () => {
    if (step === 'welcome') return true;
    if (step === 'project') {
      const valid = await trigger(['inputFolder', 'outputFolder']);
      return valid && watchedInputFolder && watchedOutputFolder;
    }
    if (step === 'scoring') return true;
    if (step === 'ai') {
      const valid = await trigger(['provider', 'model']);
      return valid;
    }
    if (step === 'options') return true;
    return true;
  };

  const handleNext = async () => {
    setIsValidatingStep(true);
    try {
      const canProceed = await canGoNext();
      if (canProceed && currentIndex < STEP_ORDER.length - 1) {
        directionRef.current = 1;
        setStep(STEP_ORDER[currentIndex + 1]);
      }
    } finally {
      setIsValidatingStep(false);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      directionRef.current = -1;
      setStep(STEP_ORDER[currentIndex - 1]);
    }
  };

  // Clicking a completed step in the indicator
  const handleStepClick = (targetId: WizardStep) => {
    const targetIdx = STEP_ORDER.indexOf(targetId);
    directionRef.current = targetIdx < currentIndex ? -1 : 1;
    setStep(targetId);
  };

  // Step validation status for indicator
  const getStepStatus = (stepId: WizardStep): 'complete' | 'current' | 'pending' => {
    const idx = STEP_ORDER.indexOf(stepId);
    if (idx < currentIndex) return 'complete';
    if (idx === currentIndex) return 'current';
    return 'pending';
  };

  // ---------------------------------------------------------------------------
  // Render functions for each step
  // ---------------------------------------------------------------------------
  const renderWelcome = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-2xl mx-auto text-center space-y-8"
    >
      <div className="space-y-4">
        <div className="inline-flex p-4 bg-gradient-to-br from-amber-500/10 to-amber-600/10 rounded-full">
          <Sparkles className="w-12 h-12 text-amber-500" />
        </div>
        <h2 className="text-3xl font-bold bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
          Intelligent Photo Selection
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-lg">
          CullAI uses advanced AI to analyze thousands of photos and find the best moments.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
        <div className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-4">
          <Camera className="w-6 h-6 text-amber-500 mb-2" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Analyze</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Process thousands of RAW/JPEG images locally</p>
        </div>
        <div className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-4">
          <Star className="w-6 h-6 text-amber-500 mb-2" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Select</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">AI picks the best shots based on your style</p>
        </div>
        <div className="bg-white dark:bg-[#161b27] rounded-xl border border-gray-200 dark:border-[#1e2535] p-4">
          <Download className="w-6 h-6 text-amber-500 mb-2" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Export</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">XMP sidecars for Lightroom / Capture One</p>
        </div>
      </div>

      <button
        onClick={handleNext}
        className="mt-8 px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-xl shadow-lg shadow-amber-900/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 mx-auto"
      >
        Get Started
        <ChevronRight className="w-4 h-4" />
      </button>
    </motion.div>
  );

  const renderProject = () => (
    // Layout change: expand from narrow max-w-2xl single-column to full max-w-4xl
    // two-column grid so all three controls fit in one viewport without scrolling.
    // Row 1: Photos card (left) + Output card (right) — equal width, same height.
    // Row 2: Image count — full width, compact single-line layout.
    <div className="max-w-4xl mx-auto space-y-4">

      {/* Row 1: Folder pickers side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Input Folder Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] shadow-sm hover:shadow-md transition-all p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
              <FolderOpen className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Photos</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Folder containing your images</p>
            </div>
          </div>
          <Controller
            name="inputFolder"
            control={control}
            render={({ field }) => (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 min-w-0 bg-gray-50 dark:bg-[#0f1117] rounded-lg px-3 py-2.5 font-mono text-sm text-gray-700 dark:text-gray-300 truncate border border-gray-200 dark:border-[#1e2535] min-h-[40px] flex items-center"
                    title={field.value || 'No folder selected'}
                  >
                    <span className={field.value ? '' : 'text-gray-400 dark:text-gray-600'}>
                      {field.value || 'No folder selected'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleBrowseInput}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
                {folderScanCount !== null && field.value && !errors.inputFolder && (
                  <p className={`text-xs mt-2 flex items-center gap-1 ${
                    folderScanCount === 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {folderScanCount === 0 ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    {folderScanCount === 0
                      ? 'No images found in this folder'
                      : `${folderScanCount} images detected`}
                  </p>
                )}
                <RecentFoldersDropdown
                  paths={recentInput}
                  onSelect={handleSelectRecentInput}
                />
              </>
            )}
          />
          {errors.inputFolder && (
            <p className="text-red-500 dark:text-red-400 text-xs mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {errors.inputFolder.message}
            </p>
          )}
        </motion.div>

        {/* Output Folder Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] shadow-sm hover:shadow-md transition-all p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
              <Save className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Output</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Where to save the results</p>
            </div>
          </div>
          <Controller
            name="outputFolder"
            control={control}
            render={({ field }) => (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 min-w-0 bg-gray-50 dark:bg-[#0f1117] rounded-lg px-3 py-2.5 font-mono text-sm text-gray-700 dark:text-gray-300 truncate border border-gray-200 dark:border-[#1e2535] min-h-[40px] flex items-center"
                    title={field.value || 'No folder selected'}
                  >
                    <span className={field.value ? '' : 'text-gray-400 dark:text-gray-600'}>
                      {field.value || 'No folder selected'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleBrowseOutput}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
                {field.value && !errors.outputFolder && (
                  <p className="text-xs mt-2 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    Output folder set
                  </p>
                )}
                <RecentFoldersDropdown
                  paths={recentOutput}
                  onSelect={handleSelectRecentOutput}
                />
              </>
            )}
          />
          {errors.outputFolder && (
            <p className="text-red-500 dark:text-red-400 text-xs mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {errors.outputFolder.message}
            </p>
          )}
        </motion.div>
      </div>

      {/* Row 2: Selection Count — compact horizontal layout */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5"
      >
        <Controller
          name="numImagesToSelect"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-6">
              {/* Label + number input — fixed left column */}
              <div className="shrink-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Images to select
                  <span className="text-gray-400 dark:text-gray-600 ml-1.5 text-xs font-normal">(0 = all S-tier)</span>
                </p>
                <div className="flex items-center gap-2">
                  <input
                    {...field}
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                    className="w-20 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                  <span className="text-gray-500 dark:text-gray-500 text-sm">images</span>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px self-stretch bg-gray-200 dark:bg-[#1e2535] shrink-0" />

              {/* Slider — takes up remaining space */}
              <div className="flex-1 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={999}
                  step={1}
                  value={field.value}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <p className="text-gray-400 dark:text-gray-600 text-xs mt-1.5">
                  {field.value === 0
                    ? 'Will output all S‑tier images (no limit)'
                    : `Will select the top ${field.value} best images`}
                </p>
              </div>
            </div>
          )}
        />
      </motion.div>

      {/* Row 3: Extension Filter — only visible once a folder is chosen */}
      {watchedInputFolder && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] shadow-sm p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
              <FileImage className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">File Type Filter</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose which formats to include in this culling run
              </p>
            </div>
          </div>
          <Controller
            name="extensionFilter"
            control={control}
            render={({ field }) => (
              <ExtensionFilter
                inputFolder={watchedInputFolder}
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
        </motion.div>
      )}

      {/* Row 4: Prefix Filter — only visible once a folder is chosen */}
      {watchedInputFolder && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] shadow-sm p-5"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
              <Filter className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Filename Prefix Filter</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Only include files starting with specific prefixes
              </p>
            </div>
          </div>
          <Controller
            name="prefixFilter"
            control={control}
            render={({ field }) => (
              <Controller
                name="prefixCaseInsensitive"
                control={control}
                render={({ field: ciField }) => (
                  <PrefixFilter
                    inputFolder={watchedInputFolder}
                    value={field.value ?? []}
                    onChange={field.onChange}
                    caseInsensitive={ciField.value ?? true}
                    onCaseInsensitiveChange={ciField.onChange}
                  />
                )}
              />
            )}
          />
        </motion.div>
      )}
    </div>
  );

  const renderScoring = () => (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Genre Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <Controller
          name="genre"
          control={control}
          render={({ field }) => (
            <>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Choose Genre</label>
              <GenrePresetSelector value={field.value} onChange={field.onChange} />
            </>
          )}
        />
      </motion.div>

      {/* Customize Button */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="text-center"
      >
        <button
          type="button"
          onClick={() => setShowAdvancedWeights(!showAdvancedWeights)}
          className="text-sm text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 mx-auto"
        >
          {showAdvancedWeights ? 'Hide' : 'Customize Advanced Scoring'}
          <Sliders className="w-3 h-3" />
        </button>
      </motion.div>

      {/* Advanced Weights Panel (collapsible) */}
      <AnimatePresence>
        {showAdvancedWeights && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Controller
              name="weights"
              control={control}
              render={({ field }) => <ScoringWeightsPanel weights={field.value} onChange={field.onChange} />}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Style Preference & Reference Image */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6 space-y-6"
      >
        {/* Section header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
            <ImageIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Custom Instructions & Reference Image</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Guide the AI with your preferred style</p>
          </div>
        </div>

        {/* Style preference textarea */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-500" />
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
                className="w-full bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
              />
            )}
          />
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100 dark:border-[#1e2535]" />

        {/* Reference Image Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Reference Image (optional)
          </label>
          <Controller
            name="referenceImage"
            control={control}
            render={({ field }) => (
              <ReferenceImageUpload
                value={field.value ?? null}
                onChange={(img) => field.onChange(img)}
              />
            )}
          />
        </div>
      </motion.div>
    </div>
  );

  const renderAI = () => (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Provider selection as cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">AI Engine</label>
        <div className="grid grid-cols-2 gap-3">
          {(['claude', 'openai', 'gemini', 'ollama'] as AIProvider[]).map((prov) => (
            <button
              key={prov}
              type="button"
              onClick={() => setValue('provider', prov, { shouldDirty: true })}
              className={`p-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#161b27] ${
                watchedProvider === prov
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
                  : 'border-gray-200 dark:border-[#1e2535] hover:border-amber-300 dark:hover:border-amber-700'
              }`}
            >
              <div className="font-medium capitalize text-gray-900 dark:text-white">{prov}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {prov === 'claude' && 'Anthropic'}
                {prov === 'openai' && 'GPT-4o / o1'}
                {prov === 'gemini' && 'Google Gemini'}
                {prov === 'ollama' && 'Local (free)'}
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setValue('provider', 'custom', { shouldDirty: true })}
          className={`mt-3 w-full p-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#161b27] ${
            watchedProvider === 'custom'
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
              : 'border-gray-200 dark:border-[#1e2535] hover:border-amber-300 dark:hover:border-amber-700'
          }`}
        >
          <div className="font-medium text-gray-900 dark:text-white">Custom (OpenAI-compatible)</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Bring your own endpoint</div>
        </button>
      </motion.div>

      {/* Provider-specific fields */}
      <AnimatePresence mode="wait">
        <motion.div
          key={watchedProvider}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="space-y-4"
        >
          {watchedProvider !== 'ollama' && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">API Key</label>
              <div className="flex gap-2">
                <Controller
                  name="apiKey"
                  control={control}
                  render={({ field }) => (
                    <input
                      {...field}
                      type={showApiKey ? 'text' : 'password'}
                      placeholder="sk-..."
                      className="flex-1 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
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
            </div>
          )}

          {(watchedProvider === 'ollama' || watchedProvider === 'custom') && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Base URL</label>
              <Controller
                name="baseUrl"
                control={control}
                render={({ field }) => (
                  <input
                    {...field}
                    type="text"
                    className="w-full bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    placeholder={watchedProvider === 'ollama' ? 'http://localhost:11434/v1' : 'https://your-endpoint/v1'}
                  />
                )}
              />
            </div>
          )}

          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Model name</label>
            <Controller
              name="model"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  type="text"
                  className="w-full bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
              )}
            />
            {errors.model && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{errors.model.message}</p>}
          </div>

          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Concurrency (parallel API calls)
            </label>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Higher = faster processing, but may hit API rate limits</p>
            <Controller
              name="concurrency"
              control={control}
              render={({ field }) => (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      {...field}
                      type="number"
                      min={1}
                      max={10}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                      className="w-20 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">calls</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="flex justify-between text-xs text-gray-400 dark:text-gray-600">
                    <span>1 (safe)</span>
                    <span>5 (default)</span>
                    <span>10 (fast)</span>
                  </div>
                </div>
              )}
            />
          </div>

          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
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
              {connectionStatus === 'testing'
                ? 'Testing...'
                : connectionStatus === 'success'
                ? 'Connected'
                : connectionStatus === 'error'
                ? 'Retry Connection'
                : 'Test Connection'}
            </button>
            <div className="min-h-[1.5rem] mt-2">
              {connectionStatus === 'success' && (
                <p className="text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-1">
                  <Check className="w-3 h-3" /> API key validated successfully
                </p>
              )}
              {connectionStatus === 'error' && (
                <p className="text-red-500 dark:text-red-400 text-xs flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {connectionError}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const renderOptions = () => (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Style Profile (stub) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Style Profile</label>
          <button
            type="button"
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
          >
            <Settings className="w-3 h-3" />
            Create New
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Saved preference sets for quick reuse</p>
        <div className="w-full bg-gray-50 dark:bg-[#0f1117] border border-gray-200 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed select-none">
          No profiles yet
        </div>
      </motion.div>

      {/* Dry-run toggle */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <Controller
          name="dryRun"
          control={control}
          render={({ field }) => (
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    field.value
                      ? 'bg-amber-500 border-amber-500'
                      : 'border-gray-300 dark:border-gray-600 group-hover:border-amber-400'
                  }`}
                >
                  {field.value && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">Estimate token cost before processing</span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Runs a dry-run pass to estimate API cost and token usage without making real API calls.
                </p>
              </div>
            </label>
          )}
        />
      </motion.div>

      {/* XMP Export toggle */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <Controller
          name="enableXmpExport"
          control={control}
          render={({ field }) => (
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    field.value
                      ? 'bg-amber-500 border-amber-500'
                      : 'border-gray-300 dark:border-gray-600 group-hover:border-amber-400'
                  }`}
                >
                  {field.value && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">Write Lightroom / Capture One sidecar files</span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Generates .xmp sidecar files with star ratings alongside your images.
                </p>
              </div>
            </label>
          )}
        />
      </motion.div>

      {/* Lightroom integration mode */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Lightroom integration mode</label>
        <Controller
          name="lightroomMode"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              {([
                { value: 'rateInPlace', label: 'Rate originals in-place', desc: 'Stars are written to original files via XMP. No files are copied.' },
                { value: 'copyToOutput', label: 'Copy keepers to output folder', desc: 'Selected images are physically copied to the output folder.' },
              ] as const).map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    field.value === option.value
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                      : 'border-gray-200 dark:border-[#1e2535] hover:border-amber-300 dark:hover:border-amber-700'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                        field.value === option.value
                          ? 'border-amber-500'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {field.value === option.value && (
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                      )}
                    </div>
                  </div>
                  <input
                    type="radio"
                    name="lightroomMode"
                    value={option.value}
                    checked={field.value === option.value}
                    onChange={() => field.onChange(option.value)}
                    className="sr-only"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{option.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        />
      </motion.div>

      {/* Shortfall Strategy */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
      >
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          When output falls short of requested count
        </label>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          What to do if not enough S-tier or A-tier images exist to meet your target.
        </p>
        <Controller
          name="shortfallStrategy"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              {([
                {
                  value: 'stop',
                  label: 'Stop',
                  desc: 'Output only available S + A tier keepers, even if below the target count.',
                },
                {
                  value: 'fillWithB',
                  label: 'Fill with B-tier images',
                  desc: 'Automatically promote the best B-tier images to reach the target.',
                },
                {
                  value: 'fillWithRejected',
                  label: 'Fill with B-tier, then rejected if still short',
                  desc: 'First promotes B-tier, then falls back to the best rejected images.',
                },
              ] as const).map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    field.value === option.value
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                      : 'border-gray-200 dark:border-[#1e2535] hover:border-amber-300 dark:hover:border-amber-700'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                        field.value === option.value
                          ? 'border-amber-500'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {field.value === option.value && (
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                      )}
                    </div>
                  </div>
                  <input
                    type="radio"
                    name="shortfallStrategy"
                    value={option.value}
                    checked={field.value === option.value}
                    onChange={() => field.onChange(option.value)}
                    className="sr-only"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{option.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        />
      </motion.div>
    </div>
  );

  const renderReview = () => {
    const totalWeight = Object.values(watchedWeights || {}).reduce((a, b) => a + b, 0);

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6"
        >
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-amber-500" />
            Ready to start
          </h3>

          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Project</span>
              <span 
                className="text-gray-900 dark:text-white font-mono text-sm truncate max-w-[200px]"
                title={watchedInputFolder || 'Not set'}
              >
                {watchedInputFolder?.split(/[\\/]/).pop() || 'Not set'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Images found</span>
              <span className="text-gray-900 dark:text-white">{folderScanCount ?? '?'}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Target selection</span>
              <span className="text-gray-900 dark:text-white">
                {watchedNumImages === 0 ? 'All S-tier' : `${watchedNumImages} images`}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Scoring</span>
              <span className="text-gray-900 dark:text-white capitalize">{watchedGenre} preset</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">AI Engine</span>
              <span className="text-gray-900 dark:text-white capitalize">{watchedProvider}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Shortfall strategy</span>
              <span className="text-gray-900 dark:text-white text-sm text-right max-w-[220px]">
                {SHORTFALL_LABELS[watch('shortfallStrategy')] ?? watch('shortfallStrategy')}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Lightroom mode</span>
              <span className="text-gray-900 dark:text-white text-sm text-right max-w-[220px]">
                {LIGHTROOM_MODE_LABELS[watch('lightroomMode')] ?? watch('lightroomMode')}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">XMP sidecar export</span>
              <span className={`text-sm font-medium ${watch('enableXmpExport') ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {watch('enableXmpExport') ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Reference image</span>
              <span className={`text-sm font-medium ${watch('referenceImage') ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {watch('referenceImage')?.filename || 'None'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">File types</span>
              <span className="text-gray-900 dark:text-white text-sm truncate max-w-[200px]" title={watch('extensionFilter')?.length ? watch('extensionFilter')?.join(', ') : 'All formats'}>
                {watch('extensionFilter')?.length ? watch('extensionFilter')?.join(', ') : 'All formats'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Prefix filter</span>
              <span className="text-gray-900 dark:text-white text-sm truncate max-w-[200px]" title={watch('prefixFilter')?.length ? `${watch('prefixFilter')?.join(', ')} (${watch('prefixCaseInsensitive') ? 'case-insensitive' : 'case-sensitive'})` : 'None'}>
                {watch('prefixFilter')?.length ? `${watch('prefixFilter')?.join(', ')} (${watch('prefixCaseInsensitive') ? 'case-insensitive' : 'case-sensitive'})` : 'None'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-500 dark:text-gray-400">Mode</span>
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {watchedDryRun ? 'Dry Run (estimate only)' : 'Live (API calls)'}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Back button on review */}
        <div className="flex justify-start">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Options
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-2xl p-6"
        >
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {watchedDryRun
                  ? 'Dry-run is enabled — no real API calls will be made'
                  : 'This will make live API calls and may incur costs'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {watchedDryRun
                  ? 'You will see an estimated token count and cost before committing.'
                  : `Processing ${folderScanCount ?? 'your'} images with ${watchedProvider} at ${watch('concurrency')} parallel call${watch('concurrency') !== 1 ? 's' : ''}.`}
              </p>
            </div>
          </div>
        </motion.div>

        {totalWeight !== 100 && (
          <p className="text-red-500 dark:text-red-400 text-xs text-center flex items-center justify-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Scoring weights must total 100%
          </p>
        )}

        <button
          onClick={handleSubmit(onSubmit)}
          disabled={!isValid || isStarting || totalWeight !== 100}
          className="w-full px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 dark:disabled:text-gray-500 text-white dark:text-black font-bold rounded-xl shadow-lg shadow-amber-900/20 dark:shadow-amber-900/30 transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Start Culling
            </>
          )}
        </button>
      </div>
    );
  };

  // Loading screen
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-[#0f1117] transition-colors">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-4" />
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Preparing Workspace</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading your preferences...</p>
        </div>
      </div>
    );
  }

  // Main setup container with entrance animation
  //
  // Layout explanation:
  // ┌─ motion.div: w-full min-h-screen — fills the entire Electron window so the
  // │  background gradient covers edge-to-edge, not just behind the content column.
  // │
  // ├─ sticky header: full-width (w-full), positioned outside max-w-5xl so it
  // │  spans wall-to-wall. Inner content is constrained by max-w-5xl mx-auto.
  // │  pb-6 gives the step-indicator circles breathing room above the border.
  // │
  // └─ scrollable body: max-w-5xl mx-auto px-4 — the content column.
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-[#0f1117] dark:to-[#0a0c10]"
    >
      {/* ===== STICKY TOP SECTION — full viewport width ===== */}
      {/*
        BUG FIX 1 (icon clipping):
          - Removed pt-0/pb-0 from wrapper; now uses pt-5 pb-6 so the step
            indicator circles (w-10 h-10 + ring-4) have 24px of clear space
            above the border-b line and never clip.
          - Reduced header mb from mb-8 → mb-4 to keep the header compact.
          - Step indicator row uses py-1 so ring glows don't clip at top.

        BUG FIX 2 (app only filling centre):
          - Sticky bar is now a direct child of motion.div (full width), not
            nested inside max-w-5xl. This means the backdrop/border truly
            spans edge-to-edge regardless of window width.
          - max-w-5xl mx-auto px-6 is applied to the *inner* row only.
      */}
      <div className="sticky top-0 z-10 w-full border-b border-gray-200 dark:border-[#1e2535] shadow-sm backdrop-blur-md bg-gray-50/90 dark:bg-[#0f1117]/90">
        <div className="max-w-5xl mx-auto px-6">
          {/* Header row */}
          <div className="flex justify-between items-center pt-5 mb-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-amber-600 bg-clip-text text-transparent">
                CullAI
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
                Intelligent Photo Selection
              </p>
            </div>
            <div className="flex items-center gap-3">{themeToggle}</div>
          </div>

          {/* Step Indicator — py-1 ensures ring-4 on active circle doesn't clip */}
          <div className="pb-6 py-1">
            <div className="flex items-center justify-between gap-2 relative">
              {STEPS.map((s, idx) => {
                const status = getStepStatus(s.id);
                const Icon = s.icon;
                const isCurrent = status === 'current';
                const isComplete = status === 'complete';
                return (
                  <React.Fragment key={s.id}>
                    <div className="flex flex-col items-center flex-1 relative">
                      <button
                        onClick={() => isComplete && handleStepClick(s.id)}
                        disabled={!isComplete}
                        className={`
                          relative z-10 flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300
                          ${isCurrent ? 'bg-amber-500 text-white ring-4 ring-amber-500/20' : ''}
                          ${isComplete ? 'bg-emerald-500 text-white cursor-pointer hover:scale-110 hover:ring-2 hover:ring-emerald-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0f1117]' : ''}
                          ${!isCurrent && !isComplete ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400' : ''}
                        `}
                      >
                        {isComplete ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => isComplete && handleStepClick(s.id)}
                        disabled={!isComplete}
                        className={`text-xs mt-2 font-medium hidden sm:block transition-colors ${
                          isCurrent
                            ? 'text-amber-600 dark:text-amber-400'
                            : isComplete
                            ? 'text-gray-600 dark:text-gray-400 cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400'
                            : 'text-gray-400 dark:text-gray-600'
                        }`}
                      >
                        {s.label}
                      </button>
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full relative overflow-hidden mt-[-20px]">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
                          style={{ width: `${Math.min(100, (currentIndex > idx ? 100 : currentIndex === idx ? 50 : 0))}%` }}
                        />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* ===== END STICKY SECTION ===== */}

      {/* Scrollable body — content column */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Step content with animated transitions */}
        <div className="relative">
          <AnimatePresence mode="wait" custom={directionRef.current}>
            <motion.div
              key={step}
              custom={directionRef.current}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 36, filter: 'blur(2px)' }),
                center: { opacity: 1, x: 0, filter: 'blur(0px)' },
                exit: (d: number) => ({ opacity: 0, x: d * -36, filter: 'blur(2px)' }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {step === 'welcome' && renderWelcome()}
              {step === 'project' && renderProject()}
              {step === 'scoring' && renderScoring()}
              {step === 'ai' && renderAI()}
              {step === 'options' && renderOptions()}
              {step === 'review' && renderReview()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation buttons (only show for non-welcome, non-review steps) */}
        {step !== 'welcome' && step !== 'review' && (
          <div className="flex justify-between mt-10 pt-6 border-t border-gray-200 dark:border-[#1e2535]">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#1a1f2e] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={isValidatingStep}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-medium rounded-xl shadow-md transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isValidatingStep ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}