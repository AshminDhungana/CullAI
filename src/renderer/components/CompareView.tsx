/**
 * CompareView.tsx
 *
 * Phase 12 — Side-by-side comparison screen for 2-4 selected images.
 * Shows detailed score breakdowns, per-dimension mini-bars, face overlays,
 * and allows quick tier adjustment (P/X/R or button clicks) side-by-side.
 */

import { useState, useRef, useEffect } from 'react';
import { X, Star, Sparkles, Camera, Focus, Sun, Eye, ChevronLeft } from 'lucide-react';
import type { ScoreRecord } from '../../shared/types';
import FaceOverlay from './FaceOverlay';

interface CompareViewProps {
  selectedItems: { id: string; record: ScoreRecord }[];
  outputFolder: string;
  onClose: () => void;
  onUpdateTier: (imageId: string, newTier: 'S' | 'A' | 'B' | 'rejected') => void;
}

const TIER_COLORS: Record<string, { bg: string; border: string; text: string; buttonActive: string }> = {
  S: { bg: 'bg-amber-500/20', border: 'border-amber-400', text: 'text-amber-300', buttonActive: 'bg-amber-500 text-black border-amber-400' },
  A: { bg: 'bg-emerald-500/20', border: 'border-emerald-400', text: 'text-emerald-300', buttonActive: 'bg-emerald-500 text-black border-emerald-400' },
  B: { bg: 'bg-sky-500/20', border: 'border-sky-400', text: 'text-sky-300', buttonActive: 'bg-sky-500 text-white border-sky-400' },
  rejected: { bg: 'bg-red-500/20', border: 'border-red-500/60', text: 'text-red-400', buttonActive: 'bg-red-500 text-white border-red-500' },
};

const SCORE_DIMS = [
  { key: 'quality' as const, label: 'Quality', icon: Star, color: 'bg-violet-400' },
  { key: 'aesthetic' as const, label: 'Aesthetic', icon: Sparkles, color: 'bg-pink-400' },
  { key: 'composition' as const, label: 'Composition', icon: Camera, color: 'bg-blue-400' },
  { key: 'sharpness' as const, label: 'Sharpness', icon: Focus, color: 'bg-emerald-400' },
  { key: 'exposure' as const, label: 'Exposure', icon: Sun, color: 'bg-amber-400' },
  { key: 'faceEyes' as const, label: 'Face/Eyes', icon: Eye, color: 'bg-cyan-400' },
];

export default function CompareView({
  selectedItems,
  outputFolder,
  onClose,
  onUpdateTier,
}: CompareViewProps) {
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  const imgRefs = useRef<Record<string, HTMLImageElement | null>>({});

  // ── 12b.3 — Before/After Slider (2-image mode only) ──────────────────────
  const [sliderMode, setSliderMode] = useState(false);
  const [sliderPct, setSliderPct] = useState(50);
  const isDragging = useRef(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Reset slider when selection changes
  useEffect(() => {
    setSliderPct(50);
    setSliderMode(false);
  }, [selectedItems]);

  // Determine grid layout based on selection count
  const count = selectedItems.length;
  let gridClass = 'grid-cols-2';
  if (count === 3) gridClass = 'grid-cols-3';
  if (count === 4) gridClass = 'grid-cols-2 grid-rows-2';

  if (count === 0) {
    return (
      <div className="absolute inset-0 bg-[#0b0d13] flex flex-col items-center justify-center text-white/50 p-6 z-40">
        <p>No images selected for comparison.</p>
        <button
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition"
        >
          Back to Gallery
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-[#0b0d13]/98 backdrop-blur-md flex flex-col z-40 text-white animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition"
            aria-label="Back to gallery"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-lg font-semibold tracking-tight">Compare View ({count} images)</h2>
          {count === 2 && (
            <button
              onClick={() => setSliderMode(m => !m)}
              className={`ml-4 px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                sliderMode
                  ? 'bg-amber-500 border-amber-400 text-black'
                  : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
              }`}
            >
              {sliderMode ? 'Exit Slider' : 'Split-screen Slider'}
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition"
          aria-label="Close comparison"
        >
          <X size={20} />
        </button>
      </div>

      {/* Slider mode (2-image only) OR normal grid */}
      {sliderMode && count === 2 ? (
        <div
          ref={sliderRef}
          className="flex-1 relative overflow-hidden select-none cursor-col-resize"
          onMouseDown={(e) => { isDragging.current = true; e.preventDefault(); }}
          onMouseMove={(e) => {
            if (!isDragging.current || !sliderRef.current) return;
            const rect = sliderRef.current.getBoundingClientRect();
            const pct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
            setSliderPct(pct);
          }}
          onMouseUp={() => { isDragging.current = false; }}
          onMouseLeave={() => { isDragging.current = false; }}
        >
          {/* LEFT image — clipped to sliderPct% */}
          {(() => {
            const { record: leftRecord } = selectedItems[0];
            const leftSrc = leftRecord.thumbnailPath
              ? `file:///${outputFolder.replace(/\\/g, '/')}/${leftRecord.thumbnailPath}`
              : undefined;
            return (
              <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}>
                {leftSrc
                  ? <img src={leftSrc} alt={leftRecord.filename} className="w-full h-full object-contain" draggable={false} />
                  : <div className="w-full h-full bg-black/40 flex items-center justify-center text-white/30 text-sm">No preview</div>
                }
                <div className="absolute bottom-3 left-3 px-2 py-0.5 text-xs font-bold bg-black/70 rounded text-amber-300 truncate max-w-[45%]">
                  {leftRecord.filename}
                </div>
              </div>
            );
          })()}

          {/* RIGHT image */}
          {(() => {
            const { record: rightRecord } = selectedItems[1];
            const rightSrc = rightRecord.thumbnailPath
              ? `file:///${outputFolder.replace(/\\/g, '/')}/${rightRecord.thumbnailPath}`
              : undefined;
            return (
              <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 0 0 ${sliderPct}%)` }}>
                {rightSrc
                  ? <img src={rightSrc} alt={rightRecord.filename} className="w-full h-full object-contain" draggable={false} />
                  : <div className="w-full h-full bg-black/40 flex items-center justify-center text-white/30 text-sm">No preview</div>
                }
                <div className="absolute bottom-3 right-3 px-2 py-0.5 text-xs font-bold bg-black/70 rounded text-sky-300 truncate max-w-[45%]">
                  {rightRecord.filename}
                </div>
              </div>
            );
          })()}

          {/* Draggable divider line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.5)] pointer-events-none"
            style={{ left: `${sliderPct}%` }}
          >
            {/* Handle */}
            <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border-2 border-white flex items-center justify-center shadow-lg">
              <span className="text-black text-[10px] font-bold select-none">⇔</span>
            </div>
          </div>
        </div>
      ) : (
        /* Grid container */
        <div className={`flex-1 p-6 grid gap-6 ${gridClass} overflow-hidden min-h-0`}>
        {selectedItems.map(({ id, record }) => {
          const tierStyle = TIER_COLORS[record.tier] ?? TIER_COLORS.rejected;
          const thumbnailSrc = record.thumbnailPath
            ? `file:///${outputFolder.replace(/\\/g, '/')}/${record.thumbnailPath}`
            : undefined;

          return (
            <div
              key={id}
              className={`flex flex-col bg-white/[0.02] border border-white/10 rounded-xl overflow-hidden min-h-0`}
              onMouseEnter={() => setHoveredImageId(id)}
              onMouseLeave={() => setHoveredImageId(null)}
            >
              {/* Image Preview Window */}
              <div className="relative flex-1 bg-black/40 min-h-0 overflow-hidden flex items-center justify-center">
                {thumbnailSrc ? (
                  <img
                    ref={(el) => {
                      imgRefs.current[id] = el;
                    }}
                    src={thumbnailSrc}
                    alt={record.filename}
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="text-white/30 text-sm">No preview available</div>
                )}

                {/* Bounding box face overlay */}
                {hoveredImageId === id && record.faceMetadata?.hasFaces && imgRefs.current[id] && (
                  <FaceOverlay
                    faceMetadata={record.faceMetadata}
                    containerWidth={imgRefs.current[id]!.clientWidth}
                    containerHeight={imgRefs.current[id]!.clientHeight}
                  />
                )}

                {/* Top Overlay Badge / Score */}
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className={`px-2 py-0.5 text-xs font-bold rounded border ${tierStyle.bg} ${tierStyle.border} ${tierStyle.text}`}>
                    Tier {record.tier === 'rejected' ? 'Rejected' : record.tier}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-mono font-bold bg-black/70 rounded border border-white/10">
                    Score: {record.total}
                  </span>
                </div>

                <div className="absolute top-3 right-3 truncate max-w-[60%] px-2 py-0.5 text-[11px] font-mono text-white/60 bg-black/50 rounded backdrop-blur-sm">
                  {record.filename}
                </div>
              </div>

              {/* Detail & Quick Controls Area */}
              <div className="p-4 bg-black/30 border-t border-white/10 flex flex-col gap-3 shrink-0">
                {/* Manual Tier Adjustment Buttons */}
                <div className="flex gap-2 items-center">
                  <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold mr-1">Assign Tier:</span>
                  {(['S', 'A', 'B', 'rejected'] as const).map((t) => {
                    const active = record.tier === t;
                    const style = TIER_COLORS[t];
                    return (
                      <button
                        key={t}
                        onClick={() => onUpdateTier(id, t)}
                        className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                          active
                            ? style.buttonActive
                            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {t === 'rejected' ? 'R' : t}
                      </button>
                    );
                  })}
                </div>

                {/* Score breakdown bar charts */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-white/5 pt-3">
                  {SCORE_DIMS.map(({ key, label, icon: Icon, color }) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <Icon size={12} className="text-white/40 shrink-0" />
                      <span className="text-white/60 truncate flex-1">{label}</span>
                      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0">
                        <div
                          className={`h-full ${color} rounded-full`}
                          style={{ width: `${record.scores[key]}%` }}
                        />
                      </div>
                      <span className="w-6 text-right font-mono font-bold text-white/80">{record.scores[key]}</span>
                    </div>
                  ))}
                </div>

                {/* AI Reasoning Text */}
                <div className="border-t border-white/5 pt-2 text-[11px] text-white/50 leading-relaxed italic max-h-16 overflow-y-auto">
                  "{record.reasoning || 'No reasoning provided.'}"
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}