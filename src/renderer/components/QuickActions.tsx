/**
 * src/renderer/components/QuickActions.tsx
 *
 * Phase 20.3 — Quick Action Buttons / Context Menu
 *
 * Renders a small floating action panel or context menu near the cursor with
 * actions: Open containing folder, Copy filename, Copy path, View in Lightroom.
 *
 * Designed to be used from both a right-click context menu (ImageTile)
 * and a floating action button bar (Results screen).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { FolderOpen, Copy, FileText, ExternalLink } from 'lucide-react';

interface QuickActionsProps {
  /** Absolute path to the original image file. */
  filePath: string;
  /** The filename (basename) for display / copy. */
  filename: string;
  /** Position near which to render the floating panel (optional — for context menu). */
  position?: { x: number; y: number };
  /** Called when the user requests to close the panel (e.g. clicking away). */
  onClose: () => void;
}

export default function QuickActions({ filePath, filename, position, onClose }: QuickActionsProps) {
  const [toast, setToast] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click-outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    setTimeout(() => {
      window.addEventListener('click', handleClick);
      window.addEventListener('keydown', handleKey);
    }, 10);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.openContainingFolder(filePath);
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to open folder');
    }
  };

  const handleCopyFilename = async () => {
    try {
      await window.electronAPI.copyToClipboard(filename);
      showToast('Filename copied to clipboard');
    } catch {
      showToast('Failed to copy filename');
    }
  };

  const handleCopyPath = async () => {
    try {
      await window.electronAPI.copyToClipboard(filePath);
      showToast('Full path copied to clipboard');
    } catch {
      showToast('Failed to copy path');
    }
  };

  const handleViewInLightroom = async () => {
    try {
      const res = await window.electronAPI.viewInLightroomReminder();
      showToast(res.message);
    } catch {
      showToast('Lightroom reminder failed');
    }
  };

  const style = position
    ? ({ position: 'absolute', left: position.x, top: position.y, zIndex: 50 } as React.CSSProperties)
    : ({} as React.CSSProperties);

  return (
    <div ref={panelRef} style={style} className="bg-[#10131e] border border-white/10 rounded-lg shadow-xl text-white text-xs overflow-hidden min-w-[200px]">
      <div className="py-1">
        <button
          onClick={handleOpenFolder}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition text-left"
        >
          <FolderOpen size={14} className="text-amber-400 shrink-0" />
          <span>Open containing folder</span>
        </button>
        <button
          onClick={handleCopyFilename}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition text-left"
        >
          <Copy size={14} className="text-sky-400 shrink-0" />
          <span>Copy filename</span>
        </button>
        <button
          onClick={handleCopyPath}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition text-left"
        >
          <FileText size={14} className="text-emerald-400 shrink-0" />
          <span>Copy full path</span>
        </button>
        <button
          onClick={handleViewInLightroom}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition text-left"
        >
          <ExternalLink size={14} className="text-purple-400 shrink-0" />
          <span>View in Lightroom</span>
        </button>
      </div>
      {toast && (
        <div className="px-3 py-1.5 bg-amber-500/10 text-amber-400 text-[10px] text-center border-t border-white/5">
          {toast}
        </div>
      )}
    </div>
  );
}
