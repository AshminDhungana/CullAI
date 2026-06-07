import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Info,
  Loader2,
  ScanFace,
  Upload,
  X,
} from 'lucide-react';
import type { ReferenceImage } from '../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ReferenceImageUploadProps {
  /** Current reference image value (from AppSettings.referenceImage). */
  value: ReferenceImage;
  /** Called when a new image is uploaded or the current one is cleared. */
  onChange: (img: ReferenceImage) => void;
}

/** Result shape returned by the 'scan-faces' IPC handler. Mirrors FaceMetadata. */
interface FaceDetectionResult {
  hasFaces: boolean;
  faceCount: number;
  eyesOpen: boolean;
  blinkDetected: boolean;
  expressionNeutral: boolean;
  exceedsFaceLimit: boolean;
}

/** Local state machine for the face-detection test. */
type FaceTestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'result'; data: FaceDetectionResult }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_DIMENSION = 512;
const JPEG_QUALITY = 0.85;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const ACCEPTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the file extension (lowercase, with dot) from a filename. */
function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

/**
 * Resize an image so that its longest side is ≤ MAX_DIMENSION, then export as
 * a JPEG base64 string (without the data-URI prefix).
 */
function resizeImageToBase64(
  imgSrc: string,
): Promise<{ base64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;

      // Scale down if needed (without enlargement)
      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to create canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);

      // Export as JPEG, strip the data-URI prefix
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      resolve({ base64, width: w, height: h });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imgSrc;
  });
}

// ---------------------------------------------------------------------------
// Sub-component: FaceTestResult
// ---------------------------------------------------------------------------

interface FaceTestResultProps {
  data: FaceDetectionResult;
  onDismiss: () => void;
}

function FaceTestResult({ data, onDismiss }: FaceTestResultProps) {
  const noFaces = data.faceCount === 0;

  return (
    <div
      className={`
        rounded-xl border p-3 text-xs transition-colors
        ${noFaces
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
          : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
        }
      `}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {noFaces ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          )}
          <span
            className={`font-semibold ${
              noFaces
                ? 'text-amber-800 dark:text-amber-300'
                : 'text-emerald-800 dark:text-emerald-300'
            }`}
          >
            Face detection complete
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss face detection result"
          className="
            text-gray-400 dark:text-gray-500
            hover:text-gray-600 dark:hover:text-gray-300
            transition-colors rounded
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500
          "
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Result rows */}
      <div className="space-y-1">
        <ResultRow
          label="Faces detected"
          value={String(data.faceCount)}
          valueClass={
            noFaces
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-emerald-700 dark:text-emerald-400 font-semibold'
          }
        />
        <ResultRow
          label="Eyes open"
          value={noFaces ? '—' : data.eyesOpen ? 'Yes' : 'No'}
          valueClass={
            noFaces
              ? 'text-gray-400 dark:text-gray-600'
              : data.eyesOpen
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }
        />
        <ResultRow
          label="Blink detected"
          value={noFaces ? '—' : data.blinkDetected ? 'Yes' : 'No'}
          valueClass={
            noFaces
              ? 'text-gray-400 dark:text-gray-600'
              : data.blinkDetected
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }
        />
      </div>

      {/* Advisory — only when no faces found */}
      {noFaces && (
        <p className="mt-2.5 pt-2.5 border-t border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 leading-relaxed">
          No faces detected. Consider setting the{' '}
          <span className="font-semibold">Face &amp; Eyes</span> weight to{' '}
          <span className="font-semibold">0%</span> for this session, or try a
          different reference image with a clearly visible face.
        </p>
      )}
    </div>
  );
}

/** Single label/value row inside FaceTestResult. */
function ResultRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component: ReferenceImageUpload
// ---------------------------------------------------------------------------
export default function ReferenceImageUpload({
  value,
  onChange,
}: ReferenceImageUploadProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  // ── Face detection state ─────────────────────────────────────────────────
  const [faceTest, setFaceTest] = useState<FaceTestState>({ status: 'idle' });

  // Reset face-test state whenever the image changes (new upload or cleared).
  useEffect(() => {
    setFaceTest({ status: 'idle' });
  }, [value]);

  const dropZoneRef = useRef<HTMLDivElement>(null);

  // ── Process a file (from dialog or drag-and-drop) ─────────────────────────
  const processFile = useCallback(
    async (file: File) => {
      setError(null);

      // Validate type
      if (!ACCEPTED_MIME_TYPES.has(file.type)) {
        setError('Only JPEG and PNG images are supported.');
        return;
      }

      // Validate size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError('File is too large (max 50 MB).');
        return;
      }

      setIsLoading(true);
      try {
        // Read file as data URL
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        // Resize and convert to base64
        const { base64 } = await resizeImageToBase64(dataUrl);
        onChange({ filename: file.name, base64 });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process image');
      } finally {
        setIsLoading(false);
      }
    },
    [onChange],
  );

  // ── Process a file from an absolute path (IPC) ───────────────────────────
  const processFilePath = useCallback(
    async (filePath: string) => {
      setError(null);

      const basename = filePath.split(/[\\/]/).pop() || filePath;
      const ext = getExtension(basename);
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        setError('Only JPEG and PNG images are supported.');
        return;
      }

      setIsLoading(true);
      try {
        // Read file via IPC
        const base64Raw = await (window as any).electronAPI?.readFileAsBase64?.(filePath) as
          | string
          | undefined;

        if (!base64Raw) {
          throw new Error('Failed to read file from disk');
        }

        // Determine MIME from extension
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        const dataUrl = `data:${mime};base64,${base64Raw}`;

        // Resize and convert to base64
        const { base64 } = await resizeImageToBase64(dataUrl);
        onChange({ filename: basename, base64 });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process image');
      } finally {
        setIsLoading(false);
      }
    },
    [onChange],
  );

  // ── Upload via Electron file dialog ───────────────────────────────────────
  const handleUploadClick = useCallback(async () => {
    try {
      const result = await (window as any).electronAPI?.openFileDialog?.({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
        properties: ['openFile'],
      }) as { filePath?: string; cancelled?: boolean } | undefined;

      if (!result || result.cancelled || !result.filePath) return;
      await processFilePath(result.filePath);
    } catch {
      // If IPC is not wired yet, fall back to a hidden <input type="file">
      fileInputRef.current?.click();
    }
  }, [processFilePath]);

  // ── Fallback hidden file input (for when IPC isn't available) ─────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset input so re-selecting the same file triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [processFile],
  );

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only leave if we're actually leaving the drop zone (not entering a child)
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    onChange(null);
    setError(null);
  }, [onChange]);

  // ── Test face detection ───────────────────────────────────────────────────
  const handleTestFaces = useCallback(async () => {
    if (!value) return;
    setFaceTest({ status: 'loading' });
    try {
      const result = await (window as any).electronAPI?.scanFaces?.(
        value.base64,
        0, // maxFacesPerImage: 0 = no limit check during reference image test
      ) as FaceDetectionResult | undefined;

      if (!result) {
        throw new Error('No response from face detector');
      }

      setFaceTest({ status: 'result', data: result });
    } catch (err) {
      setFaceTest({
        status: 'error',
        message: err instanceof Error ? err.message : 'Face detection unavailable',
      });
    }
  }, [value]);

  // ── Render ────────────────────────────────────────────────────────────────

  // When an image is set, show the thumbnail preview
  if (value) {
    const thumbSrc = `data:image/jpeg;base64,${value.base64}`;
    return (
      <div className="space-y-3">
        {/* Thumbnail + info row */}
        <div className="flex items-center gap-4">
          {/* Thumbnail */}
          <div className="relative group shrink-0">
            <img
              src={thumbSrc}
              alt="Reference"
              className="w-[120px] h-[120px] object-cover rounded-xl border-2 border-amber-200 dark:border-amber-800/50 shadow-sm"
            />
            {/* Clear button overlay */}
            <button
              type="button"
              onClick={handleClear}
              aria-label="Remove reference image"
              className="
                absolute -top-2 -right-2 z-10
                w-6 h-6 flex items-center justify-center
                bg-red-500 hover:bg-red-600 active:bg-red-700
                text-white rounded-full shadow-md
                transition-all transform
                opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100
                focus-visible:opacity-100 focus-visible:scale-100
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2
                dark:focus-visible:ring-offset-[#161b27]
              "
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* File info */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {value.filename}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Reference image set
            </p>
            <button
              type="button"
              onClick={handleClear}
              className="
                mt-2 text-xs text-gray-400 dark:text-gray-500
                hover:text-red-500 dark:hover:text-red-400
                transition-colors flex items-center gap-1
              "
            >
              <X className="w-3 h-3" />
              Remove
            </button>
          </div>
        </div>

        {/* ── Test face detection ── */}
        <div>
          {/* Button — shown when idle or loading */}
          {(faceTest.status === 'idle' || faceTest.status === 'loading') && (
            <button
              type="button"
              onClick={handleTestFaces}
              disabled={faceTest.status === 'loading'}
              className="
                flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                border border-gray-200 dark:border-[#1e2535]
                bg-white dark:bg-[#161b27]
                text-gray-600 dark:text-gray-300
                hover:border-amber-400 dark:hover:border-amber-600
                hover:text-amber-600 dark:hover:text-amber-400
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2
                dark:focus-visible:ring-offset-[#161b27]
              "
            >
              {faceTest.status === 'loading' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                  Detecting…
                </>
              ) : (
                <>
                  <ScanFace className="w-3.5 h-3.5" />
                  Test face detection
                </>
              )}
            </button>
          )}

          {/* Result panel */}
          {faceTest.status === 'result' && (
            <FaceTestResult
              data={faceTest.data}
              onDismiss={() => setFaceTest({ status: 'idle' })}
            />
          )}

          {/* Error state */}
          {faceTest.status === 'error' && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 px-3 py-2">
              <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {faceTest.message}
              </p>
              <button
                type="button"
                onClick={() => setFaceTest({ status: 'idle' })}
                aria-label="Dismiss error"
                className="
                  text-red-400 dark:text-red-600
                  hover:text-red-600 dark:hover:text-red-400
                  transition-colors rounded
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
                "
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Info tooltip */}
        <InfoTooltipRow showTooltip={showTooltip} setShowTooltip={setShowTooltip} />
      </div>
    );
  }

  // Empty state — upload area
  return (
    <div className="space-y-3">
      {/* Hidden file input fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        className="sr-only"
        onChange={handleFileInputChange}
        tabIndex={-1}
      />

      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleUploadClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleUploadClick();
          }
        }}
        className={`
          relative flex flex-col items-center justify-center gap-3
          px-6 py-8 rounded-xl
          border-2 border-dashed transition-all cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2
          dark:focus-visible:ring-offset-[#161b27]
          ${isDragOver
            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20 scale-[1.01]'
            : 'border-gray-300 dark:border-[#2a3040] hover:border-amber-400 dark:hover:border-amber-600 bg-gray-50/50 dark:bg-[#0f1117]/50 hover:bg-amber-50/30 dark:hover:bg-amber-950/10'
          }
          ${isLoading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Processing image…</p>
          </>
        ) : (
          <>
            <div
              className={`
                p-3 rounded-xl transition-colors
                ${isDragOver
                  ? 'bg-amber-100 dark:bg-amber-900/40'
                  : 'bg-gray-100 dark:bg-[#1a1f2e]'
                }
              `}
            >
              {isDragOver ? (
                <Upload className="w-6 h-6 text-amber-500" />
              ) : (
                <ImageIcon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isDragOver ? 'Drop image here' : 'Upload Reference Image'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Drag & drop or click to browse · JPEG, PNG
              </p>
            </div>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          {error}
        </p>
      )}

      {/* Info tooltip */}
      <InfoTooltipRow showTooltip={showTooltip} setShowTooltip={setShowTooltip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info tooltip sub-component (unchanged)
// ---------------------------------------------------------------------------
function InfoTooltipRow({
  showTooltip,
  setShowTooltip,
}: {
  showTooltip: boolean;
  setShowTooltip: (v: boolean) => void;
}) {
  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-label="Reference image info"
        className="
          text-gray-400 dark:text-gray-500
          hover:text-amber-500 dark:hover:text-amber-400
          transition-colors rounded
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500
        "
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      <span className="text-xs text-gray-400 dark:text-gray-500">
        How is the reference image used?
      </span>

      {/* Tooltip popup */}
      {showTooltip && (
        <div
          role="tooltip"
          className="
            absolute left-0 bottom-full mb-2 z-30
            w-72 px-3 py-2.5
            bg-gray-900 dark:bg-[#1e2535]
            text-white text-xs leading-relaxed
            rounded-lg shadow-xl shadow-black/20
            pointer-events-none
          "
        >
          Reference image will be sent to AI during Discovery Pass to guide
          scoring. The AI will use it to understand your preferred style,
          lighting, and composition.
          {/* Arrow */}
          <div className="absolute left-4 top-full w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-900 dark:border-t-[#1e2535]" />
        </div>
      )}
    </div>
  );
}