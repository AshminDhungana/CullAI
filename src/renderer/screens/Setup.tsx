import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import {
  FolderOpen,
  FolderOutput,
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
  RotateCcw,
  ShieldOff,
} from 'lucide-react';
import ExtensionFilter from '../components/ExtensionFilter';
import PrefixFilter from '../components/PrefixFilter';
import GenrePresetSelector from '../components/GenrePresetSelector';
import ReferenceImageUpload from '../components/ReferenceImageUpload';
import ScoringWeightsPanel from '../components/ScoringWeightsPanel';
import RecentFoldersDropdown from '../components/RecentFoldersDropdown';
import { useRecentFolders } from '../hooks/useRecentFolders';
import { useIgnoreRules } from '../hooks/useIgnoreRules';
import type { AppSettings, AIProvider, ReferenceImage } from '../../shared/types';
import { defaultAppSettings } from '../../shared/types';
import { GENRE_PRESETS } from '../../shared/genre-presets';
import { PROVIDER_DEFAULTS } from '../../shared/constants';
import LicensePanel from '../components/LicensePanel';
import type { LicenseStatus as LicenseStatusType } from '../../shared/license';
import { isAllowed } from '../../shared/license';
import CacheSettingsPanel from '../components/CacheSettingsPanel';
import StyleProfileManager from '../components/StyleProfileManager';
import RecentSessionsPanel from '../components/RecentSessionsPanel';
import type { SessionHistoryEntry } from '../../shared/types';
import ModelCombobox, { type ModelComboboxHandle } from '../components/ModelCombobox';

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
  duplicateThreshold: z.number().min(5).max(20).optional(),
  maxFacesPerImage: z.number().optional(),
  rawCacheMaxSizeGb: z.number().min(1).max(50),
  rawCacheMaxAgeDays: z.number().min(1).max(365),
  disableRawCache: z.boolean(),
  processSubfolders: z.boolean(),
  preserveSubfolderStructure: z.boolean(),
  enableAutoTagging: z.boolean().optional(),
  tagTopPercent: z.number().min(10).max(100).optional(),
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
// API key masking
// -----------------------------------------------------------------------------
const MASKED_SENTINEL = '__MASKED__';

function maskKey(key: string): string {
  if (key.length <= 4) return '••••••••';
  return `••••••••${key.slice(-4)}`;
}

// -----------------------------------------------------------------------------
// Wizard steps
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

const SHORTFALL_LABELS: Record<string, string> = {
  stop: 'Stop — output available keepers only',
  fillWithB: 'Fill with B‑tier images',
  fillWithRejected: 'Fill with B‑tier, then rejected',
};

const LIGHTROOM_MODE_LABELS: Record<string, string> = {
  rateInPlace: 'Rate originals in‑place',
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
  const [revealError, setRevealError] = useState<{ input: boolean; output: boolean }>({ input: false, output: false });

  type FolderRelationship = 'same' | 'output-inside-input' | 'input-inside-output' | 'ok' | null;
  const [folderRelationship, setFolderRelationship] = useState<FolderRelationship>(null);
  const [ignoreFolderWarning, setIgnoreFolderWarning] = useState(false);
  const [showDuplicateTooltip, setShowDuplicateTooltip] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [apiKeySaveError, setApiKeySaveError] = useState<string>('');
  const modelComboboxRef = useRef<ModelComboboxHandle>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusType | null>(null);

  // Derived gate flags — single source of truth for all feature locks in this
  // component. Both default to false (locked) until licenseStatus loads, which
  // prevents a brief flash where gated controls appear enabled on mount.
  const tier = licenseStatus?.tier ?? 'free';
  const canUseXmp      = isAllowed('xmpExport',         tier);
  const canUseRaw      = isAllowed('rawFormats',         tier);
  const canAddProfiles = isAllowed('unlimitedProfiles',  tier);
  const canAutoTag     = isAllowed('autoTagging' as any, tier);

  // FIX #6: fetchLicenseStatus is stable and can be called independently of
  // the isLoading flag. It is called explicitly at the end of the load()
  // function so both settings restore and license status are sequenced
  // correctly, rather than being triggered by a side-effect on isLoading.
  const fetchLicenseStatus = useCallback(async () => {
    try {
      // @ts-expect-error
      const status = await window.electronAPI.licenseGetStatus();
      setLicenseStatus(status);
    } catch (err) {
      console.warn('Failed to load license status:', err);
    }
  }, []);

  const { recentInput, recentOutput, addRecentInput, addRecentOutput } = useRecentFolders();

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
      rawCacheMaxSizeGb: 5,
      rawCacheMaxAgeDays: 30,
      disableRawCache: false,
      processSubfolders: false,
      preserveSubfolderStructure: false,
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
  const watchedDisableDuplicateGrouping = useWatch({ control, name: 'disableDuplicateGrouping' });
  const watchedRawCacheMaxSizeGb = useWatch({ control, name: 'rawCacheMaxSizeGb' });
  const watchedRawCacheMaxAgeDays = useWatch({ control, name: 'rawCacheMaxAgeDays' });
  const watchedDisableRawCache = useWatch({ control, name: 'disableRawCache' });
  const watchedBaseUrl = useWatch({ control, name: 'baseUrl' });
  const watchedProcessSubfolders = useWatch({ control, name: 'processSubfolders' });
  const watchedEnableAutoTagging = useWatch({ control, name: 'enableAutoTagging' });
  const watchedTagTopPercent = useWatch({ control, name: 'tagTopPercent' });

  const {
    patterns: ignorePatterns,
    matchCount: ignoreMatchCount,
    found: ignoreFound,
    loading: ignoreLoading,
    reload: reloadIgnore,
  } = useIgnoreRules(watchedInputFolder);

  // This guarantees the form is fully reset before license gating affects
  // any field (e.g. XMP export toggle disabled state).
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
            disableDuplicateGrouping: stored.disableDuplicateGrouping ?? false,
            duplicateThreshold: stored.duplicateThreshold ?? 10,
            maxFacesPerImage: stored.maxFacesPerImage ?? 0,
            rawCacheMaxSizeGb: stored.rawCacheMaxSizeGb ?? 5,
            rawCacheMaxAgeDays: stored.rawCacheMaxAgeDays ?? 30,
            disableRawCache: stored.disableRawCache ?? false,
            processSubfolders: stored.processSubfolders ?? false,
            preserveSubfolderStructure: stored.preserveSubfolderStructure ?? false,
          });
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setIsLoading(false);

        // the correct sequence and doesn't depend on the isLoading effect.
        await fetchLicenseStatus();
      }
    }
    load();
  }, [reset, fetchLicenseStatus]);

  // Auto-save debounced
  const saveSettings = useCallback(
    debounce(async (values: SetupFormValues) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { apiKey: _omit, ...rest } = values;
        const toStore = {
          ...rest,
          extensionFilter: values.extensionFilter || [],
          prefixFilter: values.prefixFilter || [],
          prefixCaseInsensitive: values.prefixCaseInsensitive ?? true,
          referenceImage: values.referenceImage ?? null,
          disableDuplicateGrouping: values.disableDuplicateGrouping ?? false,
          duplicateThreshold: values.duplicateThreshold ?? 10,
          maxFacesPerImage: values.maxFacesPerImage ?? 0,
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

  /**
   * Called by StyleProfileManager when the user clicks "Load".
   * Populates genre, weights, and preferenceText from the saved profile.
   */
  const handleLoadProfile = useCallback((profile: import('../../shared/types').StyleProfile) => {
    setValue('genre',          profile.genre,         { shouldDirty: true });
    setValue('weights',        profile.weights,        { shouldDirty: true });
    setValue('preferenceText', profile.preferenceText, { shouldDirty: true });
    setActiveProfileId(profile.id);
  }, [setValue]);

  /**
   * Called by RecentSessionsPanel when the user clicks "Load settings".
   * Restores genre, weights, and preferenceText from the history entry.
   * Does NOT restore inputFolder/outputFolder — those are session-specific.
   */
  const handleLoadSessionHistory = useCallback((entry: SessionHistoryEntry) => {
    setValue('genre',          entry.genre,           { shouldDirty: true });
    setValue('weights',        entry.weights,          { shouldDirty: true });
    setValue('preferenceText', entry.preferenceText,   { shouldDirty: true });
    // If the entry was run with a named profile, re-activate it
    if (entry.profileUsed) {
      setActiveProfileId(entry.profileUsed);
    }
  }, [setValue]);

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
      setApiKeySaveError('');
    }
  }, [watchedProvider, setValue]);

  useEffect(() => {
    if (watchedProvider === 'ollama' && watchedBaseUrl) {
      const timer = setTimeout(() => {
        modelComboboxRef.current?.triggerFetch();
      }, 800); // debounce to avoid hammering on every keystroke
      return () => clearTimeout(timer);
    }
  }, [watchedBaseUrl, watchedProvider]);

  useEffect(() => {
    if (isLoading) return;
    async function loadStoredKey() {
      try {
        // @ts-expect-error - electronAPI
        const stored: string | null = await window.electronAPI.getApiKey(watchedProvider);
        if (stored) {
          setValue('apiKey', MASKED_SENTINEL, { shouldDirty: false });
          // Key already stored for this provider → auto-fetch models immediately.
          // Covers switching between providers where both have saved keys, so the
          // model dropdown refreshes without requiring an extra button click.
          modelComboboxRef.current?.triggerFetch();
        } else {
          setValue('apiKey', '', { shouldDirty: false });
        }
      } catch {
        setValue('apiKey', '', { shouldDirty: false });
      }
    }
    loadStoredKey();
  }, [watchedProvider, isLoading, setValue]);

  useEffect(() => {
    runFolderRelationshipCheck(watchedInputFolder, watchedOutputFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedInputFolder, watchedOutputFolder]);

  const validateInputFolder = async (folder: string) => {
    if (!folder) return false;
    try {
      // @ts-expect-error
      const exists = await window.electronAPI.folderExists(folder);
      if (!exists) return false;
      // @ts-expect-error
      const scan = await window.electronAPI.scanFolder(folder, [], [], ignorePatterns);
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
        await runFolderRelationshipCheck(watchedInputFolder, folder);
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  const handleSelectRecentInput = async (folder: string) => {
    setValue('inputFolder', folder, { shouldDirty: true, shouldValidate: true });
    await validateInputFolder(folder);
    await addRecentInput(folder);
  };

  const handleSelectRecentOutput = async (folder: string) => {
    setValue('outputFolder', folder, { shouldDirty: true, shouldValidate: true });
    await addRecentOutput(folder);
    await runFolderRelationshipCheck(watchedInputFolder, folder);
  };

  const runFolderRelationshipCheck = async (input: string, output: string) => {
    setIgnoreFolderWarning(false);
    if (!input || !output) {
      setFolderRelationship(null);
      return;
    }
    try {
      // @ts-expect-error - electronAPI
      const rel = await window.electronAPI.checkFolderRelationship(input, output);
      setFolderRelationship(rel);
    } catch {
      setFolderRelationship('ok');
    }
  };

  const revealFolder = async (kind: 'input' | 'output', folderPath: string) => {
    if (!folderPath) {
      setRevealError(prev => ({ ...prev, [kind]: true }));
      setTimeout(() => setRevealError(prev => ({ ...prev, [kind]: false })), 820);
      return;
    }
    try {
      // @ts-expect-error - electronAPI
      await window.electronAPI.shellShowItem(folderPath);
    } catch (err: any) {
      console.warn('[revealFolder]', err?.message ?? err);
    }
  };

  const resolveApiKey = async (provider: AIProvider, formValue: string | undefined): Promise<string> => {
    if (formValue && formValue !== MASKED_SENTINEL) return formValue;
    try {
      // @ts-expect-error - electronAPI
      const stored: string | null = await window.electronAPI.getApiKey(provider);
      return stored ?? '';
    } catch {
      return '';
    }
  };

  const testConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    try {
      const values = getValues();
      const apiKey = await resolveApiKey(values.provider, values.apiKey);
      // @ts-expect-error
      const result = await window.electronAPI.testConnection?.({
        provider: values.provider,
        baseUrl: values.baseUrl,
        apiKey,
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
    const resolvedApiKey = await resolveApiKey(data.provider, data.apiKey);
    const fullSettings: AppSettings = {
      ...defaultAppSettings(),
      ...data,
      apiKey: resolvedApiKey,
      extensionFilter: data.extensionFilter || [],
      prefixFilter: data.prefixFilter || [],
      prefixCaseInsensitive: data.prefixCaseInsensitive ?? true,
      referenceImage: (data.referenceImage ?? null) as ReferenceImage,
      disableDuplicateGrouping: data.disableDuplicateGrouping || false,
      duplicateThreshold: data.duplicateThreshold || 10,
      maxFacesPerImage: data.maxFacesPerImage || 0,
      enableAutoTagging: canAutoTag ? (data.enableAutoTagging ?? false) : false,
      tagTopPercent: data.tagTopPercent ?? 20,
      rawCacheMaxSizeGb: 5,
      rawCacheMaxAgeDays: 30,
      disableRawCache: false,
      processSubfolders: data.processSubfolders ?? false,
      preserveSubfolderStructure: data.preserveSubfolderStructure ?? false,
      activeProfileId,          // ← Phase 14: carry the loaded profile ID
    };
    onStart(fullSettings);
  };

  // Step navigation
  const currentIndex = STEP_ORDER.indexOf(step);
  const canGoNext = async () => {
    if (step === 'welcome') return true;
    if (step === 'project') {
      const valid = await trigger(['inputFolder', 'outputFolder']);
      if (!valid || !watchedInputFolder || !watchedOutputFolder) return false;
      const hasConflict = folderRelationship === 'same' || folderRelationship === 'output-inside-input';
      if (hasConflict && !ignoreFolderWarning) return false;
      return true;
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

  const handleStepClick = (targetId: WizardStep) => {
    const targetIdx = STEP_ORDER.indexOf(targetId);
    directionRef.current = targetIdx < currentIndex ? -1 : 1;
    setStep(targetId);
  };

  const getStepStatus = (stepId: WizardStep): 'complete' | 'current' | 'pending' => {
    const idx = STEP_ORDER.indexOf(stepId);
    if (idx < currentIndex) return 'complete';
    if (idx === currentIndex) return 'current';
    return 'pending';
  };

  // ---------------------------------------------------------------------------
  // Render: Welcome
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

  // ---------------------------------------------------------------------------
  // Render: Project
  // ---------------------------------------------------------------------------
  const renderProject = () => (
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Input Folder Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5">
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
                      className="flex-1 bg-gray-50 dark:bg-[#0f1117] rounded-lg px-3 py-2.5 font-mono text-sm text-gray-700 dark:text-gray-300 truncate border border-gray-200 dark:border-[#1e2535] min-h-[40px] flex items-center"
                      title={field.value || 'No folder selected'}
                    >
                      <span className={field.value ? '' : 'text-gray-400 dark:text-gray-600'}>
                        {field.value || 'No folder selected'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => revealFolder('input', field.value)}
                      title={field.value ? 'Reveal in Explorer / Finder' : 'No folder selected'}
                      className={`
                        shrink-0 flex items-center justify-center w-10 h-10 rounded-lg border transition-all
                        ${revealError.input
                          ? 'border-red-400 bg-red-50 dark:bg-red-950/30 text-red-500 animate-[shake_0.4s_ease-in-out]'
                          : 'border-gray-200 dark:border-[#1e2535] bg-gray-50 dark:bg-[#0f1117] text-gray-500 dark:text-gray-400 hover:border-amber-400 hover:text-amber-500 dark:hover:text-amber-400'
                        }
                      `}
                    >
                      <FolderOutput className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleBrowseInput}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
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
          </div>

          {/* Image Count Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5">
            <Controller
              name="numImagesToSelect"
              control={control}
              render={({ field }) => (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Images to select
                    </label>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      (0 = all S‑tier)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      {...field}
                      type="number"
                      min={0}
                      max={999}
                      step={1}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                      className="w-24 bg-white dark:bg-[#0f1117] border border-gray-300 dark:border-[#1e2535] rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                    <span className="text-gray-500 dark:text-gray-400 text-sm">images</span>
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
                  <p className="text-gray-400 dark:text-gray-600 text-xs">
                    {field.value === 0
                      ? 'Will output all S‑tier images (no limit)'
                      : `Will select the top ${field.value} best images`}
                  </p>
                </div>
              )}
            />
          </div>

          {/* Prefix Filter Card */}
          {watchedInputFolder && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5">
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
            </div>
          )}

          {/* Subfolder Processing Card */}
          {watchedInputFolder && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
                  <Layers className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                    Subfolder Processing
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Process images across nested folders
                  </p>
                </div>
              </div>

              {/* Checkbox 1: Process subfolders recursively */}
              <Controller
                name="processSubfolders"
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
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Process subfolders recursively
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Scan all nested folders inside the input folder as separate batches.
                      </p>
                    </div>
                  </label>
                )}
              />

              {/* Checkbox 2: Preserve subfolder structure (conditional) */}
              <AnimatePresence>
                {watchedProcessSubfolders && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden pl-8"
                  >
                    <Controller
                      name="preserveSubfolderStructure"
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
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              Preserve folder structure in output
                            </span>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              Mirror the input folder hierarchy under the output folder.
                              When off, all keepers are flattened into a single folder
                              (filename conflicts resolved with _1, _2 suffixes).
                            </p>
                          </div>
                        </label>
                      )}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Output Folder Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5">
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
                      className="flex-1 bg-gray-50 dark:bg-[#0f1117] rounded-lg px-3 py-2.5 font-mono text-sm text-gray-700 dark:text-gray-300 truncate border border-gray-200 dark:border-[#1e2535] min-h-[40px] flex items-center"
                      title={field.value || 'No folder selected'}
                    >
                      <span className={field.value ? '' : 'text-gray-400 dark:text-gray-600'}>
                        {field.value || 'No folder selected'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => revealFolder('output', field.value)}
                      title={field.value ? 'Reveal in Explorer / Finder' : 'No folder selected'}
                      className={`
                        shrink-0 flex items-center justify-center w-10 h-10 rounded-lg border transition-all
                        ${revealError.output
                          ? 'border-red-400 bg-red-50 dark:bg-red-950/30 text-red-500 animate-[shake_0.4s_ease-in-out]'
                          : 'border-gray-200 dark:border-[#1e2535] bg-gray-50 dark:bg-[#0f1117] text-gray-500 dark:text-gray-400 hover:border-amber-400 hover:text-amber-500 dark:hover:text-amber-400'
                        }
                      `}
                    >
                      <FolderOutput className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleBrowseOutput}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
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
          </div>

          {/* Folder Conflict Warning Banner */}
          {(folderRelationship === 'same' || folderRelationship === 'output-inside-input') && (
            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-2xl border border-amber-300 dark:border-amber-700/50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {folderRelationship === 'same'
                      ? 'Output folder is the same as the input folder'
                      : 'Output folder is inside the input folder'}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    This may cause recursion or accidental overwrites. Continue?
                  </p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        ignoreFolderWarning
                          ? 'bg-amber-500 border-amber-500'
                          : 'border-amber-400 dark:border-amber-600 hover:border-amber-500'
                      }`}
                      onClick={() => setIgnoreFolderWarning(v => !v)}
                    >
                      {ignoreFolderWarning && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span
                      className="text-xs text-amber-800 dark:text-amber-300"
                      onClick={() => setIgnoreFolderWarning(v => !v)}
                    >
                      Ignore for this session and continue anyway
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Extension Filter Card */}
          {watchedInputFolder && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
                  <FileImage className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">File Type Filter</h3>
                    {!canUseRaw && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                        RAW = PRO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {canUseRaw
                      ? 'Choose which formats to include'
                      : 'JPEG/PNG/WebP included — upgrade to Pro to process RAW files'}
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
                    rawLocked={!canUseRaw}
                  />
                )}
              />
            </div>
          )}

          {/* .cullaiignore Card */}
          {watchedInputFolder && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
                    <ShieldOff className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">.cullaiignore</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Exclude files via glob patterns
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={reloadIgnore}
                  disabled={ignoreLoading}
                  title="Re-read .cullaiignore from disk"
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-[#1e2535] bg-gray-50 dark:bg-[#0f1117] text-gray-400 hover:text-amber-500 dark:hover:text-amber-400 hover:border-amber-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${ignoreLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="mt-1">
                {ignoreLoading ? (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Reading .cullaiignore…
                  </div>
                ) : ignoreFound ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {ignoreMatchCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
                        <ShieldOff className="w-3 h-3" />
                        Ignoring {ignoreMatchCount} {ignoreMatchCount === 1 ? 'file' : 'files'} via .cullaiignore
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                        <CheckCircle2 className="w-3 h-3" />
                        .cullaiignore found
                        {ignorePatterns.length === 0
                          ? ' — no active patterns'
                          : ` — ${ignorePatterns.length} pattern${ignorePatterns.length === 1 ? '' : 's'}, no matches`}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#1e2535] text-gray-500 dark:text-gray-500 text-xs">
                    <Info className="w-3 h-3" />
                    No .cullaiignore found in this folder
                  </span>
                )}
              </div>

              {ignoreFound && ignorePatterns.length > 0 && (
                <div className="mt-3 space-y-1">
                  {ignorePatterns.slice(0, 5).map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2.5 py-1 bg-gray-50 dark:bg-[#0f1117] rounded-lg border border-gray-100 dark:border-[#1e2535]"
                    >
                      <span className="text-amber-400 text-xs select-none">×</span>
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400 truncate">{p}</span>
                    </div>
                  ))}
                  {ignorePatterns.length > 5 && (
                    <p className="text-xs text-gray-400 dark:text-gray-600 pl-1">
                      +{ignorePatterns.length - 5} more pattern{ignorePatterns.length - 5 === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              )}

              {!ignoreFound && (
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-600">
                  Create a <span className="font-mono">.cullaiignore</span> file in your input folder to exclude files using glob patterns (one per line). Supports <span className="font-mono">*</span>, <span className="font-mono">**</span>, <span className="font-mono">?</span>, and <span className="font-mono">[abc]</span>.
                </p>
              )}
            </div>
          )}

          {/* Filter tips hint */}
          <div className="bg-amber-50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/30 p-5">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-300">
                <p className="font-medium">Filter tips</p>
                <p className="mt-1">Use extension and prefix filters to narrow down which images are analyzed. Leave empty to include all supported formats.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Scoring
  // ---------------------------------------------------------------------------
  const renderScoring = () => (
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">

          {/* Style Profile Manager — Phase 14.1 */}
          <StyleProfileManager
            currentGenre={watchedGenre}
            currentWeights={watchedWeights}
            currentPreferenceText={watch('preferenceText') ?? ''}
            activeProfileId={activeProfileId}
            onLoad={handleLoadProfile}
            onActiveProfileChange={setActiveProfileId}
            tier={tier}
          />

          {/* Recent Sessions — Phase 14.3 */}
          <RecentSessionsPanel onLoad={handleLoadSessionHistory} />

          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
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
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowAdvancedWeights(!showAdvancedWeights)}
              className="text-sm text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 mx-auto"
            >
              {showAdvancedWeights ? 'Hide' : 'Customize Advanced Scoring'}
              <Sliders className="w-3 h-3" />
            </button>
          </div>

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
                  render={({ field }) => (
                    <Controller
                      name="maxFacesPerImage"
                      control={control}
                      render={({ field: facesField }) => (
                        <ScoringWeightsPanel
                          weights={field.value}
                          onChange={field.onChange}
                          maxFacesPerImage={facesField.value ?? 0}
                          onMaxFacesChange={facesField.onChange}
                        />
                      )}
                    />
                  )}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl shrink-0">
                <ImageIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Custom Instructions & Reference</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Guide the AI with your preferred style</p>
              </div>
            </div>

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

            <div className="border-t border-gray-100 dark:border-[#1e2535]" />

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
          </div>
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: AI
  // ---------------------------------------------------------------------------
  const renderAI = () => (
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">AI Engine</label>
          <div className="grid grid-cols-2 gap-3">
            {(['claude', 'openai', 'gemini', 'ollama'] as AIProvider[]).map((prov) => (
              <button
                key={prov}
                type="button"
                onClick={() => setValue('provider', prov, { shouldDirty: true })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  watchedProvider === prov
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
                    : 'border-gray-200 dark:border-[#1e2535] hover:border-amber-300 dark:hover:border-amber-700'
                }`}
              >
                <div className="font-medium capitalize text-gray-900 dark:text-white">{prov}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {prov === 'claude' && 'Anthropic'}
                  {prov === 'openai' && 'GPT'}
                  {prov === 'gemini' && 'Google Gemini'}
                  {prov === 'ollama' && 'Local (free)'}
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setValue('provider', 'custom', { shouldDirty: true })}
            className={`mt-3 w-full p-3 rounded-xl border text-left transition-all ${
              watchedProvider === 'custom'
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-500/20'
                : 'border-gray-200 dark:border-[#1e2535] hover:border-amber-300 dark:hover:border-amber-700'
            }`}
          >
            <div className="font-medium text-gray-900 dark:text-white">Custom (OpenAI‑compatible)</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Bring your own endpoint</div>
          </button>
        </div>

        <div className="space-y-6">
          {watchedProvider !== 'ollama' && (
            <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                API Key
                <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                  <Key className="w-3 h-3" />
                  Stored in OS keychain
                </span>
              </label>
              <div className="flex gap-2">
                <Controller
                  name="apiKey"
                  control={control}
                  render={({ field }) => (
                    <input
                      {...field}
                      value={field.value === MASKED_SENTINEL ? maskKey(field.value) : (field.value ?? '')}
                      onChange={(e) => {
                        field.onChange(e.target.value);
                        setApiKeySaveError('');
                      }}
                      onFocus={() => {
                        if (field.value === MASKED_SENTINEL) {
                          field.onChange('');
                        }
                      }}
                      onBlur={async (e) => {
                        field.onBlur();
                        const val = e.target.value.trim();

                        if (val === '' || val === maskKey(MASKED_SENTINEL)) {
                          if (val === '') {
                            try {
                              // @ts-expect-error - electronAPI
                              await window.electronAPI.deleteApiKey(watchedProvider);
                            } catch { /* non-fatal */ }
                          }
                          return;
                        }

                        if (val === MASKED_SENTINEL) return;

                        try {
                          setApiKeySaveError('');
                          // @ts-expect-error - electronAPI
                          await window.electronAPI.storeApiKey(watchedProvider, val);
                          setValue('apiKey', MASKED_SENTINEL, { shouldDirty: false });
                          modelComboboxRef.current?.triggerFetch();
                        } catch (err: any) {
                          setApiKeySaveError(
                            err?.message?.includes('not available')
                              ? 'OS keychain unavailable — key held in memory only for this session.'
                              : 'Failed to save API key securely.',
                          );
                        }
                      }}
                      type={showApiKey ? 'text' : 'password'}
                      placeholder="sk-..."
                      autoComplete="off"
                      spellCheck={false}
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
              {apiKeySaveError && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {apiKeySaveError}
                </p>
              )}
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
                <ModelCombobox
                  ref={modelComboboxRef}
                  value={field.value}
                onChange={field.onChange}
                  onBlur={field.onBlur}
                  provider={watchedProvider}
                  baseUrl={watch('baseUrl')}
                  hasStoredKey={watch('apiKey') === MASKED_SENTINEL}
                  disabled={false}
                  error={errors.model?.message}
                />
              )}
            />
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
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Options
  // two-column grid renders correctly. Previously the right column cards were
  // nested inside the left column's <div className="space-y-6">, collapsing
  // the grid into a single stacked column at runtime.
  // ---------------------------------------------------------------------------
  const renderOptions = () => (
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left column ── */}
        <div className="space-y-6">
          {/* License Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                License
              </label>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Manage your CullAI tier and monthly quota
            </p>
            <LicensePanel status={licenseStatus} onStatusChange={fetchLicenseStatus} />
          </div>

          {/* Style Profile Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Style Profile</label>
              <button
                type="button"
                disabled={!canAddProfiles}
                title={canAddProfiles ? 'Create a new style profile' : 'Upgrade to Pro to create more profiles'}
                className={`text-xs flex items-center gap-1 transition-colors ${
                  canAddProfiles
                    ? 'text-amber-600 dark:text-amber-400 hover:underline'
                    : 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                }`}
              >
                <Settings className="w-3 h-3" />
                Create New
                {!canAddProfiles && (
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                    PRO
                  </span>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Saved preference sets for quick reuse</p>
            <div className="w-full bg-gray-50 dark:bg-[#0f1117] border border-gray-200 dark:border-[#1e2535] rounded-lg px-4 py-2.5 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed select-none">
              No profiles yet
            </div>
          </div>

          {/* Dry Run Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
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
                      Runs a dry‑run pass to estimate API cost and token usage without making real API calls.
                    </p>
                  </div>
                </label>
              )}
            />
          </div>

          {/* XMP Export Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <Controller
              name="enableXmpExport"
              control={control}
              render={({ field }) => (
                <label
                  className={`flex items-start gap-3 group ${
                    !canUseXmp ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  <div className="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={(e) => {
                        if (!canUseXmp) return;
                        field.onChange(e.target.checked);
                      }}
                      disabled={!canUseXmp}
                      className="sr-only"
                    />
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        field.value
                          ? 'bg-amber-500 border-amber-500'
                          : 'border-gray-300 dark:border-gray-600 group-hover:border-amber-400'
                      } ${!canUseXmp ? 'opacity-50' : ''}`}
                    >
                      {field.value && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Write Lightroom / Capture One sidecar files
                      </span>
                      {!canUseXmp && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                          PRO
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Generates .xmp sidecar files with star ratings alongside your images.
                    </p>
                  </div>
                </label>
              )}
            />
          </div>

          {/* AI Auto-Tagging Card — Phase 13b */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <Controller
              name="enableAutoTagging"
              control={control}
              render={({ field }) => (
                <label
                  className={`flex items-start gap-3 group ${
                    !canAutoTag ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  <div className="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={field.value ?? false}
                      onChange={(e) => {
                        if (!canAutoTag) return;
                        field.onChange(e.target.checked);
                      }}
                      disabled={!canAutoTag}
                      className="sr-only"
                    />
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        field.value
                          ? 'bg-amber-500 border-amber-500'
                          : 'border-gray-300 dark:border-gray-600 group-hover:border-amber-400'
                      } ${!canAutoTag ? 'opacity-50' : ''}`}
                    >
                      {field.value && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Generate AI keywords (S/A tier only)
                      </span>
                      {!canAutoTag && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-medium">
                          PRO
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Tags top keepers with 5–10 descriptive keywords written to XMP sidecars — searchable in Lightroom and Capture One.
                    </p>
                  </div>
                </label>
              )}
            />
            {/* Top-percent control — only visible when toggle is on and tier allows it */}
            {watchedEnableAutoTagging && canAutoTag && (
              <div className="mt-4 flex items-center gap-3 pl-8">
                <span className="text-xs text-gray-600 dark:text-gray-400 shrink-0">Tag top</span>
                <Controller
                  name="tagTopPercent"
                  control={control}
                  render={({ field }) => (
                    <input
                      type="number"
                      min={10}
                      max={100}
                      step={5}
                      value={field.value ?? 20}
                      onChange={(e) => {
                        const v = Math.max(10, Math.min(100, Number(e.target.value)));
                        field.onChange(v);
                      }}
                      className="w-16 px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-[#1e2535] bg-transparent text-center text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  )}
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">% of S+A keepers</span>
              </div>
            )}
          </div>

          {/* RAW Preview Cache Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <CacheSettingsPanel
              inputFolder={watchedInputFolder}
              maxSizeGb={watchedRawCacheMaxSizeGb}
              maxAgeDays={watchedRawCacheMaxAgeDays}
              disabled={watchedDisableRawCache}
              onMaxSizeChange={(v) => setValue('rawCacheMaxSizeGb', v, { shouldDirty: true })}
              onMaxAgeChange={(v) => setValue('rawCacheMaxAgeDays', v, { shouldDirty: true })}
              onDisabledChange={(v) => setValue('disableRawCache', v, { shouldDirty: true })}
            />
          </div>
        </div>
        {/* ── End left column ── */}

        {/* ── Right column ── */}
        <div className="space-y-6">
          {/* Lightroom Mode Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Lightroom integration mode</label>
            <Controller
              name="lightroomMode"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  {([
                    { value: 'rateInPlace', label: 'Rate originals in‑place', desc: 'Stars are written to original files via XMP. No files are copied.' },
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
          </div>

          {/* Shortfall Strategy Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              When output falls short of requested count
            </label>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              What to do if not enough S‑tier or A‑tier images exist to meet your target.
            </p>
            <Controller
              name="shortfallStrategy"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  {([
                    { value: 'stop', label: 'Stop', desc: 'Output only available S + A tier keepers, even if below the target count.' },
                    { value: 'fillWithB', label: 'Fill with B‑tier images', desc: 'Automatically promote the best B‑tier images to reach the target.' },
                    { value: 'fillWithRejected', label: 'Fill with B‑tier, then rejected if still short', desc: 'First promotes B‑tier, then falls back to the best rejected images.' },
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
          </div>

          {/* Duplicate Detection Card */}
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Duplicate Detection</h3>
            </div>
            <Controller
              name="disableDuplicateGrouping"
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
                    <span className="text-sm font-medium text-gray-900 dark:text-white">Disable duplicate grouping</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Process near‑duplicate images individually instead of grouping them.
                    </p>
                  </div>
                </label>
              )}
            />

            <Controller
              name="duplicateThreshold"
              control={control}
              render={({ field }) => (
                <div className={`transition-opacity duration-200 ${watchedDisableDuplicateGrouping ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-1 relative">
                    <label className="block text-sm text-gray-700 dark:text-gray-300 font-medium">
                      Burst similarity threshold: <span className="font-semibold text-amber-500 dark:text-amber-400">{field.value ?? 10} bits</span>
                    </label>
                    <div className="relative inline-flex items-center">
                      <button
                        type="button"
                        onMouseEnter={() => setShowDuplicateTooltip(true)}
                        onMouseLeave={() => setShowDuplicateTooltip(false)}
                        onFocus={() => setShowDuplicateTooltip(true)}
                        onBlur={() => setShowDuplicateTooltip(false)}
                        aria-label="Burst similarity threshold info"
                        className="text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        disabled={watchedDisableDuplicateGrouping}
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>

                      {showDuplicateTooltip && (
                        <div
                          role="tooltip"
                          className="absolute left-1/2 bottom-full mb-2 -translate-x-1/2 z-30 w-72 px-3 py-2.5 bg-gray-900 dark:bg-[#1e2535] text-white text-xs leading-relaxed font-normal rounded-lg shadow-xl shadow-black/20 pointer-events-none"
                        >
                          Lower = stricter grouping (only nearly identical images). Higher = looser grouping (more images considered duplicates).
                          <div className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-900 dark:border-t-[#1e2535]" />
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={20}
                    step={1}
                    value={field.value ?? 10}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                    disabled={watchedDisableDuplicateGrouping}
                    className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1 select-none">
                    <span>5 (strict)</span>
                    <span>10 (default)</span>
                    <span>20 (loose)</span>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
        {/* ── End right column ── */}

      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Review
  // ---------------------------------------------------------------------------
  const renderReview = () => {
    const totalWeight = Object.values(watchedWeights || {}).reduce((a, b) => a + b, 0);

    return (
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
          <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-amber-500" />
              Configuration Summary
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Project</span>
                <span className="text-gray-900 dark:text-white font-mono text-sm truncate max-w-[200px]" title={watchedInputFolder || 'Not set'}>
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
                  {watchedNumImages === 0 ? 'All S‑tier' : `${watchedNumImages} images`}
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
                <span className="text-gray-500 dark:text-gray-400">AI keywords</span>
                <span className={`text-sm font-medium ${watchedEnableAutoTagging && canAutoTag ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {watchedEnableAutoTagging && canAutoTag
                    ? `Top ${watchedTagTopPercent ?? 20}% of keepers`
                    : 'Disabled'}
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
              {watch('processSubfolders') && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                  <span className="text-gray-500 dark:text-gray-400">Subfolders</span>
                  <span className="text-gray-900 dark:text-white text-sm">
                    {watch('preserveSubfolderStructure')
                      ? 'Recursive — structure preserved'
                      : 'Recursive — flat output'}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Prefix filter</span>
                <span className="text-gray-900 dark:text-white text-sm truncate max-w-[200px]" title={watch('prefixFilter')?.length ? `${watch('prefixFilter')?.join(', ')} (${watch('prefixCaseInsensitive') ? 'case-insensitive' : 'case-sensitive'})` : 'None'}>
                  {watch('prefixFilter')?.length ? `${watch('prefixFilter')?.join(', ')} (${watch('prefixCaseInsensitive') ? 'case‑insensitive' : 'case‑sensitive'})` : 'None'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">License</span>
                <span
                  className={`text-sm font-medium capitalize ${
                    licenseStatus?.tier === 'pro'
                      ? 'text-amber-600 dark:text-amber-400'
                      : licenseStatus?.tier === 'lifetime'
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {licenseStatus?.tier || 'Free'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-500 dark:text-gray-400">Mode</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {watchedDryRun ? 'Dry Run (estimate only)' : 'Live (API calls)'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {totalWeight !== 100 && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-2xl p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                <p className="text-sm text-red-800 dark:text-red-300 font-medium">
                  Scoring weights must total 100%
                </p>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {watchedDryRun
                      ? 'Dry‑run is enabled — no real API calls will be made'
                      : 'This will make live API calls and may incur costs'}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    {watchedDryRun
                      ? 'You will see an estimated token count and cost before committing.'
                      : `Processing ${folderScanCount ?? 'your'} images with ${watchedProvider} at ${watch('concurrency')} parallel call${watch('concurrency') !== 1 ? 's' : ''}.`}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit(onSubmit)}
              disabled={!isValid || isStarting || totalWeight !== 100}
              className="w-full px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 dark:disabled:text-gray-500 text-white font-bold rounded-xl shadow-lg shadow-amber-900/20 transition-all transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
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

            <button
              type="button"
              onClick={handleBack}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to Options
            </button>
          </div>
        </div>
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-[#0f1117] dark:to-[#0a0c10]"
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-10 w-full border-b border-gray-200 dark:border-[#1e2535] shadow-sm backdrop-blur-md bg-gray-50/90 dark:bg-[#0f1117]/90">
        <div className="max-w-5xl mx-auto px-6">
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

          {/* Step Indicator */}
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

      {/* Scrollable body */}
      <div className="max-w-5xl mx-auto px-6 py-8">
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
            {step === 'welcome'   && renderWelcome()}
            {step === 'project'   && renderProject()}
            {step === 'scoring'   && renderScoring()}
            {step === 'ai'        && renderAI()}
            {step === 'options'   && renderOptions()}
            {step === 'review'    && renderReview()}
          </motion.div>
        </AnimatePresence>

        {/* Navigation buttons */}
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