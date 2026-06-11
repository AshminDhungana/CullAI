/**
 * src/renderer/components/StyleProfileManager.tsx
 *
 * Phase 14.1 / 14.2 — Saved Style Profiles
 *
 * Renders a collapsible card on the Setup scoring step that lets the user:
 *   • View saved profiles (name, genre badge, dates)
 *   • Load a profile into the form (genre + weights + preferenceText)
 *   • Create a new profile from the current form state
 *   • Rename a profile inline
 *   • Delete a profile with inline confirmation
 *
 * Free tier: max 2 profiles. Saving beyond that shows an inline upgrade prompt.
 * Pro / Lifetime: unlimited.
 *
 * IPC bridge (window.electronAPI):
 *   profilesList()          → Promise<StyleProfile[]>
 *   profilesSave(profile)   → Promise<true>
 *   profilesDelete(id)      → Promise<true>
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  X,
  Trash2,
  Pencil,
  Loader2,
  Zap,
} from 'lucide-react';
import type { StyleProfile, GenrePreset, ScoringWeights } from '../../shared/types';
import type { LicenseTier } from '../../shared/license';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StyleProfileManagerProps {
  currentGenre: GenrePreset;
  currentWeights: ScoringWeights;
  currentPreferenceText: string;
  activeProfileId: string | null;
  onLoad: (profile: StyleProfile) => void;
  onActiveProfileChange: (id: string | null) => void;
  tier: LicenseTier;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GENRE_COLORS: Record<GenrePreset, string> = {
  general:   'bg-gray-500/15 text-gray-400 border-gray-500/20',
  wedding:   'bg-pink-500/15 text-pink-400 border-pink-500/20',
  portrait:  'bg-violet-500/15 text-violet-400 border-violet-500/20',
  sports:    'bg-orange-500/15 text-orange-400 border-orange-500/20',
  landscape: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  street:    'bg-sky-500/15 text-sky-400 border-sky-500/20',
  event:     'bg-amber-500/15 text-amber-400 border-amber-500/20',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function defaultProfileName(genre: GenrePreset): string {
  const month = new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });
  return `${capitalize(genre)} — ${month}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StyleProfileManager({
  currentGenre,
  currentWeights,
  currentPreferenceText,
  activeProfileId,
  onLoad,
  onActiveProfileChange,
  tier,
}: StyleProfileManagerProps) {
  const [isOpen,        setIsOpen]        = useState(false);
  const [profiles,      setProfiles]      = useState<StyleProfile[]>([]);
  const [isLoading,     setIsLoading]     = useState(false);

  // ── Save-new state ─────────────────────────────────────────────────────────
  const [isSaving,      setIsSaving]      = useState(false);
  const [showNewForm,   setShowNewForm]   = useState(false);
  const [newName,       setNewName]       = useState('');
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  // ── Rename state ───────────────────────────────────────────────────────────
  const [renamingId,    setRenamingId]    = useState<string | null>(null);
  const [renameValue,   setRenameValue]   = useState('');
  const [isRenaming,    setIsRenaming]    = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  // ── Delete state ───────────────────────────────────────────────────────────
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting,      setIsDeleting]      = useState(false);

  // ── Load state ─────────────────────────────────────────────────────────────
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch profiles
  // ---------------------------------------------------------------------------

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      // @ts-expect-error — electronAPI bridge
      const list: StyleProfile[] = await window.electronAPI.profilesList();
      // Newest first
      setProfiles([...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ));
    } catch (err) {
      console.error('[StyleProfileManager] profilesList failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchProfiles();
  }, [isOpen, fetchProfiles]);

  // Focus the new-name input when it appears
  useEffect(() => {
    if (showNewForm) {
      setTimeout(() => newNameRef.current?.focus(), 50);
    }
  }, [showNewForm]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameRef.current?.focus(), 50);
    }
  }, [renamingId]);

  // ---------------------------------------------------------------------------
  // Load a profile into the form
  // ---------------------------------------------------------------------------

  const handleLoad = useCallback(async (profile: StyleProfile) => {
    setLoadingId(profile.id);
    try {
      // Update lastUsedAt
      const updated: StyleProfile = { ...profile, lastUsedAt: new Date().toISOString() };
      // @ts-expect-error — electronAPI bridge
      await window.electronAPI.profilesSave(updated);
      setProfiles(prev => prev.map(p => p.id === profile.id ? updated : p));

      onLoad(updated);
      onActiveProfileChange(profile.id);
    } catch (err) {
      console.error('[StyleProfileManager] load failed:', err);
    } finally {
      setLoadingId(null);
    }
  }, [onLoad, onActiveProfileChange]);

  // ---------------------------------------------------------------------------
  // Save current settings as a new profile
  // ---------------------------------------------------------------------------

  const handleOpenNewForm = useCallback(() => {
    setNewName(defaultProfileName(currentGenre));
    setSaveError(null);
    setShowNewForm(true);
  }, [currentGenre]);

  const handleSaveNew = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    // Free tier gate
    if (tier === 'free' && profiles.length >= 2) {
      setSaveError('Free plan allows 2 profiles. Upgrade to Pro for unlimited profiles.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const newProfile: StyleProfile = {
        id: crypto.randomUUID(),
        name,
        genre: currentGenre,
        weights: currentWeights,
        preferenceText: currentPreferenceText,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      // @ts-expect-error — electronAPI bridge
      await window.electronAPI.profilesSave(newProfile);
      setProfiles(prev => [newProfile, ...prev]);
      setShowNewForm(false);
      setNewName('');
      onActiveProfileChange(newProfile.id);
    } catch (err: any) {
      setSaveError(`Save failed: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  }, [newName, tier, profiles.length, currentGenre, currentWeights, currentPreferenceText, onActiveProfileChange]);

  // ---------------------------------------------------------------------------
  // Rename
  // ---------------------------------------------------------------------------

  const handleStartRename = useCallback((profile: StyleProfile) => {
    setDeleteConfirmId(null);
    setRenamingId(profile.id);
    setRenameValue(profile.name);
  }, []);

  const handleCommitRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!name || !renamingId) {
      setRenamingId(null);
      return;
    }
    setIsRenaming(true);
    try {
      const target = profiles.find(p => p.id === renamingId);
      if (!target) return;
      const updated: StyleProfile = { ...target, name };
      // @ts-expect-error — electronAPI bridge
      await window.electronAPI.profilesSave(updated);
      setProfiles(prev => prev.map(p => p.id === renamingId ? updated : p));
      setRenamingId(null);
    } catch (err) {
      console.error('[StyleProfileManager] rename failed:', err);
      setRenamingId(null);
    } finally {
      setIsRenaming(false);
    }
  }, [renameValue, renamingId, profiles]);

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = useCallback(async (id: string) => {
    setIsDeleting(true);
    try {
      // @ts-expect-error — electronAPI bridge
      await window.electronAPI.profilesDelete(id);
      setProfiles(prev => prev.filter(p => p.id !== id));
      setDeleteConfirmId(null);
      if (activeProfileId === id) onActiveProfileChange(null);
    } catch (err) {
      console.error('[StyleProfileManager] delete failed:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [activeProfileId, onActiveProfileChange]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const canSaveNew = tier !== 'free' || profiles.length < 2;

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white dark:bg-[#161b27] rounded-2xl border border-gray-200 dark:border-[#1e2535] overflow-hidden">
      {/* ── Header / toggle ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 dark:bg-amber-900/25 rounded-xl shrink-0">
            <Bookmark className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
              Style Profiles
              {activeProfileId && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400">
                  <Check className="w-2.5 h-2.5" />
                  Active
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {profiles.length > 0 && !isOpen
                ? `${profiles.length} saved profile${profiles.length !== 1 ? 's' : ''}`
                : 'Save and reuse genre, weights & style text'}
            </p>
          </div>
        </div>
        <div className="text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="profile-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 dark:border-white/5 px-5 pt-4 pb-5 space-y-3">

              {/* ── Profile list ──────────────────────────────────────── */}
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              ) : profiles.length === 0 ? (
                <div className="text-center py-5">
                  <Bookmark className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 dark:text-gray-400">No profiles saved yet.</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    Save your current genre, weights, and style text for quick reuse.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {profiles.map(profile => {
                    const isActive   = profile.id === activeProfileId;
                    const isDelConf  = deleteConfirmId === profile.id;
                    const isRenaming_ = renamingId === profile.id;
                    const isLoadingThis = loadingId === profile.id;

                    return (
                      <li
                        key={profile.id}
                        className={`rounded-xl border transition-all ${
                          isActive
                            ? 'border-amber-500/40 bg-amber-500/[0.06]'
                            : 'border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-white/[0.02]'
                        }`}
                      >
                        <div className="px-3.5 py-3">
                          {/* ── Name row ──────────────────────────────── */}
                          <div className="flex items-center gap-2 mb-1.5">
                            {isRenaming_ ? (
                              <input
                                ref={renameRef}
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleCommitRename();
                                  if (e.key === 'Escape') setRenamingId(null);
                                }}
                                onBlur={handleCommitRename}
                                className="flex-1 bg-white dark:bg-white/5 border border-amber-500/50 rounded-md px-2 py-0.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                            ) : (
                              <span className="flex-1 text-xs font-semibold text-gray-900 dark:text-white truncate">
                                {profile.name}
                              </span>
                            )}

                            {/* Genre badge */}
                            <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${GENRE_COLORS[profile.genre] ?? GENRE_COLORS.general}`}>
                              {profile.genre}
                            </span>
                          </div>

                          {/* ── Meta row ──────────────────────────────── */}
                          {!isDelConf && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2.5">
                              Created {formatDate(profile.createdAt)}
                              {profile.lastUsedAt !== profile.createdAt && (
                                <> · Used {formatDate(profile.lastUsedAt)}</>
                              )}
                            </p>
                          )}

                          {/* ── Delete confirmation ────────────────────── */}
                          {isDelConf && (
                            <div className="flex items-center gap-2 mb-2.5">
                              <span className="text-[11px] text-red-400 flex-1">Delete this profile?</span>
                              <button
                                type="button"
                                onClick={() => handleDelete(profile.id)}
                                disabled={isDeleting}
                                className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 transition"
                              >
                                {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                              >
                                Cancel
                              </button>
                            </div>
                          )}

                          {/* ── Action row ────────────────────────────── */}
                          {!isDelConf && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => handleLoad(profile)}
                                disabled={isActive || isLoadingThis}
                                className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${
                                  isActive
                                    ? 'bg-amber-500/15 border border-amber-500/30 text-amber-400 cursor-default'
                                    : 'bg-amber-500 hover:bg-amber-600 text-black'
                                } disabled:opacity-60`}
                              >
                                {isLoadingThis ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isActive ? (
                                  <Check className="w-3 h-3" />
                                ) : null}
                                {isActive ? 'Loaded' : 'Load'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStartRename(profile)}
                                className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-white/5 transition"
                              >
                                <Pencil className="w-3 h-3" />
                                Rename
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingId(null);
                                  setDeleteConfirmId(profile.id);
                                }}
                                className="flex items-center gap-1 text-[11px] text-red-400/70 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-red-500/5 transition ml-auto"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* ── Save new profile ────────────────────────────────── */}
              <AnimatePresence initial={false}>
                {showNewForm ? (
                  <motion.div
                    key="new-form"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3.5 space-y-2.5"
                  >
                    <label className="block text-[11px] font-semibold text-amber-400 mb-1">
                      Profile name
                    </label>
                    <input
                      ref={newNameRef}
                      value={newName}
                      onChange={e => { setNewName(e.target.value); setSaveError(null); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveNew();
                        if (e.key === 'Escape') setShowNewForm(false);
                      }}
                      placeholder="e.g. Wedding — Natural Light"
                      className="w-full bg-white dark:bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />

                    {saveError && (
                      <p className="text-[11px] text-red-400 flex items-center gap-1.5">
                        {tier === 'free' ? <Zap className="w-3 h-3 text-amber-400 shrink-0" /> : null}
                        {saveError}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveNew}
                        disabled={isSaving || !newName.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black text-xs font-bold rounded-lg transition"
                      >
                        {isSaving
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Check className="w-3 h-3" />
                        }
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewForm(false); setSaveError(null); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-white/5 transition"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>

                      {/* Current settings summary */}
                      <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 capitalize truncate">
                        {currentGenre} ·{' '}
                        {Object.values(currentWeights).join('/')}
                      </span>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="save-btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    {canSaveNew ? (
                      <button
                        type="button"
                        onClick={handleOpenNewForm}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-amber-500/30 text-amber-500/70 hover:border-amber-500/60 hover:text-amber-500 hover:bg-amber-500/[0.04] text-xs font-medium transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Save current settings as profile
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] text-[11px] text-amber-400/80">
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Free plan allows 2 profiles. <span className="font-semibold text-amber-400">Upgrade to Pro</span> for unlimited.</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}