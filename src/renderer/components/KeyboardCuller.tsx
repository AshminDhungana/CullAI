/**
 * KeyboardCuller.tsx
 *
 * Phase 12 — Global keyboard shortcut listener and overlay legend.
 * Binds keys:
 *   - Arrow keys (Left/Right/Up/Down) to navigate focus in the grid.
 *   - P or 1: S-tier (Pick)
 *   - A or 2: A-tier
 *   - B or R or 3: B-tier (Rescue)
 *   - X or Backspace or 4: Rejected (Reject)
 *   - Space: Toggle multi-select checkbox on focused image
 *   - C: Compare selected images (opens comparison)
 *   - Esc: Close compare view / clear selection
 */

import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardCullerProps {
  enabled: boolean;
  onNavigate: (direction: 'left' | 'right' | 'up' | 'down') => void;
  onAssignTier: (tier: 'S' | 'A' | 'B' | 'rejected') => void;
  onToggleSelect: () => void;
  onCompare: () => void;
  onEscape: () => void;
}

export default function KeyboardCuller({
  enabled,
  onNavigate,
  onAssignTier,
  onToggleSelect,
  onCompare,
  onEscape,
}: KeyboardCullerProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events if the user is typing in a text field or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        // Navigation
        case 'ArrowLeft':
          e.preventDefault();
          onNavigate('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onNavigate('right');
          break;
        case 'ArrowUp':
          e.preventDefault();
          onNavigate('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          onNavigate('down');
          break;

        // Tier Rating
        case 'p':
        case 'P':
        case '1':
          e.preventDefault();
          onAssignTier('S');
          break;
        case 'a':
        case 'A':
        case '2':
          e.preventDefault();
          onAssignTier('A');
          break;
        case 'b':
        case 'B':
        case 'r':
        case 'R':
        case '3':
          e.preventDefault();
          onAssignTier('B');
          break;
        case 'x':
        case 'X':
        case 'Backspace':
        case '4':
          e.preventDefault();
          onAssignTier('rejected');
          break;

        // Selection / Actions
        case ' ':
          e.preventDefault();
          onToggleSelect();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          onCompare();
          break;
        case 'Escape':
          e.preventDefault();
          onEscape();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onNavigate, onAssignTier, onToggleSelect, onCompare, onEscape]);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 z-30 p-2.5 bg-black/60 hover:bg-black/80 text-amber-400 border border-amber-500/30 hover:border-amber-400 rounded-full backdrop-blur-md shadow-lg transition-all"
        title="Show keyboard shortcuts help"
      >
        <Keyboard size={18} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 w-72 bg-[#10131e]/90 hover:bg-[#10131e]/95 border border-white/10 rounded-xl p-4 shadow-xl backdrop-blur-md transition-all animate-fade-in text-white text-xs">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2.5">
        <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
          <Keyboard size={14} />
          <span>Keyboard Shortcuts</span>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="text-white/40 hover:text-white/80 p-0.5 rounded transition"
          aria-label="Hide shortcuts"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-1.5 text-white/70">
        <div className="flex justify-between items-center">
          <span>Navigate focus</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">← → ↑ ↓</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>Toggle comparison select</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">Space</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>S-Tier (Pick)</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">P or 1</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>A-Tier</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">A or 2</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>B-Tier (Rescue)</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">B, R or 3</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>Rejected (Reject)</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">X, Backspace or 4</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>Compare Selected</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">C</kbd>
        </div>
        <div className="flex justify-between items-center">
          <span>Close Compare / Clear</span>
          <kbd className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded font-mono text-[10px]">Esc</kbd>
        </div>
      </div>
    </div>
  );
}
