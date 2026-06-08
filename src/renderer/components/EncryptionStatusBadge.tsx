/**
 * EncryptionStatusBadge.tsx
 *
 * Displays the OS keychain encryption availability status inline in the AI
 * setup step. Queries the main process once on mount via the
 * 'safe-storage-available' IPC channel and renders one of two states:
 *
 *   ✓ API keys encrypted via OS keychain       (green — encryption available)
 *   ⚠ OS keychain unavailable — session only   (amber — encryption not available)
 *
 * This gives developers and advanced users immediate visual confirmation on
 * each platform, and gives end users a clear explanation when on a system
 * without a running keyring daemon.
 *
 * Design: matches the CullAI amber/dark palette and the Key badge already
 * present in the API key label. No external deps beyond lucide-react.
 */

import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';

type EncryptionState = 'loading' | 'available' | 'unavailable';

export default function EncryptionStatusBadge() {
  const [state, setState] = useState<EncryptionState>('loading');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        // @ts-expect-error — electronAPI injected by preload
        const available: boolean = await window.electronAPI?.isSafeStorageAvailable?.();
        if (!cancelled) {
          setState(available ? 'available' : 'unavailable');
        }
      } catch {
        if (!cancelled) {
          // IPC bridge not available (e.g. running in browser during dev).
          // Show unavailable rather than crashing.
          setState('unavailable');
        }
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  // Loading — show a minimal spinner so the label area doesn't jump.
  if (state === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking keychain…
      </span>
    );
  }

  // Encryption available — green success badge.
  if (state === 'available') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-normal text-emerald-600 dark:text-emerald-400"
        title="Your OS keychain (DPAPI / Keychain / kwallet) is available. API keys are encrypted at rest."
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        Stored in OS keychain
      </span>
    );
  }

  // Encryption unavailable — amber warning badge with tooltip detail.
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-normal text-amber-600 dark:text-amber-400"
      title={
        'OS keychain encryption is not available on this machine.\n' +
        'API keys will be held in memory only for this session and\n' +
        'will not persist between restarts.\n\n' +
        'Linux users: ensure gnome-keyring-daemon or kwalletd is running.'
      }
    >
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
      Session only — keychain unavailable
    </span>
  );
}