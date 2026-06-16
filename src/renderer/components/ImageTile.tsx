/**
 * ImageTile.tsx
 *
 * Phase 12 — Gallery card component for a single scored image.
 * Displays thumbnail, tier badge, composite score, per-dimension mini bars,
 * expandable reasoning, and face overlay on hover.
 */

import { useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronUp, Eye, Star, Sparkles, Camera, Sun, Focus } from 'lucide-react';
import FaceOverlay from './FaceOverlay';
import QuickActions from './QuickActions';
import type { ScoreRecord } from '../../shared/types';

// ── Tier styling maps ──────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  S: {
    bg: 'bg-amber-500/20',
    border: 'border-amber-400',
    text: 'text-amber-300',
    glow: 'shadow-amber-500/30',
  },
  A: {
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-400',
    text: 'text-emerald-300',
    glow: 'shadow-emerald-500/30',
  },
  B: {
    bg: 'bg-sky-500/20',
    border: 'border-sky-400',
    text: 'text-sky-300',
    glow: 'shadow-sky-500/30',
  },
  rejected: {
    bg: 'bg-red-500/20',
    border: 'border-red-500/60',
    text: 'text-red-400',
    glow: 'shadow-red-500/20',
  },
};

const TIER_LABELS: Record<string, string> = {
  S: 'S',
  A: 'A',
  B: 'B',
  rejected: 'R',
};

// ── Score dimension config ─────────────────────────────────────────────────────

const SCORE_DIMS = [
  { key: 'quality' as const, label: 'Quality', icon: Star, color: 'bg-violet-400' },
  { key: 'aesthetic' as const, label: 'Aesthetic', icon: Sparkles, color: 'bg-pink-400' },
  { key: 'composition' as const, label: 'Composition', icon: Camera, color: 'bg-blue-400' },
  { key: 'sharpness' as const, label: 'Sharpness', icon: Focus, color: 'bg-emerald-400' },
  { key: 'exposure' as const, label: 'Exposure', icon: Sun, color: 'bg-amber-400' },
  { key: 'faceEyes' as const, label: 'Face/Eyes', icon: Eye, color: 'bg-cyan-400' },
];

// ── Props ──────────────────────────────────────────────────────────────────────

interface ImageTileProps {
  score: ScoreRecord;
  imageId: string;
  outputFolder: string;
  /** Absolute path to the original image on disk (for QuickActions). */
  filePath?: string;
  isSelected: boolean;
  isFocused: boolean;
  onClick: (e: React.MouseEvent) => void;
}

export default function ImageTile({
  score,
  imageId,
  outputFolder,
  filePath,
  isSelected,
  isFocused,
  onClick,
}: ImageTileProps) {
  const [expanded, setExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const tierStyle = TIER_COLORS[score.tier] ?? TIER_COLORS.rejected;

  // ── Thumbnail src ──────────────────────────────────────────────────────────
  // Use the persisted thumbnailPath (same pattern as CompareView.tsx).
  // Falls back to no preview if the thumbnail was not generated.
  const thumbnailSrc = score.thumbnailPath
    ? `file:///${encodeURI(`${outputFolder.replace(/\\/g, '/')}/${score.thumbnailPath}`)}`
    : undefined;
  const [thumbnailError, setThumbnailError] = useState(false);

  // ── Reasoning toggle ───────────────────────────────────────────────────────
  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  // ── Quick actions (Phase 20.3) — right-click context menu ──────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!filePath) return;
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, [filePath]);

  return (
    <div
      ref={tileRef}
      className={[
        'group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200',
        'bg-white/5 dark:bg-white/[0.03] backdrop-blur-sm',
        'border',
        isSelected
          ? `${tierStyle.border} ${tierStyle.glow} shadow-lg ring-2 ring-amber-400/40`
          : isFocused
            ? 'border-white/30 shadow-md ring-1 ring-white/20'
            : 'border-white/10 hover:border-white/20 hover:shadow-md',
        'hover:scale-[1.02]',
      ].join(' ')}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      role="button"
      tabIndex={0}
      aria-label={`${score.filename} — Tier ${score.tier}, Score ${score.total}`}
    >
      {/* ── Thumbnail ──────────────────────────────────────────────────────── */}
      <div className="relative aspect-[4/3] bg-black/40 overflow-hidden">
        {thumbnailSrc && !thumbnailError ? (
          <img
            ref={imgRef}
            src={thumbnailSrc}
            alt={score.filename}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            draggable={false}
            onError={() => setThumbnailError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
            No preview
          </div>
        )}

        {/* Face overlay on hover */}
        {isHovering && score.faceMetadata?.hasFaces && imgRef.current && (
          <FaceOverlay
            faceMetadata={score.faceMetadata}
            containerWidth={imgRef.current.clientWidth}
            containerHeight={imgRef.current.clientHeight}
          />
        )}

        {/* Tier badge */}
        <div
          className={`absolute top-2 left-2 ${tierStyle.bg} ${tierStyle.border} border ${tierStyle.text} rounded-md px-2 py-0.5 text-xs font-bold backdrop-blur-sm`}
        >
          {TIER_LABELS[score.tier] ?? 'R'}
        </div>

        {/* Score badge */}
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-md px-2 py-0.5 text-white text-xs font-mono font-bold">
          {score.total}
        </div>
      </div>

      {/* ── Info panel ─────────────────────────────────────────────────────── */}
      <div className="p-3 space-y-2">
        {/* Filename */}
        <p className="text-xs text-white/70 truncate font-medium" title={score.filename}>
          {score.filename}
        </p>

        {/* Mini score bars */}
        <div className="space-y-1">
          {SCORE_DIMS.map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[9px] text-white/40 w-16 truncate">{label}</span>
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full ${color} rounded-full transition-all duration-500`}
                  style={{ width: `${score.scores[key]}%` }}
                />
              </div>
              <span className="text-[9px] text-white/50 w-5 text-right font-mono">
                {score.scores[key]}
              </span>
            </div>
          ))}
        </div>

        {/* Keywords */}
        {score.keywords && score.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {score.keywords.slice(0, 4).map((kw) => (
              <span
                key={kw}
                className="text-[9px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-md"
              >
                {kw}
              </span>
            ))}
          </div>
        )}

        {/* Expandable reasoning */}
        <button
          onClick={toggleExpanded}
          className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/60 transition-colors w-full"
        >
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          <span>{expanded ? 'Hide reasoning' : 'Show reasoning'}</span>
        </button>

        {expanded && (
          <p className="text-[10px] text-white/50 leading-relaxed border-t border-white/10 pt-2 max-h-24 overflow-y-auto">
            {score.reasoning || 'No reasoning provided.'}
          </p>
        )}
      </div>

      {/* Phase 20.3 — Quick Actions context menu */}
      {contextMenuPos && filePath && (
        <QuickActions
          filePath={filePath}
          filename={score.filename}
          position={contextMenuPos}
          onClose={() => setContextMenuPos(null)}
        />
      )}
    </div>
  );
}