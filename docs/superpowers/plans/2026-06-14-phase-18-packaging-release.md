# Phase 18 — Packaging & Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce downloadable, signed installers for Windows, macOS, and Linux; integrate auto-updater UI; and wire CI/CD for automated builds.

**Architecture:** Electron Builder produces per-platform artifacts (`nsis`, `portable`, `dmg`, `zip`, `AppImage`) from a single shared config. Native Node addons (`.node`) are unpacked from ASAR at runtime. Auto-updater (`electron-updater`) checks GitHub Releases once per day; renderer shows a non-modal banner. CI/CD via GitHub Actions builds on `windows-latest`, `macos-latest`, and `ubuntu-latest` on every push to `main` and uploads to GitHub Releases on version tags.

**Tech Stack:** `electron-builder`, `electron-updater`, GitHub Actions, `electron-rebuild` for native addons.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `docs/superpowers/plans/2026-06-14-phase-18-packaging-release.md` | Create | This plan |
| `docs/todo.md` | Modify | Mark Phase 18 items complete |
| `electron-builder.config.ts` | Modify | Add missing `files`, `asarUnpack`, `publish`, icon refs, native addon include |
| `build/icon.png` | Create | 1024×1024 PNG icon source |
| `build/icon.ico` | Create | Multi-resolution Windows icon |
| `build/icon.icns` | Create | Multi-resolution macOS icon |
| `build/icon@2x.png` / `icon@3x.png` | Create | Hi-DPI variants |
| `src/main/index.ts` | Modify | No changes needed — auto-updater already initialized here |
| `src/renderer/components/UpdateBanner.tsx` | Create | React UI — non-modal update banner |
| `src/renderer/hooks/useUpdater.ts` | Create | Hook to listen for auto-updater IPC events |
| `src/renderer/App.tsx` | Modify | Add `<UpdateBanner />` component |
| `src/renderer/preload.js` | Modify | Add `updater-check` and `updater-set-enabled` to API |
| `src/main/auto-updater.ts` | Modify | Already exists — add IPC bridge for renderer |
| `src/main/ipc-handlers.ts` | Modify | Register `updater-check` and `updater-set-enabled` handlers |
| `.github/workflows/build.yml` | Modify | Update to Node 20, fix build steps, add icon build |
| `.github/workflows/release.yml` | Modify | Update to Node 20, reference `GH_TOKEN` |
| `package.json` | Modify | Version to `1.0.0`, verify all scripts |
| `CODE_SIGNING.md` | Create | Documentation for future code signing |
| `README.md` | Modify | Add download links to GitHub Releases, update build instructions |

---

## Task 1: Generate App Icons

**Files:**
- Create: `build/icon.png (1024×1024)`, `build/icon.ico`, `build/icon.icns`
- Modify: `electron-builder.config.ts`

**Context:**
Icons are the project's branding face. We'll generate a clean, modern icon: an **aperture + checkmark** concept. Since we can't generate images directly with code, we will create icons programmatically using Node's `canvas` module, or use a placeholder approach via `icon-gen`.

Actually, looking at `scripts/generate-icons.ts` which already exists — let's check if it's functional.

- [ ] **Step 1:** Verify `src/scripts/generate-icons.ts` exists and generates icons
- [ ] **Step 2:** Run `npm run build:icons` to generate all platform icons
- [ ] **Step 3:** Verify icons exist in `build/` directory
- [ ] **Step 4:** Commit

**Verification:** `ls build/` shows icon files.

---

## Task 2: Verify & Fix electron-builder Config

**Files:**
- Modify: `electron-builder.config.ts`

Current config is mostly complete but needs verification of:
1. `files` array includes everything needed
2. `asarUnpack` includes `lightdrift-libraw` `.node` files
3. Face detection model files are bundled (`extraResources`)
4. All icon paths are correct

- [ ] **Step 1:** Read current `electron-builder.config.ts`
- [ ] **Step 2:** Verify `files[]` includes `dist/`, `package.json`, and all runtime assets
- [ ] **Step 3:** Verify `asarUnpack` includes `**/*.node`
- [ ] **Step 4:** Verify `extraResources` points to correct model path
- [ ] **Step 5:** Commit

**Verification:** `npx electron-builder build --dir` completes without errors.

---

## Task 3: Bundle Native Addons

**Files:**
- Modify: `package.json`
- Verify: `electron-builder.config.ts`

- [ ] **Step 1:** Verify `postinstall` script runs `electron-rebuild` (it does: `"postinstall": "electron-rebuild"`)
- [ ] **Step 2:** Verify `asarUnpack: ['**/*.node']` is in electron-builder config
- [ ] **Step 3:** Verify `build:all` script runs `build:icons` + `build:main` + `build:renderer`
- [ ] **Step 4:** Test that native addon loads after packaging (manual dev build)
- [ ] **Step 5:** Commit

**Verification:** After `npm run build:all`, `find dist -name "*.node"` shows native addon `.node` files.

---

## Task 4: Update GitHub Actions CI/CD Workflows

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `.github/workflows/release.yml`

Current workflows exist but need review:
1. `build.yml` — runs on push to main/develop, builds on all 3 OSs, uploads artifacts
2. `release.yml` — runs on tag push `v*`, publishes to GitHub Releases

- [ ] **Step 1:** Review current `.github/workflows/build.yml`
- [ ] **Step 2:** Ensure Node 20 is used (already is), ensure `npm run build:icons` is called
- [ ] **Step 3:** Verify `release.yml` publishes using `--publish=always` with `GH_TOKEN`
- [ ] **Step 4:** Add `if-no-files-found: error` to artifact uploads for stricter CI
- [ ] **Step 5:** Commit

**Verification:** CI passes on a test push.

---

## Task 5: Create Auto-Updater UI Component

**Files:**
- Create: `src/renderer/components/UpdateBanner.tsx`
- Create: `src/renderer/hooks/useUpdater.ts`
- Modify: `src/renderer/App.tsx`

The auto-updater is already initialized in `src/main/auto-updater.ts` but there's no renderer UI. Need to:
1. Create a hook that listens for IPC events from the main process
2. Create a non-modal banner that shows when an update is available
3. Wire it into App.tsx

- [ ] **Step 1:** Create `useUpdater` hook (listens for `updater-update-available`, `updater-update-downloaded`, `updater-download-progress`)
- [ ] **Step 2:** Create `UpdateBanner` React component (shows non-modal banner with version, download progress, install/restart button)
- [ ] **Step 3:** Add component to `App.tsx` (floating at top of app, dismissable)
- [ ] **Step 4:** Commit

**Verification:** App starts without crash; banner would appear when an update is published.

---

## Task 6: Version Bump & Release Preparation

**Files:**
- Modify: `package.json`
- Modify: `docs/todo.md`
- Modify: `README.md`

- [ ] **Step 1:** Update `package.json` version to `1.0.0`
- [ ] **Step 2:** Update `docs/todo.md` to mark Phase 18 items complete
- [ ] **Step 3:** Update `README.md` — add download links pointing to GitHub Releases
- [ ] **Step 4:** Write release notes in `RELEASE_NOTES.md`
- [ ] **Step 5:** Commit

**Verification:** `npm run build:all` succeeds; version reads `1.0.0`.

---

## Task 7: Final Verification & Documentation

**Files:**
- Verify: All of Phase 18

- [ ] **Step 1:** Run `npm run build:all` — verify success
- [ ] **Step 2:** Run `npx electron-builder --dir` — verify directory structure
- [ ] **Step 3:** Check that `build/` contains all icon files
- [ ] **Step 4:** Verify auto-updater IPC events are wired correctly
- [ ] **Step 5:** Review `docs/todo.md` and tick off all Phase 18 checkboxes
- [ ] **Step 6:** Commit final changes

**Done Criteria:** On a clean machine with no development tools installed, the CullAI installer installs and runs cleanly. Auto-updater banner shows when a new version is available. Version is `1.0.0`.
