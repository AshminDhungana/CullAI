cat > /home/claude/todo.md << 'ENDOFFILE'

# CullAI — Developer TODO

> Work through each phase in order. Every phase builds on the one before it.
> Complete **all checkboxes** in a phase before moving to the next.
> The ✅ **Done Criteria** at the end of each phase is your exit test.

---

## Progress Overview

| Phase | Title                                  | Status         |
| ----- | -------------------------------------- | -------------- |
| 1     | Project Scaffold                       | ✅ Complete    |
| 1.5   | Splash Screen & Launch Animation       | ⬜ Not Started |
| 2     | Setup Screen UI (Enhanced)             | ⬜ Not Started |
| 3     | Secure Storage & License               | ⬜ Not Started |
| 4     | RAW Decoding Pipeline                  | ⬜ Not Started |
| 5     | Image Processing Pipeline (Enhanced)   | ⬜ Not Started |
| 5b    | Smart RAW Caching                      | ⬜ Not Started |
| 6     | Face & Eye Detection                   | ⬜ Not Started |
| 7     | Duplicate Detection                    | ⬜ Not Started |
| 8     | Session Manager                        | ⬜ Not Started |
| 9     | Single AI Call (Enhanced)              | ⬜ Not Started |
| 10    | Full Batch Pipeline + Input Validation | ⬜ Not Started |
| 10b   | Concurrent Directory Processing        | ⬜ Not Started |
| 11    | Parallel Batching                      | ⬜ Not Started |
| 12    | Results Screen (Enhanced)              | ⬜ Not Started |
| 12b   | Results Performance & UX               | ⬜ Not Started |
| 13    | XMP Export + Auto‑Tagging              | ⬜ Not Started |
| 13b   | AI‑Powered Auto‑Tagging                | ⬜ Not Started |
| 14    | Style Profile System                   | ⬜ Not Started |
| 15    | Multi-Provider AI Support              | ⬜ Not Started |
| 16    | Polish & Error Handling (Enhanced)     | ⬜ Not Started |
| 17    | Test Suite (Enhanced)                  | ⬜ Not Started |
| 18    | Packaging & Release                    | ⬜ Not Started |
| 19    | CLI Mode & Automation                  | ⬜ Not Started |
| 20    | Additional UX & Performance            | ⬜ Not Started |

---

## Phase 1 — Project Scaffold ✅ Complete

> Goal: A working Electron window that opens with a React + TypeScript app inside.
> **Complete this phase before Phase 1.5.**

### 1.1 Initialize the Project

- [x] Run `npm init` and set name to `cullai`, version `0.1.0`
- [x] Install Electron: `npm install --save-dev electron`
- [x] Install React + TypeScript: `npm install react react-dom` and `npm install --save-dev typescript @types/react @types/react-dom`
- [x] Install Tailwind CSS: `npm install --save-dev tailwindcss@3 postcss autoprefixer` and run `npx tailwindcss init`
- [x] Install `electron-builder` for packaging: `npm install --save-dev electron-builder`
- [x] Install `ts-node` and `tsx` for running TypeScript directly in dev
- [x] Install `concurrently` and `wait-on` for dev server coordination
      `npm install --save-dev ts-node tsx concurrently wait-on`

### 1.2 Configure TypeScript

- [x] Create `tsconfig.json` with two project references:
  - `tsconfig.main.json` — targets Node.js (CommonJS), covers `src/main/`
  - `tsconfig.renderer.json` — targets browser (ESNext), covers `src/renderer/`
- [x] Enable `strict: true`, `esModuleInterop: true` in both configs
- [x] Exclude `node_modules` and `dist` from both configs

### 1.3 Build Folder Structure

- [x] Create `src/main/` — Electron main process files
- [x] Create `src/renderer/` — React UI files
- [x] Create `src/renderer/screens/` — Setup, Processing, Results screen components
- [x] Create `src/renderer/components/` — reusable UI components
- [x] Create `src/shared/` — types and constants shared between main + renderer
- [x] Create `tests/fixtures/` — sample images for tests (add at least one JPEG now)
- [x] Create `tests/` — test files (empty for now)

### 1.4 Create Core Entry Files

- [x] Create `src/main/index.ts` — Electron app entry point that creates a `BrowserWindow`
- [x] Create `src/renderer/App.tsx` — root React component, renders `<h1>CullAI</h1>` as a placeholder
- [x] Create `src/renderer/index.tsx` — ReactDOM render entry point
- [x] Create `src/shared/types.ts` — empty file, ready for type definitions
- [x] Create `src/shared/constants.ts` — define app name, version string
- [x] Create `src/shared/genre-presets.ts` — empty file, ready for Phase 2

### 1.5 Configure Build Scripts

- [x] Configure Tailwind `content` path to cover `src/renderer/**/*.{tsx,ts}`
- [x] Add `npm run dev` script — starts Electron + Vite (or Webpack) renderer dev server together
- [x] Add `npm run build` script — compiles TypeScript and runs `electron-builder`
- [x] Add `npm run test` script — placeholder for Phase 17
- [x] Create skeleton `electron-builder.config.ts` — set `appId`, `productName: "CullAI"`, output dirs for Win/Mac/Linux (leave targets empty for now)

### 1.6 Verify Scaffold

- [x] Run `npm run dev` — Electron window opens with "CullAI" text rendered by React
- [x] No TypeScript errors in console
- [x] Hot reload works — editing `App.tsx` updates the window without restarting Electron

✅ **Done Criteria:** `npm run dev` opens a blank Electron window with React rendering correctly, no TS errors.

---

## Phase 1.5 — Splash Screen & Launch Animation

> Goal: A branded animated splash screen appears on app start, then transitions to main UI.
> **Prerequisite: Phase 1 must be fully complete before starting this phase.**

### 1.5.1 Create Splash Screen Component

- [x] Create `src/renderer/components/SplashScreen.tsx`
- [x] Design a centered container with CullAI logo + tagline: _"AI-powered photo culling"_
- [x] Add a subtle CSS/keyframe animation (fade‑in, pulse, or slide‑up)
- [x] Set duration: 1.5–2.5 seconds (configurable via `SPLASH_DURATION_MS` in `src/shared/constants.ts`)
- [x] Allow click/tap anywhere to skip to main UI immediately

### 1.5.2 Integrate with App Startup

- [x] In `src/renderer/App.tsx`, add a `screen` state with type: `'splash' | 'setup' | 'processing' | 'results'`
- [x] Default state to `'splash'`
- [x] Render `<SplashScreen onDismiss={() => setScreen('setup')} />` while `screen === 'splash'`
- [x] On splash finish (timeout or skip), transition to `'setup'`
- [x] Preload critical resources (electron‑store, API key decryption) during splash window

### 1.5.3 Optional — Lottie Animation

- [x] Install `lottie-react`: `npm install lottie-react`
- [x] Create or obtain a lightweight Lottie JSON animation for the logo
- [x] Replace CSS animation with Lottie player for a more polished look

✅ **Done Criteria:** App starts, shows animated splash for 1.5–2.5 s, then loads Setup screen. Clicking anywhere skips to Setup instantly.

---

## Phase 2 — Setup Screen UI (Enhanced)

> Goal: A fully functional Setup screen with **file extension filter**, **filename prefix filter**, and **reference image upload**.

### 2.1 Define Shared Types

- [x] In `src/shared/types.ts`, define:
  - `ScoringWeights` — `{ quality, aesthetic, composition, sharpness, exposure, faceEyes: number }`
  - `GenrePreset` — union of `'general' | 'wedding' | 'portrait' | 'sports' | 'landscape' | 'street' | 'event'`
  - `AIProvider` — union of `'claude' | 'openai' | 'gemini' | 'ollama' | 'custom'`
  - `AppSettings` — all Setup screen fields as a single config object
  - `StyleProfile` — `{ id, name, genre, weights, preferenceText }`
  - `ExtensionFilter: Set<string>` (e.g. `{'.cr3', '.nef', '.jpg'}`)
  - `PrefixFilter: string[]` (e.g. `['IMG_', 'DSC_']`)
  - `ReferenceImage: { filename: string, base64: string } | null`

### 2.2 Define Genre Presets

- [x] In `src/shared/genre-presets.ts`, define the preset weight table:
  - General: `{ quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 }`
  - Wedding: `{ quality: 20, aesthetic: 20, composition: 10, sharpness: 15, exposure: 10, faceEyes: 25 }`
  - Portrait: `{ quality: 20, aesthetic: 15, composition: 10, sharpness: 15, exposure: 10, faceEyes: 30 }`
  - Sports: `{ quality: 25, aesthetic: 15, composition: 10, sharpness: 30, exposure: 10, faceEyes: 10 }`
  - Landscape: `{ quality: 25, aesthetic: 25, composition: 20, sharpness: 15, exposure: 15, faceEyes: 0 }`
  - Street: `{ quality: 20, aesthetic: 25, composition: 20, sharpness: 15, exposure: 10, faceEyes: 10 }`
  - Event: `{ quality: 20, aesthetic: 15, composition: 10, sharpness: 20, exposure: 10, faceEyes: 25 }`
- [x] Export a `GENRE_PRESETS` map: `Record<GenrePreset, ScoringWeights>`

### 2.3 Build ScoringWeightsPanel Component

- [x] Create `src/renderer/components/ScoringWeightsPanel.tsx`
- [x] Render 6 labeled sliders: Quality, Aesthetic, Composition, Sharpness, Exposure, Face & Eyes
- [x] Each slider: range 0–100, step 1
- [x] Implement auto-normalization: when any slider changes, scale all 6 values so they always sum to exactly 100
- [x] Display current % value next to each slider label
- [x] Accept `weights: ScoringWeights` and `onChange: (weights: ScoringWeights) => void` as props

### 2.4 Build GenrePresetSelector Component

- [x] Create `src/renderer/components/GenrePresetSelector.tsx`
- [x] Render a styled `<select>` dropdown with all 7 genre options
- [x] On selection, emit the chosen `GenrePreset` value
- [x] Show a read-only weight preview beneath the dropdown (small text: "Quality 25% · Aesthetic 20% · ...")
- [x] Accept `value: GenrePreset` and `onChange: (genre: GenrePreset) => void` as props

### 2.5 Build the Setup Screen

- [x] Create `src/renderer/screens/Setup.tsx`
- [x] **Input folder** — text input + "Browse" button (wire to `window.electronAPI.openFolderDialog()`)
- [x] **Output folder** — text input + "Browse" button
- [x] **Number of images to select** — optional number input + range slider, min 0, max 999, default 20.
      If set to 0 or left empty, the system will output all S‑tier images (ignoring any count limit).
- [x] **Genre preset selector** — embed `GenrePresetSelector`, on change auto-populate scoring weights
- [x] **Style profile selector** — dropdown (stub: just shows "No profiles yet"), "Create New" button
- [x] **Preference text box** — multi-line textarea, placeholder: `"e.g. sharp, well-lit portraits with natural light"`
- [x] **Scoring weights panel** — embed `ScoringWeightsPanel`, weights update when genre preset changes
- [x] **API provider selector** — radio buttons or dropdown: Claude / OpenAI / Gemini / Ollama / Custom
- [x] **API key input** — password input field, hidden by default, show/hide toggle button
- [x] **Base URL input** — text input, shown only when provider is Ollama or Custom
- [x] **Model name input** — text input with smart default per provider
- [x] **Concurrency setting** — number input, range 1–10, default 5, label: "Parallel API calls"
- [x] **Dry-run toggle** — checkbox: "Estimate token cost before processing"
- [x] **XMP export toggle** — checkbox: "Write Lightroom/Capture One sidecar files"
- [x] **Lightroom integration mode** — radio: "Rate originals in-place" vs. "Copy keepers to output folder"
- [x] **Image Limiting Options** — When output falls short of requested count:
  - [x] **Stop** — output only the available keepers (S+A)
  - [x] **Fill with B‑tier images** — automatically promote best B‑tier to reach the target
  - [x] **If still not filled, fill with Rejected images** — automatically promote best rejected to reach the target

### 2.6 Add Extension Filter Component

- [ ] Create `src/renderer/components/ExtensionFilter.tsx`
- [ ] Render a multi‑select dropdown with checkboxes for each extension found in the selected input folder
- [ ] Extensions are discovered by scanning the input folder (call `'scan-folder-extensions'` IPC)
- [ ] Each extension shows a count badge, e.g. `CR3 (142)`
- [ ] Buttons: "Select all", "Clear all", "Apply"
- [ ] Store selected extensions in `AppSettings.extensionFilter`
- [ ] When folder changes, re‑scan and reset filter to all supported by default

### 2.7 Add Filename Prefix Filter Component

- [ ] Create `src/renderer/components/PrefixFilter.tsx`
- [ ] Text input with placeholder: `IMG_, DSC_, _MG_` (comma or space separated)
- [ ] Real‑time preview: "Matches: 47 files"
- [ ] Case‑insensitive matching toggle (checkbox)
- [ ] Store prefixes as `string[]` in `AppSettings.prefixFilter`

### 2.8 Add Reference Image Upload

- [ ] Add a section to Setup screen: **Custom Instructions & Reference Image**
- [ ] Textarea for custom instructions (already above)
- [ ] Button: "Upload Reference Image" – opens file dialog (JPEG/PNG only)
- [ ] After upload, display thumbnail preview and filename
- [ ] Store reference image as base64 (resized to 512px) in `AppSettings.referenceImage`
- [ ] Add a "Clear" button to remove the reference image
- [ ] Show info tooltip: _"Reference image will be sent to AI during Discovery Pass to guide scoring."_

### 2.9 Wire App Routing

- [ ] The `screen` state is already defined in `App.tsx` (from Phase 1.5): `'splash' | 'setup' | 'processing' | 'results'`
- [ ] Render `<Setup />` when `screen === 'setup'`, `<Processing />` when `'processing'`, `<Results />` when `'results'`
- [ ] "Start Culling" button in Setup transitions `screen` to `'processing'`
- [ ] Apply Tailwind dark theme base styles — dark background, light text, amber/gold accent color

### 2.10 Persist Settings with electron-store

- [ ] Install `electron-store`: `npm install electron-store`
- [ ] Create IPC handler in `src/main/ipc-handlers.ts`: `'settings-get'` and `'settings-set'`
- [ ] Expose `window.electronAPI.getSettings()` and `window.electronAPI.saveSettings()` via preload script
- [ ] On Setup screen mount, load persisted settings and populate all fields
- [ ] On any field change, auto-save settings via debounced IPC call
- [ ] Verify settings survive app restart

### 2.11 🔥 Recent Folders Dropdown

- [ ] Add a dropdown component "Recent input folders" and "Recent output folders" below the folder selection fields
- [ ] Store last 10 unique paths in `electron-store` under `recentInputFolders` / `recentOutputFolders`
- [ ] On folder selection (via browse or manual entry), update the recent list (move to top, remove duplicates)
- [ ] Clicking a recent folder auto‑fills the corresponding field and triggers validation

### 2.12 🔥 "Open in Explorer/Finder" Buttons

- [ ] Add a small folder icon button next to each folder text input
- [ ] On click, call IPC `'shell-show-item'` with the folder path (if empty, show a warning)
- [ ] Uses Electron `shell.showItemInFolder` for the folder itself (or `openPath` if preferred)

### 2.13 🔥 Output Folder Safety Check

- [ ] When user selects or types an output folder, validate that it is **not** a subdirectory of the input folder (case‑insensitive path comparison)
- [ ] If conflict detected, show a yellow warning banner: "Output folder is inside input folder – this may cause recursion or accidental overwrites. Continue?"
- [ ] Add an "Ignore" checkbox that persists for the session (does not auto‑save to global settings)

### 2.14 🔥 Face Count Limit Setting

- [ ] Add a slider + number input in the Scoring Weights panel area: "Max faces per image (ignore group shots)"
- [ ] Range 0–50, default 0 (disabled, meaning no limit)
- [ ] Store in `AppSettings` as `maxFacesPerImage`
- [ ] In Phase 6, during face detection, if `maxFacesPerImage > 0` and `faceCount > maxFacesPerImage`, mark image as rejected (or set `faceEyes` score to 0) — implemented in Phase 6.

### 2.15 🔥 Test Face Detection on Reference Image

- [ ] After a reference image is uploaded, add a "Test face detection" button next to the thumbnail
- [ ] On click, send the reference image's base64 to `'scan-faces'` IPC and show a small modal/notification:
  - "Faces detected: X, eyes open: Yes/No, blink detected: Yes/No"
- [ ] If no faces detected, suggest adjusting the reference image or continuing anyway

### 2.16 🔥 Support for `.cullaiignore` File

- [ ] During folder scan, look for a file named `.cullaiignore` in the **input folder root**
- [ ] Parse it line by line (ignore empty lines and comments starting with `#`)
- [ ] Support simple glob patterns (`*`, `?`, `[abc]`, `**` for directories)
- [ ] Apply exclusions **in addition** to prefix filters and extension filters
- [ ] Show a small badge on Setup screen: "Ignoring X files via .cullaiignore"
- [ ] Add a "Reload ignore rules" button next to the badge (in case user edits the file manually)

### 2.17 🔥 Burst Handling Toggle

- [ ] Add a checkbox: "Keep all burst shots (disable duplicate grouping)"
- [ ] Default: unchecked (duplicate grouping active)
- [ ] Store in `AppSettings` as `disableDuplicateGrouping`
- [ ] When checked, Phase 7 will skip duplicate grouping and treat every image as a separate candidate

### 2.18 🔥 Similarity Threshold Slider (Duplicate Detection)

- [ ] Add a slider labeled "Burst similarity threshold (bits)" with range 5–20, default 10
- [ ] Add info tooltip: "Lower = stricter grouping (only nearly identical images). Higher = looser grouping (more images considered duplicates)."
- [ ] Store in `AppSettings` as `duplicateThreshold`
- [ ] Used in Phase 7 instead of the hardcoded constant

✅ **Done Criteria:** All Setup screen fields render correctly, genre preset auto-populates sliders, weights always sum to 100, settings persist across restarts. Extension filter, prefix filter, and reference image upload work and save.

---

## Phase 3 — Secure Storage & License

> Goal: API keys encrypted at OS level; feature gates wired throughout the app.
>
> ⚠️ **README Gap:** The license system (Free / Pro / Lifetime tiers, feature gates, monthly
> image caps) is not documented in `README.md`. Before shipping, `README.md` must be updated
> to describe the tiered model, what each tier unlocks, and how to purchase/activate a license.
> Failing to do this will cause user confusion about locked features.

### 3.1 Implement API Key Secure Storage

- [ ] Create `src/main/safe-storage.ts`
- [ ] Implement `storeApiKey(provider: AIProvider, key: string): void` using `safeStorage.encryptString()`
- [ ] Implement `getApiKey(provider: AIProvider): string | null` using `safeStorage.decryptString()`
- [ ] Implement `deleteApiKey(provider: AIProvider): void`
- [ ] Store encrypted bytes in `electron-store` under key `apiKeys.{provider}`
- [ ] Ensure raw key string is never written to any log or file
- [ ] Add IPC handlers: `'api-key-store'`, `'api-key-get'`, `'api-key-delete'`
- [ ] Wire Setup screen API key input to these IPC handlers — save on blur, load masked value on mount

### 3.2 Platform Verification

- [ ] Verify `safeStorage.isEncryptionAvailable()` returns `true` on each platform
- [ ] Add a startup check — if encryption unavailable, show a warning dialog (do not fall back to plaintext)
- [ ] Test on Windows (DPAPI), macOS (Keychain), and Linux (kwallet/gnome-libsecret) if available

### 3.3 Implement License System

- [ ] Create `src/main/license.ts`
- [ ] Define `LicenseTier` enum: `Free | Pro | Lifetime`
- [ ] Define `LicenseFile` type: `{ tier, email, issuedAt, expiresAt? }`
- [ ] Implement `loadLicense(): LicenseTier` — reads a local `.cullai-license` file from app data dir
- [ ] If no license file found, default to `Free`
- [ ] Implement `getLicenseTier(): LicenseTier` — cached getter
- [ ] Add IPC handler: `'license-get-tier'` — returns current tier to renderer

### 3.4 Implement Feature Gates

- [ ] Define feature flag map in `license.ts`:
  - `rawFormats` — Pro and Lifetime only
  - `xmpExport` — Pro and Lifetime only
  - `unlimitedImages` — Pro and Lifetime only (Free: 500 images **per calendar month** cap)
  - `unlimitedProfiles` — Pro and Lifetime only (Free: max 2 profiles)
  - `autoTagging` — Pro and Lifetime only (AI keyword tagging from Phase 13b)
- [ ] Implement `isAllowed(feature: Feature, tier: LicenseTier): boolean`
- [ ] Implement `getMonthlyImageCount(): number` — tracks usage in `electron-store`, resets on the first of each calendar month
- [ ] Add IPC handler: `'license-check-feature'`
- [ ] In Setup screen: show lock icon on RAW-related fields and XMP toggle if tier is Free
- [ ] In Setup screen: show upgrade prompt if monthly limit is approaching (e.g. >80% used)

✅ **Done Criteria:** API key stores and loads encrypted; deleting it removes it cleanly. License tier reads from file; Free tier shows lock icons on Pro features. Monthly image counter resets correctly on a new month.

---

## Phase 4 — RAW Decoding Pipeline

> Goal: Any supported RAW file can be decoded to a usable JPEG buffer.

### 4.1 Install and Configure libraw

- [ ] Install `libraw` Node native addon: `npm install libraw`
- [ ] Verify native compilation succeeds on your dev platform
- [ ] Note required system dependencies in `README.md` build section:
  - Linux: `build-essential`
  - macOS: Xcode CLI tools (`xcode-select --install`)
  - Windows: Visual Studio Build Tools
- [ ] Ensure `electron-builder` is configured to rebuild native addons for each target platform (add `electron-rebuild` to build script)

### 4.2 Create the RAW Decoder Module

- [ ] Create `src/main/raw-decoder.ts`
- [ ] Define `RAW_EXTENSIONS` constant: `['.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.raf', '.dng', '.orf', '.rw2', '.pef', '.3fr']`
- [ ] Implement `isRawFile(filePath: string): boolean` — checks extension case-insensitively
- [ ] Implement `decodeRaw(filePath: string): Promise<Buffer>`:
  - Open file with libraw
  - Unpack raw data
  - Process through libraw's default pipeline
  - Output as full-quality JPEG buffer
  - Close libraw handle
- [ ] Implement proper error handling — throw a typed `RawDecodeError` with filename and reason
- [ ] Log decode time per file in dev mode for performance monitoring

### 4.3 Test RAW Decoding Manually

- [ ] Add sample RAW files per major brand to `tests/fixtures/` (CR3, NEF, ARW, RAF, DNG)
- [ ] Write a manual test script that decodes each fixture and writes output JPEG to disk
- [ ] Visually inspect each output JPEG — confirm correct colors, no corruption
- [ ] Measure decode time per format — log results

### 4.4 🔥 Extract Embedded JPEG Preview (Fast Thumbnails)

- [ ] In `raw-decoder.ts`, implement `extractEmbeddedJpeg(filePath: string): Promise<Buffer | null>`
- [ ] Use `libraw`'s ability to extract the preview image (if present) without full decode
- [ ] If successful, return the JPEG buffer; if not, fall back to `decodeRaw()`
- [ ] Use this in `image-processor.ts` **only** for generating the base64 preview used in the Results screen (not for AI scoring)
- [ ] For AI scoring, always use the full‑quality decoded buffer (or cached full preview)
- [ ] Add a setting to disable this feature (in case of inconsistency)

✅ **Done Criteria:** `decodeRaw()` successfully converts CR3, NEF, ARW, RAF, and DNG to JPEG buffers. Output images look correct visually. RAW files with embedded previews load noticeably faster in the Results gallery. Full decode still used for AI scoring.

---

## Phase 5 — Image Processing Pipeline

> Goal: Given an input folder, produce a list of `ImageRecord` objects with resized base64 data, ready for AI scoring.
>
> **Note on RAW Caching:** Basic RAW caching integration is stubbed in step 5.2 below (cache lookup
> before decode), but the full cache module (`raw-cache.ts`) is built in **Phase 5b**. In Phase 5,
> call `getCachedRawPreview` / `storeRawPreview` as if the module already exists; implement them in
> Phase 5b. Do not create `raw-cache.ts` here.

### 5.1 Define ImageRecord Type

- [ ] In `src/shared/types.ts`, add:
  ```ts
  type ImageRecord = {
    id: string; // unique ID (e.g. filename hash)
    filePath: string; // absolute path to original
    filename: string; // basename
    isRaw: boolean;
    base64: string; // 1024px resized JPEG as base64
    width: number; // resized dimensions
    height: number;
    faceMetadata?: FaceMetadata; // populated after Phase 6 face scan; optional until then
  };
  ```
  > **Note (fix #6):** `faceMetadata` is included here so Phase 6.4's attachment of face data
  > to `ImageRecord` is type-safe. Mark it optional (`?`) until face detection runs.

### 5.2 Create the Image Processor Module

- [ ] Create `src/main/image-processor.ts`
- [ ] Install `sharp`: `npm install sharp`
- [ ] Implement `scanFolder(folderPath: string, extensionFilter?: Set<string>, prefixFilter?: string[]): Promise<string[]>`
  - Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, `.gif`, `.avif`, `.tiff`, `.tif` + all RAW extensions
  - Apply extension filter (if provided, only those extensions; if empty, all supported)
  - Apply prefix filter (only filenames starting with any of the given prefixes)
  - Skip hidden files and system files (`.DS_Store`, `Thumbs.db`, `.cullai_cache`)
  - Sort alphabetically
- [ ] Implement `processImage(filePath: string): Promise<ImageRecord>`:
  - If `isRawFile(filePath)` → call `getCachedRawPreview(filePath)` first (from `raw-cache.ts`, Phase 5b). On cache miss, call `decodeRaw`, then `storeRawPreview`.
  - Else → read file with `fs.readFile()`
  - Pass buffer to Sharp: `sharp(buffer).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 })`
  - Encode Sharp output as base64
  - Return `ImageRecord`
- [ ] Implement `processFolder(folderPath: string): AsyncGenerator<ImageRecord>` — yields one record at a time

### 5.3 Wire IPC

- [ ] Add IPC handler: `'scan-folder'` — takes folder path, extension filter, prefix filter → returns file count + list of filenames
- [ ] Add IPC handler: `'process-images'` — streams `ImageRecord` objects back to renderer
- [ ] Expose `window.electronAPI.scanFolder()` and `window.electronAPI.processImages()` in preload script
- [ ] Handle free tier limit: if image count > 500 (this month) and tier is Free, reject with error code `FREE_LIMIT_EXCEEDED`

✅ **Done Criteria:** Given a folder of mixed images, `processFolder()` yields correctly sized base64-encoded `ImageRecord` per image, respecting extension and prefix filters. On a second run with the same RAW files, it defers to Phase 5b cache (once implemented).

---

## Phase 5b — Smart RAW Caching

> Goal: Decoded RAW previews are cached to disk so subsequent runs (or session resumes) avoid re‑decoding the same RAW files. Cache is **self‑managing** with size and age limits.
>
> **This phase creates `src/main/raw-cache.ts` for the first time.** Phase 5 already calls its
> functions as stubs; implementing them here completes the integration.

### 5b.1 Create RAW Cache Module

- [ ] Create `src/main/raw-cache.ts` (this is the single, authoritative implementation — not a duplicate)
- [ ] Define cache directory location:
      `{inputFolder}/.cullai_cache/raw_previews/`
      _(Alternative: a global cache in app data, e.g. `~/.cullai/cache/raw/` — decide based on portability requirements)_
- [ ] Implement `getCachedRawPreview(rawPath: string): Buffer | null`:
  - Compute cache key: `hash(filePath + lastModified)` or just use `basename + lastModified` timestamp.
  - Check if cached file exists and its embedded metadata indicates it was generated from the current RAW file (compare `mtime` or store a checksum).
  - If valid, read and return the JPEG buffer; otherwise return `null`.
- [ ] Implement `storeRawPreview(rawPath: string, jpegBuffer: Buffer): void`:
  - Write the JPEG buffer to the cache directory with a deterministic filename (e.g., `basename + '.jpg'`).
  - Store a sidecar JSON file containing original RAW path, `mtime`, size, and a timestamp of when the cache entry was created.
- [ ] Implement `getCacheStats(): Promise<{ sizeBytes: number, fileCount: number, oldestEntry: Date | null }>`:
  - Recursively scan the cache directory, sum file sizes, count files, find oldest entry date.

### 5b.2 Integrate with Image Processor

- [ ] Verify that `image-processor.ts` → `processImage(filePath)` already calls `getCachedRawPreview` and `storeRawPreview` (stubbed in Phase 5.2). No changes to `image-processor.ts` needed here — just ensure the now-real `raw-cache.ts` module is importable.
- [ ] Ensure the cached buffer is **identical** to the buffer that would have been produced by a fresh decode (i.e., same dimensions, quality, color profile). No additional processing (like face detection or resizing) is stored in the cache — just the decoded JPEG.

### 5b.3 Add Cache Management IPC

- [ ] Create IPC handlers in `src/main/ipc-handlers.ts`:
  - `'raw-cache-stats'` – returns cache size, file count, oldest entry date.
  - `'raw-cache-clear'` – deletes the entire cache directory for the current input folder (or global cache if implemented).
  - `'raw-cache-set-limits'` – receives `{ maxSizeGB: number, maxAgeDays: number }` and stores in `electron-store`.
- [ ] Expose these handlers via preload script as `window.electronAPI.getRawCacheStats()`, `clearRawCache()`, `setRawCacheLimits()`.

### 5b.4 Build Cache UI in Setup Screen

- [ ] Add an **"Advanced"** expandable section at the bottom of the Setup screen.
- [ ] Inside, display current RAW cache status:
  - "RAW preview cache: 2.3 GB / 5.0 GB • 847 files • oldest from 12 days ago"
- [ ] Add two numeric inputs (or sliders):
  - **Max cache size (GB)** – default 5, range 1–50.
  - **Max cache age (days)** – default 30, range 1–365.
- [ ] Add a **"Clear cache now"** button – on click, calls `clearRawCache()` and updates the status display.
- [ ] Store cache limit preferences globally (not per‑project). They apply to all input folders.

### 5b.5 Implement Automatic Cache Cleanup

- [ ] Create `src/main/cache-cleaner.ts`.
- [ ] Export a function `enforceCacheLimits()` that:
  - Retrieves current cache stats and the stored limits (max size, max age).
  - If total size > maxSizeGB → delete oldest cached files (by creation date) until total size ≤ limit.
  - If any cached file's age > maxAgeDays → delete it regardless of size.
- [ ] Run `enforceCacheLimits()`:
  - On app startup (after main window loads, non‑blocking).
  - After each session completes (or is cancelled).
  - Whenever the user manually changes cache limits via the UI.
- [ ] Log cleanup actions to the console (in dev mode) and optionally to a debug log file.

### 5b.6 Handle Edge Cases

- [ ] If cache directory is deleted manually by the user, recreate it gracefully on next `storeRawPreview`.
- [ ] If a cached file is corrupted (e.g., partial write), treat it as a cache miss and overwrite on next decode.
- [ ] Ensure `.cullai_cache` directory is excluded from recursive folder scanning (Phase 5) and from any "copy to output" operations.
- [ ] Add a setting to disable RAW caching entirely (e.g., for users with very limited disk space).

### 5b.7 Performance Verification

- [ ] Test with 50 RAW images:
  - First run (no cache): measure total decode time.
  - Second run (cache hit): measure total time; should be dramatically faster (close to the time needed to copy JPEGs).
- [ ] Verify that cache limits are respected: create a huge cache (> limit), run cleanup, and check that size no longer exceeds limit.
- [ ] Verify that cache works across app restarts and across different sessions using the same input folder.

✅ **Done Criteria:** First decode of a RAW file stores a preview in `.cullai_cache/raw_previews/`. Second decode of the same file (even after app restart) loads from cache, never calls `libraw`. Cache status UI correctly reports size and file count. Automatic cleanup respects user‑defined size and age limits. "Clear cache now" removes all cached previews for the current input folder. Disabling caching works and no cache files are created.

---

## Phase 6 — Face & Eye Detection

> Goal: Every image gets a `FaceMetadata` object populated before AI scoring. Zero face data leaves the device.
>
> **Library note (fix #9):** The README tech stack lists `@vladmandic/human / face-api.js` as
> alternatives. Use `@vladmandic/human` as the primary choice. If it fails to initialize in
> CPU-only mode on any platform, fall back to `face-api.js` (`npm install face-api.js`) which
> has broader compatibility but lower accuracy. Document which library is in use in a comment
> at the top of `face-detector.ts`.

### 6.1 Install Face Detection Library

- [ ] Install `@vladmandic/human`: `npm install @vladmandic/human`
- [ ] Download required model files (face detection + landmark + iris models) to `src/main/models/`
- [ ] Configure Human with `backend: 'node'`, point `modelBasePath` to bundled models directory
- [ ] Verify Human initializes without GPU — CPU-only mode must work on all three platforms
- [ ] If Human fails CPU initialization on any platform, install `face-api.js` as the fallback and update `face-detector.ts` accordingly

### 6.2 Define FaceMetadata Type

- [ ] In `src/shared/types.ts`, add:
  ```ts
  type FaceBoundingBox = {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  type FaceMetadata = {
    hasFaces: boolean;
    faceCount: number;
    eyesOpen: boolean; // true if all detected faces have open eyes
    blinkDetected: boolean; // true if any face shows blink
    expressionNeutral: boolean;
    boundingBoxes: FaceBoundingBox[];
    exceedsFaceLimit: boolean; // true if faceCount > maxFacesPerImage setting
  };
  ```

### 6.3 Create the Face Detector Module

- [ ] Create `src/main/face-detector.ts`
- [ ] Implement `detectFaces(imageBuffer: Buffer, maxFacesPerImage?: number): Promise<FaceMetadata>`:
  - Decode buffer to tensor (Human accepts Node.js Buffer via `human.image()`)
  - Run `human.detect(tensor, { face: { enabled: true }, body: { enabled: false }, hand: { enabled: false } })`
  - Extract face count, bounding boxes, eye open/close states, expression
  - Determine `eyesOpen` = all detected faces have left+right iris score above threshold
  - Determine `blinkDetected` = any face has eye openness below blink threshold
  - Determine `exceedsFaceLimit` = `maxFacesPerImage > 0 && faceCount > maxFacesPerImage`
  - Return `FaceMetadata`
  - If no faces detected, return `{ hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false }`
- [ ] Add input guard: skip detection if image dimensions are too small (< 64px)
- [ ] Ensure no face data is logged, stored, or transmitted externally

### 6.4 Wire into Pipeline

- [ ] In `image-processor.ts`, after producing each `ImageRecord`, call `detectFaces(buffer, settings.maxFacesPerImage)` and assign the result to `record.faceMetadata`
  - This is type-safe because `faceMetadata` was added as an optional field to `ImageRecord` in Phase 5.1
- [ ] Add IPC handler: `'scan-faces'` — takes a single base64 image and optional `maxFacesPerImage`, returns `FaceMetadata`

### 6.5 🔥 Apply Face Count Limit

- [ ] In the orchestrator (Phase 10), if `faceMetadata.exceedsFaceLimit` is true, immediately mark the image as rejected (tier = `rejected`) and skip AI scoring. Add a reason: "Exceeds face limit (X > Y)"
- [ ] Log this as a separate counter in `outputShortfallReasons`

✅ **Done Criteria:** Portrait images return `hasFaces: true` with correct bounding boxes. Landscape images return `hasFaces: false`. Blink test image returns `blinkDetected: true`. Images with more faces than the configured limit are automatically rejected without using an AI call. The reason appears in the final shortfall summary.

---

## Phase 7 — Duplicate Detection

> Goal: Burst shots are grouped and only the best candidate from each group proceeds to scoring.

### 7.1 Install Perceptual Hashing Library

- [ ] Install `imghash`: `npm install imghash`
  > **Recommended choice (fix #7):** `imghash` provides DCT-based perceptual hashing with a
  > straightforward Node.js API. If `imghash` does not support a required format or buffer input,
  > fall back to `looks-same` (for comparison) or implement a custom DCT hash over Sharp's pixel
  > output. Document the final choice in a comment at the top of `duplicate-detector.ts`.
- [ ] Benchmark hash computation time on 10 images — should be < 100ms each

### 7.2 Define DuplicateGroup Type

- [ ] In `src/shared/types.ts`, add:
  ```ts
  type DuplicateGroup = {
    representative: ImageRecord; // the one that proceeds to scoring
    duplicates: ImageRecord[]; // the rest — skipped from scoring
  };
  ```

### 7.3 Create the Duplicate Detector Module

- [ ] Create `src/main/duplicate-detector.ts`
- [ ] Implement `computeHash(imageBuffer: Buffer): Promise<string>` — returns perceptual hash string
- [ ] Implement `hammingDistance(hashA: string, hashB: string): number` — count differing bits
- [ ] Implement `groupDuplicates(images: ImageRecord[], threshold: number): Promise<DuplicateGroup[]>`:
  - Compute phash for every image
  - Build adjacency: images with distance ≤ threshold are in the same cluster
  - Use union-find or simple BFS to form groups
  - For each group, designate `representative` as the first image (ordering by filename = chronological for burst shots)
  - Images that are unique (not in any group) each become their own single-member group
- [ ] Export `DEFAULT_SIMILARITY_THRESHOLD = 10` as a configurable constant
- [ ] Add IPC handler: `'detect-duplicates'` — takes list of image IDs and hashes plus an optional `threshold` parameter, returns groups

### 7.4 🔥 Use User‑Configurable Threshold

- [ ] `groupDuplicates` already accepts `threshold` as a parameter (defined above). Pass `settings.duplicateThreshold` from the orchestrator.
- [ ] Update IPC handler `'detect-duplicates'` to accept `threshold` as a parameter and pass it through.

### 7.5 🔥 Skip Duplicate Grouping When Disabled

- [ ] In orchestrator, if `settings.disableDuplicateGrouping` is true, skip calling `groupDuplicates` entirely
- [ ] Instead, treat each image as its own group (representative = itself)
- [ ] Log a message in the processing log: "Duplicate grouping disabled – all images will be scored individually"

✅ **Done Criteria:** A folder of 5 near-identical burst shots groups into 1 cluster with 1 representative. 5 completely different images produce 5 single-member groups. Changing similarity threshold affects burst grouping. Disabling grouping scores every image. Both options persist across sessions.

---

## Phase 8 — Session Manager

> Goal: Every image score is persisted immediately. A crashed or cancelled run can be resumed at the exact point it stopped.

### 8.1 Define Session Types

- [ ] In `src/shared/types.ts`, add:
  ```ts
  type ScoreRecord = {
    filename: string;
    scores: ScoringWeights; // per-dimension scores 0-100
    total: number; // weighted composite score
    tier: "S" | "A" | "B" | "rejected";
    reasoning: string; // AI explanation text
    faceMetadata: FaceMetadata;
    keywords?: string[]; // populated by Phase 13b auto-tagging (optional)
    usage?: { inputTokens: number; outputTokens: number };
  };
  type SessionStatus = "running" | "completed" | "cancelled" | "crashed";
  type Session = {
    sessionId: string;
    createdAt: string; // ISO timestamp
    inputFolder: string;
    outputFolder: string;
    totalImages: number;
    scoredCount: number;
    status: SessionStatus;
    settings: AppSettings;
    scores: Record<string, ScoreRecord>; // keyed by filename
    discoveryContext: string; // AI discovery pass summary
    outputShortfallReasons?: ShortfallReasons;
  };
  type ShortfallReasons = {
    duplicatesSkipped: number;
    belowThreshold: number;
    faceDetectionFailed: number;
    exceededFaceLimit: number;
    burstGrouped: number;
  };
  ```

### 8.2 Create the Session Manager Module

- [ ] Create `src/main/session-manager.ts`
- [ ] Implement `createSession(settings: AppSettings, totalImages: number): Session`
- [ ] Implement `saveScore(sessionId: string, score: ScoreRecord): void`
  - Append to `session.json` in output folder immediately (do not batch)
  - Use atomic write pattern (write to temp file, rename) to prevent corruption
- [ ] Implement `loadSession(outputFolder: string): Session | null` — returns existing session if found
- [ ] Implement `hasExistingSession(outputFolder: string): boolean`
- [ ] Implement `getScoredFilenames(session: Session): Set<string>` — for skipping already-scored images on resume
- [ ] Implement `markSessionComplete(sessionId: string): void`
- [ ] Implement `markSessionCancelled(sessionId: string): void`
- [ ] Implement `clearSession(outputFolder: string): void` — deletes `session.json`

### 8.3 Wire IPC

- [ ] Add IPC handlers: `'session-create'`, `'session-load'`, `'session-save-score'`, `'session-mark-complete'`, `'session-mark-cancelled'`, `'session-clear'`, `'session-has-existing'`
- [ ] Expose all session IPC calls via preload script

✅ **Done Criteria:** A session created with 100 images, interrupted at image 47, reloads with `scoredCount: 47` and correctly identifies the 53 remaining unscored images.

---

## Phase 9 — Single AI Call (Enhanced)

> Goal: One image + one provider → one valid `ScoreRecord`. This is the atomic unit the whole pipeline is built on.
>
> **Important:** Claude's native API uses a different endpoint and request format from the
> OpenAI-compatible standard. The AI client must branch on provider. See step 9.3 for details.
>
> ⚠️ **README note (fix #5):** The README currently states "CullAI uses the OpenAI-compatible
> API standard" as a blanket statement. This is inaccurate for Claude. Before public release,
> update the README to clarify: "Claude uses the native Anthropic API (`/v1/messages`);
> all other providers use the OpenAI-compatible format (`/chat/completions`)."

### 9.1 Define AI Call Interfaces

- [ ] In `src/shared/types.ts`, add:
  ```ts
  type AICallParams = {
    imageBase64: string;
    filename: string;
    discoveryContext: string;
    styleProfile: StyleProfile;
    weights: ScoringWeights;
    faceMetadata: FaceMetadata;
    provider: AIProvider;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  type AIRawResponse = {
    scores: ScoringWeights;
    reasoning: string;
    usage?: { inputTokens: number; outputTokens: number };
  };
  ```

### 9.2 Build the Scoring Prompt

- [ ] In `src/main/ai-client.ts`, implement `buildScoringPrompt(params: AICallParams): string`:
  - Include context summary from discovery pass
  - Include user's preference description
  - Include the scoring rubric with each dimension name and its current weight %
  - Include face metadata (e.g. "Face detected: yes, eyes open: yes, blink: no")
  - Instruct AI to respond in strict JSON format only:
    ```json
    {
      "quality": 0-100,
      "aesthetic": 0-100,
      "composition": 0-100,
      "sharpness": 0-100,
      "exposure": 0-100,
      "faceEyes": 0-100,
      "reasoning": "Plain text explanation"
    }
    ```
  - Explicitly forbid markdown, backticks, or preamble in the response

### 9.3 Implement the AI Client

- [ ] Create `src/main/ai-client.ts`
- [ ] Implement `callAI(params: AICallParams): Promise<AIRawResponse>` with **provider-specific routing**:

  **For Claude (Anthropic native API):**
  - POST to `https://api.anthropic.com/v1/messages` (always this URL, regardless of `baseUrl` for Claude)
  - Headers: `x-api-key: {apiKey}`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`
  - Request body uses Anthropic Messages format:
    ```json
    {
      "model": "{model}",
      "max_tokens": 1024,
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "image",
              "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": "{imageBase64}"
              }
            },
            { "type": "text", "text": "{prompt}" }
          ]
        }
      ]
    }
    ```
  - Parse response: extract `content[0].text`
  - Parse token usage from `response.usage.input_tokens` / `response.usage.output_tokens`

  **For OpenAI, Gemini, Ollama, Custom (OpenAI-compatible):**
  - POST to `baseUrl + '/chat/completions'`
  - Headers: `Authorization: Bearer {apiKey}`, `Content-Type: application/json`
  - Ollama: omit `Authorization` header (empty key is valid)
  - Request body uses OpenAI chat completions format with vision content array
  - Parse response: extract `choices[0].message.content`
  - Parse token usage from `response.usage.prompt_tokens` / `response.usage.completion_tokens`

- [ ] After extracting the raw text, strip any accidental markdown fences from the JSON string
- [ ] Parse JSON — if invalid, throw `AIParseError` with the raw response for debugging
- [ ] Implement `computeWeightedTotal(scores: ScoringWeights, weights: ScoringWeights): number` — weighted average to 2 decimal places
- [ ] Implement `scoreImage(params: AICallParams): Promise<ScoreRecord>` — calls `callAI()`, computes total, attaches usage, returns full `ScoreRecord` **without assigning tiers yet** (tier assignment happens in the orchestrator after all images are scored — see Phase 10)

### 9.4 Handle API Errors

- [ ] 401 Unauthorized → throw `AIAuthError` — "Invalid API key"
- [ ] 429 Too Many Requests → throw `AIRateLimitError` with `retryAfter` seconds from header
- [ ] 5xx Server Error → throw `AIServerError` — retryable
- [ ] Network timeout → throw `AITimeoutError`
- [ ] All errors must include provider name and model for debugging

### 9.5 End-to-End Test

- [ ] Write a manual test script: load one fixture JPEG, call `scoreImage()` with Claude, print the `ScoreRecord` to console
- [ ] Verify: all 6 dimension scores are 0–100, total is correctly weighted, reasoning is a non-empty string

### 9.6 🔥 Return Token Usage in Response

- [ ] `AIRawResponse` already includes optional `usage` (defined in 9.1). Ensure `callAI()` populates it for all providers that return usage data.
- [ ] If the provider does not return usage, set to `{ inputTokens: 0, outputTokens: 0 }`
- [ ] Store token usage in `ScoreRecord.usage`
- [ ] Return usage to caller for cumulative tracking (Phase 11 enhancement)

✅ **Done Criteria:** `scoreImage()` called with a real image and a real Claude API key (using the `/v1/messages` endpoint) returns a valid `ScoreRecord` with all 6 dimension scores populated. The same test passes with OpenAI and Ollama using their respective endpoints. Invalid JSON from AI is caught and rethrown as a typed error. Token usage is stored when available.

---

## Phase 10 — Full Batch Pipeline (Serial) + Input Validation

> Goal: Complete end-to-end flow with discovery pass, orchestrator, processing screen, **requested vs
> available validation**, and **post‑run output reason notification**.

### 10.1 Discovery Pass

- [ ] Create `src/main/orchestrator.ts`
- [ ] Implement `runDiscoveryPass(images: ImageRecord[], settings: AppSettings): Promise<string>`:
  - Select 5–8 representative sample images from the full set (evenly spaced by index)
  - If a reference image is set in `AppSettings`, prepend it to the sample set
  - Call `callAI()` once with all sample images and a discovery prompt: _"What genre is this shoot? What does 'best' mean in this context? Summarize in 2–3 sentences."_
  - Return the AI's summary string as `discoveryContext`
- [ ] Store `discoveryContext` in the session immediately after the discovery pass completes

### 10.2 Orchestrator (Serial Scoring Loop)

- [ ] In `orchestrator.ts`, implement `runPipeline(settings: AppSettings): AsyncGenerator<PipelineEvent>`:
  - Scan folder with filters → get full file list
  - Run duplicate detection → get `DuplicateGroup[]`; collect `duplicatesSkipped` count
  - Run face detection on all representative images; mark `exceedsFaceLimit` images as pre-rejected
  - Run discovery pass → store `discoveryContext` in session
  - For each representative `ImageRecord` (not pre-rejected):
    - Call `scoreImage()` → get `ScoreRecord` (no tier yet)
    - Save score to session immediately via `session-manager`
    - Emit `'pipeline-image-scored'` progress event
  - After all images scored, call `assignTiers(allScores)` (see below)
  - Compute `outputShortfallReasons` and store in session
  - Mark session complete

### 10.3 Build the Processing Screen

- [ ] Create `src/renderer/screens/Processing.tsx`
- [ ] On mount, check `'session-has-existing'` IPC — if an existing session is found, show the resume banner (Phase 16.3) before starting
- [ ] Display: progress bar (`scoredCount / totalImages`), current filename, estimated time remaining
- [ ] Show a scrollable log of scored images with their raw composite score
- [ ] "Cancel" button → calls `'session-mark-cancelled'` IPC and returns to Setup screen
- [ ] On pipeline complete, automatically transition to Results screen

### 10.4 Relative Tier Assignment (Post-Scoring)

- [ ] Implement `assignTiers(scores: ScoreRecord[]): ScoreRecord[]` in `orchestrator.ts`:
  - Exclude pre-rejected images (face limit, already marked rejected) from ranking pool
  - Sort remaining images by `total` score descending
  - **S-tier**: top 10% of the ranked pool (minimum 1 image if pool is non-empty)
  - **A-tier**: next 30% of the ranked pool
  - **B-tier**: next 30% of the ranked pool
  - **Rejected**: bottom 30% of the ranked pool, plus any image with `total < 30` regardless of percentile
    > Note: images from A or B tiers can be reclassified to Rejected if their `total < 30`.
    > Apply the absolute threshold check last, after percentile assignment.
  - Images pre-rejected before scoring retain `tier: 'rejected'`
- [ ] This relative/percentile-based approach ensures S-tier always represents the genuinely best shots from the current set, not an absolute score threshold

### 10.5 Input Count Validation

- [ ] In orchestrator, after scanning folder with filters, compare `filteredImageCount` with `settings.numImagesToSelect`
- [ ] If `numImagesToSelect > filteredImageCount`, emit a warning to renderer and ask for confirmation (via dialog). If user confirms, proceed with all available images.

### 10.6 Output Shortfall Notification

- [ ] After scoring completes and tiers are assigned, compute final selected image count (S + A tier images)
- [ ] If `numImagesToSelect === 0`, do not show a "requested vs available" warning. Instead, show:
      "No target quantity set → exported all S‑tier images (X total)."
- [ ] If `finalSelectedCount < settings.numImagesToSelect`, collect reasons into `outputShortfallReasons`
- [ ] Store breakdown in session as `outputShortfallReasons`
- [ ] Send IPC event `'pipeline-output-summary'` with reasons to renderer

### 10.7 Update Processing Screen to Show Warning

- [ ] On receiving `'pipeline-output-summary'`, show an inline notification (non‑modal) with the reason summary, e.g. _"Requested 200 images, but only 187 selected. 13 excluded: 8 duplicates, 5 below quality threshold. Do you want to add the excluded ones to make it 200?"_ Give notification with option yes and no, if yes, add the excluded ones for total of 200.
- [ ] Keep notification until user dismisses or navigates away

✅ **Done Criteria:** If user requests 500 images but only 312 exist, a confirmation dialog appears. After processing, if only 287 are selected, a clear reason summary is shown. Tier assignment is always relative — the best shots in any folder receive S-tier regardless of their absolute score.

---

## Phase 10b — Concurrent Directory Processing

> Goal: Process all subfolders inside a selected root folder in one batch job.

### 10b.1 Add UI Toggle

- [ ] In Setup screen, add a checkbox: **"Process subfolders recursively"**
- [ ] Store `processSubfolders: boolean` in `AppSettings`

### 10b.2 Implement Recursive Scan

- [ ] Create `src/main/folder-walker.ts`
- [ ] Implement `walkFolders(rootPath: string): Promise<string[]>` – returns list of all subdirectory paths (excluding hidden folders like `.cullai_cache`)
- [ ] Modify orchestrator: if `processSubfolders` is true, treat each subfolder as a separate batch
- [ ] Process batches sequentially (or parallel with separate session files) – combine results into one master session
- [ ] Output folder: create subfolder structure mirroring input (or flatten with prefix option)

### 10b.3 Progress UI for Batches

- [ ] In Processing screen, show current batch: `Processing folder 3/12: "Reception"`
- [ ] Overall progress = (sum of scored across batches) / (total images across all batches)

### 10b.4 🔥 Preserve Subfolder Structure Option

- [ ] In Setup screen, add a checkbox: "Preserve folder structure in output" (only visible when "Process subfolders recursively" is checked)
- [ ] Store in `AppSettings` as `preserveSubfolderStructure`
- [ ] When enabled, for each input subfolder (e.g., `input/Wedding/Reception/`), create the same relative path under the output folder (e.g., `output/Wedding/Reception/`)
- [ ] When disabled (default), flatten all keepers into the root output folder
- [ ] If filename conflicts occur when flattening, append a suffix (`_1`, `_2`) to the copied filename

✅ **Done Criteria:** A folder with 5 subfolders processes all images across all subfolders. Final output contains keepers from all batches. Session resume works across batches. With recursive processing and "preserve structure" on, the output folder mirrors the input folder's hierarchy. With it off, all selected images land in a single folder (with conflict resolution).

---

## Phase 11 — Parallel Batching

> Goal: Replace serial scoring with concurrent API calls to dramatically reduce total processing time.

### 11.1 Create the Batch Scheduler

- [ ] Create `src/main/batch-scheduler.ts`
- [ ] Implement `BatchScheduler` class:
  - Constructor takes `{ concurrency: number, batchSize: number, onProgress, onError }`
  - `queue(images: ImageRecord[]): void` — adds images to internal queue
  - `run(): Promise<ScoreRecord[]>` — processes queue with N concurrent workers
  - Each worker takes `batchSize` images from queue, calls `scoreImage()` for each in the batch
  - Workers run simultaneously up to `concurrency` limit
  - Results collected as they arrive (not waiting for all workers)

### 11.2 Implement Rate Limiting & Retry

- [ ] On `AIRateLimitError`: pause that worker for `retryAfter` seconds, then retry the same image
- [ ] On `AIServerError` (5xx): retry up to 3 times with exponential backoff (1s, 2s, 4s)
- [ ] On `AIAuthError`: abort entire pipeline immediately, surface error to user
- [ ] On `AITimeoutError`: retry once, then mark image as scoring-failed with a note in reasoning
- [ ] Track retry count per image — log warnings if an image takes more than 2 retries

### 11.3 Replace Serial Loop in Pipeline

- [ ] In `orchestrator.ts`, replace the serial scoring `for` loop with `BatchScheduler.run()`
- [ ] Pass concurrency setting from `AppSettings`
- [ ] Emit `'pipeline-image-scored'` progress event after each individual image scores (not each batch)
- [ ] Scores still saved to session after each image via `session-manager`
- [ ] After `BatchScheduler.run()` resolves, call `assignTiers()` on all collected scores

### 11.4 Update Processing Screen

- [ ] Update time-remaining estimate to account for parallel processing (total time ÷ concurrency rate)
- [ ] Show current batch indicator in log: "Scoring batch 3/12 (5 parallel calls)..."

### 11.5 🔥 Live Cost & Token Tracking

- [ ] In `orchestrator.ts`, maintain cumulative `totalInputTokens`, `totalOutputTokens` across all scored images
- [ ] After each image scores, update the counters and emit IPC event `'pipeline-cost-update'` with the current totals
- [ ] In Processing screen, display:
  - Estimated total cost (using provider's per‑token pricing from `src/shared/constants.ts`)
  - Optionally show per‑provider cost breakdown
- [ ] If dry‑run mode is active, also show **predicted** cost based on average tokens per image (already in Phase 16.1)

✅ **Done Criteria:** 50-image folder with concurrency=5 completes in roughly 1/5 the time vs. serial. Rate limit errors cause retry (not crash). Auth errors abort and surface a clear message. User sees real‑time token usage and estimated cost while scoring runs. The estimate updates after each image or batch.

---

## Phase 12 — Results Screen (Enhanced)

> Goal: A full-featured gallery for reviewing, comparing, and manually adjusting AI selections.

### 12.1 Build ImageTile Component

- [ ] Create `src/renderer/components/ImageTile.tsx`
- [ ] Display: thumbnail image, filename, tier badge (S/A/B/Rejected with color coding), composite score number
- [ ] Expandable reasoning panel — click to show AI's reasoning text
- [ ] Per-dimension score bars — 6 mini bars showing each dimension score
- [ ] Visual selection state — highlighted border when selected
- [ ] Accept `score: ScoreRecord`, `isSelected: boolean`, `onClick: () => void` as props

### 12.2 Build the Results Screen Layout

- [ ] Create `src/renderer/screens/Results.tsx`
- [ ] Tab navigation: **S** / **A** / **B** / **Rejected** — each tab shows count badge
- [ ] Grid of `ImageTile` components for active tab
- [ ] "Open output folder" button — calls `'shell-open-folder'` IPC
- [ ] "Export results.json" button — calls `'export-results-json'` IPC
- [ ] "Export XMP sidecars" button — calls `'export-xmp'` IPC (if auto-export was off)
- [ ] "Save style profile from this session" button — opens a name-entry dialog
- [ ] "Back to Setup" button — clears state and navigates to Setup screen

### 12.3 Build CompareView Component

- [ ] Create `src/renderer/components/CompareView.tsx`
- [ ] Activated when user selects 2–4 images (multi-select via Shift+click or Ctrl+click)
- [ ] Side-by-side panel showing each selected image at equal size
- [ ] Below each image: score breakdown bars + tier badge + reasoning text
- [ ] "Close compare" button returns to grid view
- [ ] Handle 2, 3, and 4 image layouts correctly (2-column, 3-column, 2×2 grid)

### 12.4 Build FaceOverlay Component

- [ ] Create `src/renderer/components/FaceOverlay.tsx`
- [ ] On hover over an `ImageTile`, show bounding boxes for detected faces
- [ ] Use `position: absolute` boxes calculated from `FaceBoundingBox` coordinates scaled to thumbnail size
- [ ] Color code: green box = eyes open, orange box = blink detected
- [ ] Only render if `faceMetadata.hasFaces === true`

### 12.5 Build KeyboardCuller Component

- [ ] Create `src/renderer/components/KeyboardCuller.tsx`
- [ ] Attach `keydown` listener to `document` when Results screen is mounted
- [ ] Implement shortcuts:
  - `↑` / `↓` — move focus to previous/next image in current tab
  - `P` — pick: move focused image to A-tier if in lower tier
  - `X` — reject: move focused image to Rejected tier
  - `R` — rescue: move focused image up one tier
  - `C` — open compare mode for selected images
  - `Escape` — close compare mode or clear selection
- [ ] Show a keyboard shortcut legend/tooltip in the UI (dismissable)
- [ ] Detach listener on component unmount

✅ **Done Criteria:** Results screen renders all tiers correctly. Keyboard shortcuts work. Compare mode shows side-by-side images with score breakdowns. Face overlay appears on hover when faces were detected.

---

## Phase 12b — Results Performance & UX

> Goal: The Results screen handles large image sets without lag, and supports advanced review workflows.

### 12b.1 Add Virtualized Grid

- [ ] Install `react-window`: `npm install react-window`
- [ ] In `Results.tsx`, replace simple grid with `FixedSizeGrid` or `VariableSizeGrid`
- [ ] Only render tiles that are visible in the viewport
- [ ] Lazy‑load high‑res previews when tile becomes visible

### 12b.2 Add Undo for Manual Overrides

- [ ] Create a simple undo stack in Results screen state: store `{ previousTier, imageId, timestamp }` (max 20 entries)
- [ ] On `P`, `X`, `R`, or drag‑and‑drop tier change, push previous state to stack
- [ ] Add keyboard shortcut: `Cmd+Z` / `Ctrl+Z` – pop last action and revert tier
- [ ] Show a small toast: "Undo moved IMG_001 back to A tier"

### 12b.3 Add Before/After Slider in Compare Mode

- [ ] In `CompareView.tsx`, when exactly 2 images are selected, add a toggle: "Split‑screen slider"
- [ ] Render two images absolutely positioned, with a draggable vertical divider
- [ ] On slider drag, clip left/right images accordingly

### 12b.4 🔥 Re‑Score Selected Images with New Weights

- [ ] Add a button in the Results screen toolbar: "Re‑score selected (with current weights)"
- [ ] Enabled only when one or more images are selected in the active tab
- [ ] On click, collect the `ImageRecord`s for selected images (from the session)
- [ ] Call a new IPC `'re-score-images'` with the list of image IDs, current `AppSettings` (weights, etc.)
- [ ] Re‑use the existing scoring pipeline (including face metadata, discovery context) but skip duplicate detection and scanning
- [ ] Re-run `assignTiers()` on the updated scores and refresh the UI
- [ ] Show a progress modal: "Re‑scoring 12 images…"

### 12b.5 🔥 Export Scores as CSV

- [ ] Add "Export CSV" button next to "Export results.json"
- [ ] Generate a CSV file with columns: Filename, Tier, Total Score, Quality, Aesthetic, Composition, Sharpness, Exposure, FaceEyes, Reasoning
- [ ] Use the same file‑save dialog as JSON export, default name `cullai_scores.csv`
- [ ] CSV is UTF‑8 encoded and can be opened in Excel / Google Sheets

### 12b.6 🔥 Export Session as Portable Archive

- [ ] Install `archiver`: `npm install archiver` and `npm install --save-dev @types/archiver`
  > **Fix #8:** This install step was missing from the original todo. `archiver` is required
  > for the zip export feature below.
- [ ] Add "Export session bundle (.zip)" button
- [ ] Zip includes: `session.json`, `results.json`, and **all XMP sidecar files** generated for this session (if XMP export was enabled)
- [ ] Does **not** include original or output images – only metadata
- [ ] Show progress during zip creation and then save dialog

### 12b.7 🔥 Reject / Keep Count Badges in Tab Headers

- [ ] In addition to the count badge (e.g., "S (12)"), show a small proportion bar or tooltip: "12 of 200 total"
- [ ] Keep it clean – optionally show "12/200" next to the tab name

✅ **Done Criteria:** Results screen handles 10,000 images without lag. Undo works for manual tier changes. Two‑image compare mode has a working split‑screen slider. All new export and re‑scoring features work without crashing. Re‑scoring updates the session and UI correctly. CSV exports contain all scores.

---

## Phase 13 — XMP Export

> Goal: Every scored image has an XMP sidecar file that Lightroom Classic and Capture One can read natively.

### 13.1 Choose XMP Writing Strategy

- [ ] Evaluate `xmp-metadata` npm package (listed in README tech stack): install it and test writing a minimal XMP file with `xmp:Rating` and `dc:description`
- [ ] **If the package handles XMP namespace declarations and `rdf:RDF` wrapper correctly**, use it as the primary writer
- [ ] **If the package is insufficient** (incorrect namespaces, malformed XML, or cannot handle `dc:subject` arrays), build a custom XML writer using Node.js built-ins (`DOMImplementation` or a simple string template). The XMP spec requires correct namespace prefixes (`x:xmpmeta`, `rdf:RDF`, `rdf:Description`) — incorrect namespaces cause Lightroom to silently ignore the sidecar.
- [ ] Verify the chosen approach by opening the output `.xmp` in Lightroom Classic and confirming the star rating and color label appear before proceeding with the full implementation.

### 13.2 Define XMP Mapping

- [ ] Map score tiers to Lightroom star ratings:
  - S-tier → 5 stars (`xmp:Rating = 5`)
  - A-tier → 4 stars (`xmp:Rating = 4`)
  - B-tier → 3 stars (`xmp:Rating = 3`)
  - Rejected → 1 star (`xmp:Rating = 1`)
- [ ] Map tiers to Lightroom color labels:
  - S-tier → Green
  - A-tier → Blue
  - B-tier → Yellow
  - Rejected → Red
- [ ] Include CullAI reasoning as `dc:description` field in XMP (optional, configurable)

### 13.3 Create the XMP Writer Module

- [ ] Create `src/main/xmp-writer.ts`
- [ ] Implement `writeXmpSidecar(score: ScoreRecord, originalPath: string): Promise<void>`:
  - Determine sidecar path: same directory + same basename + `.xmp` extension
  - Build XMP XML with correct namespace declarations (`x:xmpmeta`, `rdf:RDF`, `rdf:Description`)
  - Write `xmp:Rating`, `xmp:Label`, `dc:description` fields
  - Write file (overwrite if exists)
- [ ] Implement `writeAllSidecars(scores: ScoreRecord[], inputFolder: string): Promise<void>` — writes all sidecars in parallel with `Promise.all()`
- [ ] Add IPC handler: `'export-xmp'` — takes session data, writes all sidecars, returns count written

✅ **Done Criteria:** After scoring, XMP sidecars appear next to originals. Star ratings and color labels are visible in Lightroom Classic immediately after import. The XMP approach (library or custom) was validated in Lightroom before full implementation.

---

## Phase 13b — AI‑Powered Auto‑Tagging

> Goal: S-tier and A-tier keepers receive descriptive keyword tags written into their XMP sidecars,
> enabling fast searching in Lightroom and Capture One.
>
> ⚠️ **README Gap (fix #4):** This feature is not listed in the README's Features section, but
> the Final Checklist references it ("no keywords" for Free tier). Before completing this phase,
> add "AI keyword tagging for S/A-tier keepers" to the README features list, and note that it is
> a Pro-tier feature.

### 13b.1 Create the Auto-Tagging Module

- [ ] Create `src/main/auto-tagging.ts`
- [ ] After scoring and tier assignment are complete, collect all S-tier and A-tier `ImageRecord`s
- [ ] For each qualifying image, call the AI with a separate, lightweight prompt: _"Generate 5–10 descriptive keywords for this image. Return as a JSON array of strings only, no other text."_
- [ ] To save API costs, only tag the top 20% of S+A keepers by score (configurable via `AppSettings.tagTopPercent`)
- [ ] Batch tagging: send up to 5 images per API call (vision model can handle multiple images in one request) to minimise cost
- [ ] Parse the returned JSON array; on parse failure, log and skip (do not crash the pipeline)

### 13b.2 Write Keywords to XMP

- [ ] Extend `writeXmpSidecar()` in `xmp-writer.ts` to accept an optional `keywords: string[]` parameter
- [ ] Write keywords under `<dc:subject>` as an `rdf:Bag` of `rdf:li` elements (the correct XMP structure for multi-value arrays)
- [ ] If keywords are empty or undefined, omit the `<dc:subject>` element entirely (do not write an empty bag)
- [ ] Re-export XMP sidecars for tagged images (overwrite existing sidecars)

### 13b.3 Wire into Setup Screen

- [ ] Add toggle in Setup screen: "Generate AI keywords (S/A tier only)" – default off
- [ ] Mark as a Pro feature — show lock icon for Free tier users
- [ ] Store setting in `AppSettings` as `enableAutoTagging`
- [ ] Add number input: "Tag top X% of keepers" (range 10–100, default 20)

### 13b.4 Store Keywords in Session

- [ ] `keywords?: string[]` is already part of `ScoreRecord` (added in Phase 8.1)
- [ ] After tagging, update `ScoreRecord.keywords` in session via `session-manager`
- [ ] Keywords should be re-exportable from the Results screen without re-running the AI (i.e., stored in session)

✅ **Done Criteria:** After scoring, sidecars for top-tier images contain `<dc:subject>` with 5–10 relevant keywords visible in Lightroom. Keywords are stored in the session and included in CSV and ZIP exports. Disabling the toggle skips tagging entirely. Free tier users see the lock icon and cannot enable the feature.

---

## Phase 14 — Style Profile System

> Goal: Users can save, load, and manage named scoring configurations across sessions.

### 14.1 Build StyleProfileManager Component

- [ ] Create `src/renderer/components/StyleProfileManager.tsx`
- [ ] Dropdown listing all saved profiles by name + a "New Profile" option
- [ ] "Load" button — populates Setup screen fields from selected profile
- [ ] "Save current as..." button — opens inline name input, saves current settings as new profile
- [ ] "Delete" button — removes selected profile (with confirmation dialog)
- [ ] "Rename" button — inline edit of profile name
- [ ] Free tier: disable "Create New" if user already has 2 profiles; show upgrade prompt
- [ ] Display profile metadata: genre, creation date, last used date

### 14.2 Wire Profile Storage

- [ ] Add IPC handler: `'profiles-list'` — returns all saved `StyleProfile[]` from `electron-store`
- [ ] Add IPC handler: `'profiles-save'` — saves or updates a profile by ID
- [ ] Add IPC handler: `'profiles-delete'` — removes a profile by ID
- [ ] Generate UUID for each new profile
- [ ] Auto-save "Last Used" timestamp on profile load

### 14.3 Session History

- [ ] Store a summary of each completed session in `electron-store`:
      `{ date, inputFolder, imageCount, profileUsed, topScore, completedAt }`
- [ ] Display last 10 sessions in a collapsible "Recent Sessions" panel on Setup screen
- [ ] Clicking a session entry re-loads its settings into Setup screen

### 14.4 Save Profile from Results Screen

- [ ] "Save style profile from this session" button in Results screen:
  - Pre-fills name as `"[Genre] — [Date]"` (e.g. "Wedding — May 2026")
  - Saves current session's genre, weights, and preference text as a new profile
  - Respects Free tier 2-profile limit

✅ **Done Criteria:** User creates "Wedding — Natural Light" profile on first run. On second run, selects it from dropdown — all weights, genre, and preference text are auto-populated instantly.

---

## Phase 15 — Multi-Provider AI Support

> Goal: Claude, OpenAI, Gemini, Ollama, and custom endpoints all work as drop-in replacements.

### 15.1 Extend ai-client.ts for All Providers

- [ ] Define provider configs in `src/shared/constants.ts`:

```ts
PROVIDER_DEFAULTS = {
  claude: {
    // ⚠️ Claude uses NATIVE API, not OpenAI-compatible.
    // The endpoint is hardcoded to https://api.anthropic.com/v1/messages
    // baseUrl is only used for non-Claude providers.
    defaultModel: "claude-sonnet-4-20250514",
  },
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
  },
  ollama: { baseUrl: "http://localhost:11434/v1", defaultModel: "llava" },
  custom: { baseUrl: "", defaultModel: "" },
};
```

> **Note:** Keep model string defaults up to date as providers release new versions.
> The values above should reflect the most current stable vision models at build time.

- [ ] **In `ai-client.ts`, route based on provider:**
  - **If provider === 'claude'**:
    - Ignore `baseUrl` setting.
    - Use **`https://api.anthropic.com/v1/messages`** (never `/chat/completions`).
    - Headers: `x-api-key`, `anthropic-version: 2023-06-01`.
    - Request body follows Anthropic Messages format (as already implemented in Phase 9.3).
  - **For all other providers** (openai, gemini, ollama, custom):
    - Use `baseUrl + '/chat/completions'` (OpenAI-compatible).
    - Headers: `Authorization: Bearer {apiKey}` (omit for ollama).

- [ ] **Double-check**: The Claude branch must **never** append `/chat/completions`. Doing so will cause a 404.

### 15.2 Connection Validation

- [ ] Implement `validateProvider(provider: AIProvider, apiKey: string, baseUrl: string, model: string): Promise<boolean>`:
  - Send a minimal test request (single small image, 10-token max response)
  - Return `true` on 200, `false` on auth/network error
- [ ] Add IPC handler: `'validate-provider'`
- [ ] In Setup screen: add "Test Connection" button next to API key field
  - On click: spinner → green checkmark (success) or red X (failure) with error message

### 15.3 Ollama-Specific Handling

- [ ] For Ollama: skip API key input entirely (hide the field, do not require it)
- [ ] Add a "Check Ollama" button that pings `http://localhost:11434/api/tags` to verify Ollama is running and lists available models
- [ ] Populate model dropdown from Ollama's model list (filter to vision-capable models: llava, moondream, etc.)
- [ ] Show helpful message if Ollama is not running: "Ollama not found. Start Ollama and ensure a vision model is installed."

### 15.4 Auto-Populate Defaults

- [ ] When provider selection changes in Setup screen:
  - Auto-fill Base URL from `PROVIDER_DEFAULTS`
  - Auto-fill Model from `PROVIDER_DEFAULTS`
  - Clear API key field (different key per provider)

✅ **Done Criteria:** All 5 providers (Claude, OpenAI, Gemini, Ollama, Custom) complete a full 5-image scoring run without error. "Test Connection" gives accurate pass/fail for valid and invalid keys.

---

## Phase 16 — Polish & Error Handling

> Goal: The app feels production-grade — handles edge cases gracefully, gives users clear feedback at every step.

### 16.1 Dry-Run / Cost Estimate Mode

- [ ] After "Start" is clicked and dry-run toggle is on:
  - Scan folder and count images
  - Estimate tokens per image: `~800 tokens input + ~200 tokens output` (rough average)
  - Calculate total estimated tokens
  - Look up per-token pricing for selected model (use constants, not live API)
  - Display: "~4,200 images × 1,000 tokens = ~4.2M tokens ≈ $2.10 estimated cost"
  - Show "Proceed" and "Cancel" buttons
- [ ] Make pricing constants easy to update in `src/shared/constants.ts`

### 16.2 Estimated Time Remaining

- [ ] Track `startTime` when pipeline begins
- [ ] After each scored image: `elapsed = now - startTime`, `rate = scoredCount / elapsed`, `remaining = (totalImages - scoredCount) / rate`
- [ ] Display in Processing screen: "~3 min 42 sec remaining"
- [ ] Update every 5 seconds (not every image to avoid flicker)

### 16.3 Resume Banner

- [ ] On Processing screen mount: call `'session-has-existing'` IPC for the configured output folder
- [ ] If existing session found: show prominent banner:
  - "Previous session found: 47 of 200 images scored on May 14, 2026."
  - "Resume" button → continues from image 48
  - "Start Fresh" button → clears old session and starts over

### 16.4 Global Error Handling

- [ ] Wrap entire pipeline in try/catch — surface errors as user-readable messages in Processing screen
- [ ] Create a typed `CullAIError` base class with `code`, `message`, `recoverable: boolean`
- [ ] Error codes: `FREE_LIMIT_EXCEEDED`, `NO_IMAGES_FOUND`, `UNSUPPORTED_FORMATS_ONLY`, `AUTH_FAILED`, `OUTPUT_FOLDER_NOT_WRITABLE`, `LIBRAW_INSTALL_MISSING`, `OLLAMA_NOT_RUNNING`
- [ ] For recoverable errors: show "Retry" button
- [ ] For fatal errors: show full error message + "Back to Setup" button
- [ ] Never show raw stack traces to the user

### 16.5 Setup Screen Validation

- [ ] Before enabling "Start" button, validate:
  - Input folder exists and is readable
  - Output folder exists (or can be created) and is writable
  - At least one supported image file exists in input folder
  - API key is set (or Ollama is selected)
  - Model name is not empty
- [ ] Show inline validation error messages below each invalid field
- [ ] Check free tier limits and show warnings before starting (not just after)

### 16.6 Empty States

- [ ] No images found in folder → "No supported images found in this folder. Supported formats: JPEG, PNG, HEIC, RAW..."
- [ ] All images already scored (perfect resume) → "All images already scored in a previous session. View results?"
- [ ] Zero faces detected in portrait session → show info banner: "No faces detected. Consider setting Face & Eyes weight to 0% for this genre."

### 16.7 Add Output Shortfall Estimation in Dry‑Run

- [ ] In dry‑run mode, after counting images, estimate likely output shortfall:
  - Assume ~10% duplicates (if burst mode)
  - Assume ~5% quality rejection (based on heuristics)
  - Show: _"Estimated final keepers: ~180–195 out of 200 requested (due to duplicates and quality filtering)"_

### 16.8 🔥 Resume Banner Enhancement – Show Remaining Time & Cost

- [ ] In Processing screen, when a pending session is found, after loading the session, compute:
  - Remaining images = `totalImages - scoredCount`
  - Estimated remaining time = `(elapsedTime / scoredCount) * remainingImages` (if scoredCount > 0)
  - Estimated remaining cost = `(totalCostSoFar / scoredCount) * remainingImages` (if scoredCount > 0 and costs tracked)
- [ ] Display these in the resume banner: "Resume from image 47/200 (~12 min remaining, ~$0.35 estimated)"

✅ **Done Criteria:** Starting with an empty folder shows a clear error. Cancelling mid-run, restarting, and choosing "Resume" continues from the correct image. Dry‑run shows both cost estimate and expected output range. Resume banner shows useful estimates to help user decide whether to resume or start fresh.

---

## Phase 17 — Test Suite

> Goal: Automated tests cover every pipeline stage. `npm test` passes cleanly.

### 17.1 Configure Test Runner

- [ ] Install Vitest (or Jest): `npm install --save-dev vitest`
- [ ] Configure `vitest.config.ts` to find tests in `tests/` directory
- [ ] Add `npm run test` and `npm run test:watch` scripts
- [ ] Add code coverage reporting: `npm run test:coverage`

### 17.2 Add Test Fixtures

- [ ] `tests/fixtures/sample.jpg` — a clear JPEG with a face, correct exposure
- [ ] `tests/fixtures/sample.png` — a landscape PNG, no faces
- [ ] `tests/fixtures/sample.heic` — an iPhone photo (HEIC format)
- [ ] `tests/fixtures/sample.cr3` — Canon RAW file
- [ ] `tests/fixtures/sample.nef` — Nikon RAW file
- [ ] `tests/fixtures/sample.arw` — Sony RAW file
- [ ] `tests/fixtures/sample.raf` — Fujifilm RAW file
- [ ] `tests/fixtures/sample.dng` — Adobe DNG file
- [ ] `tests/fixtures/burst_1.jpg` and `burst_2.jpg` — near-identical burst shots for dedup testing
- [ ] `tests/fixtures/blink.jpg` — a portrait where subject has eyes closed (for blink test)
- [ ] `tests/fixtures/benchmark/` — fixed set of 20 images for Phase 20 benchmark mode

### 17.3 Write raw-decoder Tests

- [ ] Create `tests/raw-decoder.test.ts`
- [ ] Test: `isRawFile('IMG_001.CR3')` → `true`
- [ ] Test: `isRawFile('photo.jpg')` → `false`
- [ ] Test: `decodeRaw(cr3FixturePath)` → returns a Buffer of valid JPEG data
- [ ] Test: `decodeRaw(nefFixturePath)` → returns a Buffer of valid JPEG data
- [ ] Test: `decodeRaw(arwFixturePath)` → returns a Buffer of valid JPEG data
- [ ] Test: `decodeRaw(rafFixturePath)` → returns a Buffer of valid JPEG data
- [ ] Test: `decodeRaw(dngFixturePath)` → returns a Buffer of valid JPEG data
- [ ] Test: `decodeRaw('nonexistent.cr3')` → throws `RawDecodeError`

### 17.4 Write duplicate-detector Tests

- [ ] Create `tests/duplicate-detector.test.ts`
- [ ] Test: `computeHash(buffer)` → returns a string of expected length
- [ ] Test: `hammingDistance(hashA, hashA)` → `0` (identical image)
- [ ] Test: `hammingDistance(hashA, hashB)` for burst shots → distance ≤ threshold
- [ ] Test: `hammingDistance(hashA, hashC)` for unrelated images → distance > threshold
- [ ] Test: `groupDuplicates([burst_1, burst_2, landscape])` → 2 groups: 1 pair + 1 singleton
- [ ] Test: `groupDuplicates([unique_1, unique_2, unique_3])` → 3 singleton groups

### 17.5 Write face-detector Tests

- [ ] Create `tests/face-detector.test.ts`
- [ ] Test: `detectFaces(faceJpegBuffer)` → `hasFaces: true`, `faceCount >= 1`, `boundingBoxes.length >= 1`
- [ ] Test: `detectFaces(landscapeJpegBuffer)` → `hasFaces: false`, `faceCount: 0`
- [ ] Test: `detectFaces(blinkJpegBuffer)` → `blinkDetected: true`
- [ ] Test: face bounding boxes are within image dimensions (x, y, width, height are valid)

### 17.6 Write scoring-weights Tests

- [ ] Create `tests/scoring-weights.test.ts`
- [ ] Test: `normalizeWeights({ quality: 50, aesthetic: 50, composition: 0, sharpness: 0, exposure: 0, faceEyes: 0 })` → all sum to 100
- [ ] Test: adjusting any single slider → remaining weights scale proportionally → sum stays 100
- [ ] Test: `computeWeightedTotal(scores, weights)` → result is within 0–100
- [ ] Test: `computeWeightedTotal` with landscape preset (faceEyes: 0) → faceEyes score does not affect total
- [ ] Test: all 7 genre presets → each sums to exactly 100

### 17.7 Write xmp-writer Tests

- [ ] Create `tests/xmp-writer.test.ts`
- [ ] Test: `writeXmpSidecar(sScoreRecord, '/tmp/IMG_001.jpg')` → creates `/tmp/IMG_001.xmp`
- [ ] Test: S-tier sidecar has `xmp:Rating = 5`
- [ ] Test: A-tier sidecar has `xmp:Rating = 4`
- [ ] Test: Rejected sidecar has `xmp:Rating = 1`
- [ ] Test: sidecar XML is valid and parseable (use Node.js `DOMParser` or `fast-xml-parser`)
- [ ] Test: sidecar contains correct XMP namespace declarations

### 17.8 Write session-manager Tests

- [ ] Create `tests/session-manager.test.ts`
- [ ] Test: `createSession()` → returns session with `status: 'running'`, `scoredCount: 0`
- [ ] Test: `saveScore()` × 47 → session file exists, `scoredCount: 47`
- [ ] Test: `loadSession()` after saveScore × 47 → returns session with 47 scores intact
- [ ] Test: `getScoredFilenames()` → returns a Set of 47 filenames
- [ ] Test: `markSessionCancelled()` → session file has `status: 'cancelled'`
- [ ] Test: `clearSession()` → session file is deleted
- [ ] Test: simulate file write interruption (write partial JSON) → `loadSession()` handles gracefully (returns null or repairs)

### 17.9 New Tests for Added Features

- [ ] Test extension filter: `scanFolder` with filter `{'.cr3'}` returns only CR3 files
- [ ] Test prefix filter: `scanFolder` with prefix `['IMG_']` excludes `DSC_001.jpg`
- [ ] Test subfolder processing: `walkFolders` returns correct depth of directories
- [ ] Test RAW caching: second decode reads from cache, no libraw call
- [ ] Test output shortfall reasons: session stores and retrieves reason breakdown
- [ ] Test undo stack: manual tier change can be reverted
- [ ] Test keyword tagging: XMP sidecar contains valid `<dc:subject>` array

### 17.10 🔥 Mock AI Server for Integration Tests

- [ ] Create `tests/mock-ai-server.ts` – a lightweight HTTP server that implements the OpenAI chat completions endpoint
- [ ] Accepts JSON payload, returns deterministic scores based on filename or a simple rule (e.g., if filename contains "good" → high scores)
- [ ] Add a test flag `--use-mock-ai` that overrides the configured provider's base URL to `http://localhost:${port}/v1` and disables authentication
- [ ] Write integration tests that start the mock server, run a small pipeline, and assert scores match expected patterns
- [ ] Ensure no real API calls are made when mock server is active (by checking that `process.env.NODE_ENV === 'test'`)

✅ **Done Criteria:** `npm test` runs all test files and passes with 0 failures. Coverage report shows >80% coverage on all pipeline modules. Running `npm test` starts the mock server automatically, runs pipeline tests without consuming API credits, and shuts down the server afterwards.

---

## Phase 18 — Packaging & Release

> Goal: Downloadable installers for Windows, macOS, and Linux that install and run cleanly.

### 18.1 Configure electron-builder

- [ ] In `electron-builder.config.ts`, set:
  - `appId: 'app.cullai.desktop'`
  - `productName: 'CullAI'`
  - `copyright: 'Copyright © 2026 CullAI'`
  - Windows target: `nsis` → produces `.exe` installer
  - macOS target: `dmg` + `zip` → produces `.dmg` and `.zip`
  - Linux target: `AppImage` → produces `.AppImage`
- [ ] Configure `files` to include: `dist/`, `src/main/models/` (face detection models), and native addons
- [ ] Configure `asarUnpack` to unpack native addons (`.node` files must not be inside `.asar`)
- [ ] Set output directory: `release/`

### 18.2 Configure App Icon

- [ ] Create app icon: aperture + checkmark concept (see branding notes)
- [ ] Export to all required sizes: `1024×1024` PNG, `.icns` (macOS), `.ico` (Windows)
- [ ] Place icons in `build/` directory (electron-builder convention)
- [ ] Reference icons in `electron-builder.config.ts`

### 18.3 Bundle Native Addons

- [ ] Add `electron-rebuild` to `postinstall` npm script to rebuild libraw for Electron's Node version
- [ ] Verify libraw addon is listed in `asarUnpack` so it extracts correctly at runtime
- [ ] Bundle `@vladmandic/human` model files — add model directory to `files` config
- [ ] Test that the packaged app can decode a RAW file (libraw works after packaging)
- [ ] Test that face detection works after packaging (model files found at runtime)

### 18.4 Code Signing (macOS)

- [ ] Set up Apple Developer certificate in Keychain
- [ ] Configure `electron-builder` `mac.identity` with signing certificate name
- [ ] Configure `notarize.js` script for macOS notarization (required for Gatekeeper)
- [ ] Test: packaged `.dmg` opens without "unidentified developer" warning

### 18.5 Windows Signing (Optional but Recommended)

- [ ] Obtain code signing certificate (EV or OV)
- [ ] Configure `win.certificateFile` and `win.certificatePassword` via environment variable
- [ ] Test: installer runs without Windows SmartScreen warning

### 18.6 Set Up GitHub Actions CI/CD

- [ ] Create `.github/workflows/build.yml`
- [ ] Trigger on: push to `main` branch + any tag matching `v*`
- [ ] Jobs:
  - `build-windows` — runs on `windows-latest`
  - `build-macos` — runs on `macos-latest`
  - `build-linux` — runs on `ubuntu-latest`
- [ ] Each job: checkout, setup Node.js 18, `npm ci`, `npm run build`
- [ ] On tag push: upload artifacts to GitHub Releases automatically
- [ ] Store signing secrets as GitHub Actions secrets

### 18.7 Install & Launch Testing

- [ ] Windows: install from `.exe`, launch, verify: window opens, API key field works, one image processes end-to-end
- [ ] macOS: mount `.dmg`, drag to Applications, launch, verify: no Gatekeeper warning, full flow works
- [ ] Linux: make `.AppImage` executable, run, verify: window opens, full flow works
- [ ] Test on a clean machine (no Node.js installed) to verify all dependencies are correctly bundled

### 18.8 Prepare Release

- [ ] Update version in `package.json` to `1.0.0`
- [ ] Tag the release: `git tag v1.0.0 && git push origin v1.0.0`
- [ ] GitHub Actions builds and uploads installers automatically
- [ ] Write release notes summarizing v1.0.0 features
- [ ] Update `README.md` download links to point to GitHub Releases

### 18.9 🔥 Automatic Update Notifications

- [ ] Integrate Electron `autoUpdater` using `electron-updater` package
- [ ] Configure `publish` in `electron-builder.config.ts` to target GitHub Releases
- [ ] On app start, check for updates silently once per day
- [ ] If an update is available, show a non‑modal notification: "New version X.X.X available. Download now?"
- [ ] Download and install on user confirmation (quit and install)
- [ ] Allow user to disable auto‑check in settings

### 18.10 🔥 Build Portable Windows Executable

- [ ] Add a new npm script: `npm run build:portable`
- [ ] Configure `electron-builder` with an extra `nsis` target that uses `oneClick` and `perMachine: false`, plus a `portable` target
- [ ] Output `CullAI-Portable.exe` that runs without installation (writes settings to `%APPDATA%\CullAI-portable` or same directory)
- [ ] Document on the download page for users without admin rights

✅ **Done Criteria:** On a clean machine with no development tools installed, the CullAI installer installs and runs cleanly on all three platforms. A full culling run of 20 images completes without error. The updater checks GitHub releases and downloads the new version. The portable `.exe` runs on a clean Windows machine without admin privileges.

---

## Phase 19 — CLI Mode & Automation

> Goal: Run CullAI entirely from the command line with no visible GUI window.
>
> **Architecture clarification (fix #10):** CullAI's pipeline (libraw, face detection, session manager)
> runs in Electron's main process, which is a full Node.js environment. CLI mode re-uses this same
> main process, but launches Electron with no visible `BrowserWindow`. This avoids duplicating the
> pipeline in a separate Node.js binary and keeps the native addon (libraw) working correctly.
> Use `app.commandLine.hasSwitch('headless')` in `src/main/index.ts` to detect CLI mode and skip
> creating the BrowserWindow when the flag is present.

### 19.1 Add CLI Entry Point

- [ ] In `src/main/index.ts`, check for `--headless` flag via `process.argv` or `app.commandLine`
- [ ] Install `commander` for argument parsing: `npm install commander`
- [ ] Create `src/cli/args.ts` — define and parse CLI arguments:
  ```bash
  cullai --input /photos --output /keepers --count 200 --provider ollama --headless
  ```
- [ ] Options: `--input`, `--output`, `--count`, `--provider`, `--api-key`, `--model`, `--weights`, `--no-xmp`, `--dry-run`
- [ ] When `--headless` is detected, skip `createWindow()` and run the pipeline directly in the main process

### 19.2 Reuse Pipeline Logic

- [ ] The existing pipeline in `orchestrator.ts` already runs in the main process — no extraction needed
- [ ] Wrap orchestrator call in a CLI runner function in `src/cli/runner.ts` that accepts parsed args and calls `runPipeline(settings)`
- [ ] Both GUI (via IPC) and CLI (via direct call) use the same `orchestrator.ts` code path

### 19.3 CLI Output

- [ ] Print progress to stdout: `[1/200] Scoring IMG_001.CR3...`
- [ ] On completion, print summary table with tier counts
- [ ] Output `results.json` path and output folder path
- [ ] Exit code 0 on success, non‑zero on error

### 19.4 Package CLI Separately

- [ ] Add a new npm script `npm run build:cli` that packages the Electron app with a wrapper shell script / batch file named `cullai-cli` that calls Electron with `--headless`
- [ ] Document CLI usage in README under a new "CLI Mode" section

✅ **Done Criteria:** Running `cullai --input ./test --output ./out --count 10 --provider ollama --headless` processes 10 images, writes XMPs, and exits with code 0 and a correct JSON summary in stdout.

---

## Phase 20 — Additional UX & Performance 🔥

> Goal: Final polish features that improve daily usage without disrupting core workflows.

### 20.1 Benchmark Mode (Hidden Flag)

- [ ] Add a CLI flag `--benchmark` that runs a standard test suite on a fixed set of images (in `tests/fixtures/benchmark/`)
- [ ] Measures and prints to console:
  - Time per stage: folder scan, RAW decode, face detection, duplicate detection, AI scoring (uses mock AI or a real provider if specified)
  - Memory usage peaks
  - Cache hit ratio (if caching enabled)
- [ ] Outputs a JSON report: `benchmark_YYYYMMDD_HHMMSS.json`
- [ ] Does not write any final output (XMP, copy files) unless `--output` is also provided

### 20.2 Background Maintenance

- [ ] On app start, run lightweight maintenance tasks:
  - Check for orphaned `.cullai_cache` folders (where input folder no longer exists) and offer to delete them (once a week)
  - Trim old session logs (keep last 30 sessions in `electron-store`)
- [ ] All maintenance is logged and can be disabled by advanced users via a hidden setting

### 20.3 Quick Action Buttons on Results Screen

- [ ] Add a floating action button (or right‑click context menu) with:
  - "Open containing folder" for the selected image
  - "Copy filename" / "Copy path"
  - "View in Lightroom" (if XMP was written, just a reminder – no direct integration)

✅ **Done Criteria:** `--benchmark` runs successfully and prints meaningful metrics. Background maintenance does not slow down startup. Right‑click offers useful shortcuts.

---

## Final Checklist Before v1.0 Ship

- [ ] All phases (1 through 20) completed with all checkboxes checked
- [ ] `npm test` passes with 0 failures (including mock AI tests)
- [ ] App runs clean on Windows, macOS, and Linux
- [ ] No API key ever appears in any log output
- [ ] XMP sidecars validated in Lightroom Classic (including keywords from Phase 13b)
- [ ] Free tier limits enforced correctly (500 images **per calendar month**, 2 profiles, no RAW, no XMP, no keywords)
- [ ] Pro/Lifetime tier unlocks all features
- [ ] **README.md is fully up to date:**
  - [ ] License/tier system documented (Free / Pro / Lifetime, feature gates)
  - [ ] AI keyword tagging listed in Features section
  - [ ] Claude API vs. OpenAI-compatible note added to Supported AI Providers table
  - [ ] CLI Mode section added
  - [ ] Download links updated to GitHub Releases
- [ ] CLI mode works on all three platforms
- [ ] Release tagged and installers published on GitHub Releases
- [ ] Auto‑updater test passes (installer upgrades from v0.9 to v1.0)
- [ ] Portable build runs on Windows without installation

---

_Written by Ashmin Dhungana · Updated May 2026_
