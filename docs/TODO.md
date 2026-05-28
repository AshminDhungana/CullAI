# CullAI — Developer TODO

> Work through each phase in order. Every phase builds on the one before it.
> Complete **all checkboxes** in a phase before moving to the next.
> The ✅ **Done Criteria** at the end of each phase is your exit test.

---

## Progress Overview

| Phase | Title                        | Status         |
| ----- | ---------------------------- | -------------- |
| 1     | Project Scaffold             | ⬜ Not Started |
| 2     | Setup Screen UI              | ⬜ Not Started |
| 3     | Secure Storage & License     | ⬜ Not Started |
| 4     | RAW Decoding Pipeline        | ⬜ Not Started |
| 5     | Image Processing Pipeline    | ⬜ Not Started |
| 6     | Face & Eye Detection         | ⬜ Not Started |
| 7     | Duplicate Detection          | ⬜ Not Started |
| 8     | Session Manager              | ⬜ Not Started |
| 9     | Single AI Call               | ⬜ Not Started |
| 10    | Full Batch Pipeline (Serial) | ⬜ Not Started |
| 11    | Parallel Batching            | ⬜ Not Started |
| 12    | Results Screen               | ⬜ Not Started |
| 13    | XMP Export                   | ⬜ Not Started |
| 14    | Style Profile System         | ⬜ Not Started |
| 15    | Multi-Provider AI Support    | ⬜ Not Started |
| 16    | Polish & Error Handling      | ⬜ Not Started |
| 17    | Test Suite                   | ⬜ Not Started |
| 18    | Packaging & Release          | ⬜ Not Started |

---

## Phase 1 — Project Scaffold

> Goal: A working Electron window that opens with a React + TypeScript app inside.

### 1.1 Initialize the Project

- [ ] Run `npm init` and set name to `cullai`, version `0.1.0`
- [ ] Install Electron: `npm install --save-dev electron`
- [ ] Install React + TypeScript: `npm install react react-dom` and `npm install --save-dev typescript @types/react @types/react-dom`
- [ ] Install Tailwind CSS: `npm install --save-dev tailwindcss postcss autoprefixer` and run `npx tailwindcss init`
- [ ] Install `electron-builder` for packaging: `npm install --save-dev electron-builder`
- [ ] Install `ts-node` and `tsx` for running TypeScript directly in dev
- [ ] Install `concurrently` and `wait-on` for dev server coordination

### 1.2 Configure TypeScript

- [ ] Create `tsconfig.json` with two project references:
  - `tsconfig.main.json` — targets Node.js (CommonJS), covers `src/main/`
  - `tsconfig.renderer.json` — targets browser (ESNext), covers `src/renderer/`
- [ ] Enable `strict: true`, `esModuleInterop: true` in both configs
- [ ] Exclude `node_modules` and `dist` from both configs

### 1.3 Build Folder Structure

- [ ] Create `src/main/` — Electron main process files
- [ ] Create `src/renderer/` — React UI files
- [ ] Create `src/renderer/screens/` — Setup, Processing, Results screen components
- [ ] Create `src/renderer/components/` — reusable UI components
- [ ] Create `src/shared/` — types and constants shared between main + renderer
- [ ] Create `tests/fixtures/` — sample images for tests (add at least one JPEG now)
- [ ] Create `tests/` — test files (empty for now)

### 1.4 Create Core Entry Files

- [ ] Create `src/main/index.ts` — Electron app entry point that creates a `BrowserWindow`
- [ ] Create `src/renderer/App.tsx` — root React component, renders `<h1>CullAI</h1>` as a placeholder
- [ ] Create `src/renderer/index.tsx` — ReactDOM render entry point
- [ ] Create `src/shared/types.ts` — empty file, ready for type definitions
- [ ] Create `src/shared/constants.ts` — define app name, version string
- [ ] Create `src/shared/genre-presets.ts` — empty file, ready for Phase 2

### 1.5 Configure Build Scripts

- [ ] Configure Tailwind `content` path to cover `src/renderer/**/*.{tsx,ts}`
- [ ] Add `npm run dev` script — starts Electron + Vite (or Webpack) renderer dev server together
- [ ] Add `npm run build` script — compiles TypeScript and runs `electron-builder`
- [ ] Add `npm run test` script — placeholder for Phase 17
- [ ] Create skeleton `electron-builder.config.ts` — set `appId`, `productName: "CullAI"`, output dirs for Win/Mac/Linux (leave targets empty for now)

### 1.6 Verify Scaffold

- [ ] Run `npm run dev` — Electron window opens with "CullAI" text rendered by React
- [ ] No TypeScript errors in console
- [ ] Hot reload works — editing `App.tsx` updates the window without restarting Electron

✅ **Done Criteria:** `npm run dev` opens a blank Electron window with React rendering correctly, no TS errors.

---

## Phase 2 — Setup Screen UI

> Goal: A fully functional, visually complete Setup/Settings screen. No backend yet — just the UI and client-side state.

### 2.1 Define Shared Types

- [ ] In `src/shared/types.ts`, define:
  - `ScoringWeights` — `{ quality, aesthetic, composition, sharpness, exposure, faceEyes: number }`
  - `GenrePreset` — union of `'general' | 'wedding' | 'portrait' | 'sports' | 'landscape' | 'street' | 'event'`
  - `AIProvider` — union of `'claude' | 'openai' | 'gemini' | 'ollama' | 'custom'`
  - `AppSettings` — all Setup screen fields as a single config object
  - `StyleProfile` — `{ id, name, genre, weights, preferenceText }`

### 2.2 Define Genre Presets

- [ ] In `src/shared/genre-presets.ts`, define the preset weight table:
  - General: `{ quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 }`
  - Wedding: `{ quality: 20, aesthetic: 20, composition: 10, sharpness: 15, exposure: 10, faceEyes: 25 }`
  - Portrait: `{ quality: 20, aesthetic: 15, composition: 10, sharpness: 15, exposure: 10, faceEyes: 30 }`
  - Sports: `{ quality: 25, aesthetic: 15, composition: 10, sharpness: 30, exposure: 10, faceEyes: 10 }`
  - Landscape: `{ quality: 25, aesthetic: 25, composition: 20, sharpness: 15, exposure: 15, faceEyes: 0 }`
  - Street: `{ quality: 20, aesthetic: 25, composition: 20, sharpness: 15, exposure: 10, faceEyes: 10 }`
  - Event: `{ quality: 20, aesthetic: 15, composition: 10, sharpness: 20, exposure: 10, faceEyes: 25 }`
- [ ] Export a `GENRE_PRESETS` map: `Record<GenrePreset, ScoringWeights>`

### 2.3 Build ScoringWeightsPanel Component

- [ ] Create `src/renderer/components/ScoringWeightsPanel.tsx`
- [ ] Render 6 labeled sliders: Quality, Aesthetic, Composition, Sharpness, Exposure, Face & Eyes
- [ ] Each slider: range 0–100, step 1
- [ ] Implement auto-normalization: when any slider changes, scale all 6 values so they always sum to exactly 100
- [ ] Display current % value next to each slider label
- [ ] Accept `weights: ScoringWeights` and `onChange: (weights: ScoringWeights) => void` as props

### 2.4 Build GenrePresetSelector Component

- [ ] Create `src/renderer/components/GenrePresetSelector.tsx`
- [ ] Render a styled `<select>` dropdown with all 7 genre options
- [ ] On selection, emit the chosen `GenrePreset` value
- [ ] Show a read-only weight preview beneath the dropdown (small text: "Quality 25% · Aesthetic 20% · ...")
- [ ] Accept `value: GenrePreset` and `onChange: (genre: GenrePreset) => void` as props

### 2.5 Build the Setup Screen

- [ ] Create `src/renderer/screens/Setup.tsx`
- [ ] **Input folder** — text input + "Browse" button (wire to `window.electronAPI.openFolderDialog()` — stub for now)
- [ ] **Output folder** — text input + "Browse" button (same stub)
- [ ] **Number of images to select** — number input + range slider, min 1, max 999, default 20
- [ ] **Genre preset selector** — embed `GenrePresetSelector`, on change auto-populate scoring weights
- [ ] **Style profile selector** — dropdown (stub: just shows "No profiles yet"), "Create New" button
- [ ] **Preference text box** — multi-line textarea, placeholder: `"e.g. sharp, well-lit portraits with natural light"`
- [ ] **Scoring weights panel** — embed `ScoringWeightsPanel`, weights update when genre preset changes
- [ ] **API provider selector** — radio buttons or dropdown: Claude / OpenAI / Gemini / Ollama / Custom
- [ ] **API key input** — password input field, hidden by default, show/hide toggle button
- [ ] **Base URL input** — text input, shown only when provider is Ollama or Custom
- [ ] **Model name input** — text input with smart default per provider (e.g. `claude-sonnet-4` for Claude)
- [ ] **Concurrency setting** — number input, range 1–10, default 5, label: "Parallel API calls"
- [ ] **Dry-run toggle** — checkbox: "Estimate token cost before processing"
- [ ] **XMP export toggle** — checkbox: "Write Lightroom/Capture One sidecar files"
- [ ] **Lightroom integration mode** — radio: "Rate originals in-place" vs. "Copy keepers to output folder"
- [ ] "**Start Culling**" button — disabled until input folder, output folder, and API key are filled

### 2.6 Wire App Routing

- [ ] Create simple screen state in `App.tsx`: `'setup' | 'processing' | 'results'`
- [ ] Render `<Setup />` when state is `'setup'`
- [ ] "Start Culling" button transitions state to `'processing'` (renders a blank placeholder for now)
- [ ] Apply Tailwind dark theme base styles — dark background, light text, amber/gold accent color

### 2.7 Persist Settings with electron-store

- [ ] Install `electron-store`: `npm install electron-store`
- [ ] Create IPC handler in `src/main/ipc-handlers.ts`: `'settings-get'` and `'settings-set'`
- [ ] Expose `window.electronAPI.getSettings()` and `window.electronAPI.saveSettings()` via preload script
- [ ] On Setup screen mount, load persisted settings and populate all fields
- [ ] On any field change, auto-save settings via debounced IPC call
- [ ] Verify settings survive app restart

✅ **Done Criteria:** All Setup screen fields render correctly, genre preset auto-populates sliders, weights always sum to 100, settings persist across restarts.

---

## Phase 3 — Secure Storage & License

> Goal: API keys encrypted at OS level; feature gates wired throughout the app.

### 3.1 Implement API Key Secure Storage

- [ ] Create `src/main/safe-storage.ts`
- [ ] Implement `storeApiKey(provider: AIProvider, key: string): void` using `safeStorage.encryptString()`
- [ ] Implement `getApiKey(provider: AIProvider): string | null` using `safeStorage.decryptString()`
- [ ] Implement `deleteApiKey(provider: AIProvider): void`
- [ ] Store encrypted bytes in `electron-store` under key `apiKeys.{provider}`
- [ ] Ensure raw key string is never written to any log or file
- [ ] Add IPC handlers: `'api-key-store'`, `'api-key-get'` (returns masked string `sk-...****`), `'api-key-delete'`
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
  - `unlimitedImages` — Pro and Lifetime only (Free: 500/month cap)
  - `unlimitedProfiles` — Pro and Lifetime only (Free: max 2 profiles)
- [ ] Implement `isAllowed(feature: Feature, tier: LicenseTier): boolean`
- [ ] Implement `getMonthlyImageCount(): number` — tracks usage in `electron-store`, resets monthly
- [ ] Add IPC handler: `'license-check-feature'`
- [ ] In Setup screen: show lock icon on RAW-related fields and XMP toggle if tier is Free
- [ ] In Setup screen: show upgrade prompt if monthly limit is approaching

✅ **Done Criteria:** API key stores and loads encrypted; deleting it removes it cleanly. License tier reads from file; Free tier shows lock icons on Pro features.

---

## Phase 4 — RAW Decoding Pipeline

> Goal: Any supported RAW file can be decoded to a usable JPEG buffer.

### 4.1 Install and Configure libraw

- [ ] Install `libraw` Node native addon: `npm install libraw` (or `@napi-rs/canvas` + libraw binding as available)
- [ ] Verify native compilation succeeds on your dev platform
- [ ] Note required system dependencies in `README.md` build section (already done)
- [ ] Ensure `electron-builder` is configured to rebuild native addons for each target platform (add `electron-rebuild` to build script)

### 4.2 Create the RAW Decoder Module

- [ ] Create `src/main/raw-decoder.ts`
- [ ] Define `RAW_EXTENSIONS` constant: `['.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.raf', '.dng', '.orf', '.rw2', '.pef', '.3fr']`
- [ ] Implement `isRawFile(filePath: string): boolean` — checks extension case-insensitively
- [ ] Implement `decodeRaw(filePath: string): Promise<Buffer>`:
  - Open file with libraw
  - Unpack raw data
  - Process through libraw's default pipeline
  - Output as full-quality JPEG buffer (or TIFF if JPEG not available)
  - Close libraw handle
- [ ] Implement proper error handling — throw a typed `RawDecodeError` with filename and reason
- [ ] Log decode time per file in dev mode for performance monitoring

### 4.3 Test RAW Decoding Manually

- [ ] Add at least one sample RAW file per major brand to `tests/fixtures/` (CR3, NEF, ARW, RAF, DNG minimum)
- [ ] Write a manual test script (not the full test suite yet) that decodes each fixture and writes output JPEG to disk
- [ ] Visually inspect each output JPEG — confirm correct colors, no corruption
- [ ] Measure decode time per format — log results

✅ **Done Criteria:** `decodeRaw()` successfully converts CR3, NEF, ARW, RAF, and DNG to JPEG buffers. Output images look correct visually.

---

## Phase 5 — Image Processing Pipeline

> Goal: Given an input folder, produce a list of `ImageRecord` objects with resized base64 data, ready for AI scoring.

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
  };
  ```

### 5.2 Create the Image Processor Module

- [ ] Create `src/main/image-processor.ts`
- [ ] Install `sharp`: `npm install sharp`
- [ ] Implement `scanFolder(folderPath: string): Promise<string[]>` — returns all image file paths in folder
  - Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, `.gif`, `.avif`, `.tiff`, `.tif` + all RAW extensions
  - Skip hidden files and system files (`.DS_Store`, `Thumbs.db`)
  - Sort alphabetically for deterministic ordering
- [ ] Implement `processImage(filePath: string): Promise<ImageRecord>`:
  - If `isRawFile(filePath)` → call `decodeRaw(filePath)` to get JPEG buffer
  - Else → read file with `fs.readFile()`
  - Pass buffer to Sharp: `sharp(buffer).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 })`
  - Encode Sharp output as base64
  - Return `ImageRecord`
- [ ] Implement `processFolder(folderPath: string): AsyncGenerator<ImageRecord>` — yields one record at a time (memory-efficient)

### 5.3 Wire IPC

- [ ] Add IPC handler in `ipc-handlers.ts`: `'scan-folder'` — takes folder path, returns file count + list of filenames
- [ ] Add IPC handler: `'process-images'` — streams `ImageRecord` objects back to renderer via `event.sender.send('image-processed', record)`
- [ ] Expose `window.electronAPI.scanFolder()` and `window.electronAPI.processImages()` in preload script
- [ ] Handle free tier limit: if image count > 500 and tier is Free, reject with error code `FREE_LIMIT_EXCEEDED`

✅ **Done Criteria:** Given a folder of mixed JPEGs and RAW files, `processFolder()` yields one correctly sized base64-encoded `ImageRecord` per image with no errors.

---

## Phase 6 — Face & Eye Detection

> Goal: Every image gets a `FaceMetadata` object populated before AI scoring. Zero face data leaves the device.

### 6.1 Install Face Detection Library

- [ ] Install `@vladmandic/human`: `npm install @vladmandic/human`
- [ ] Download required model files (face detection + landmark + iris models) to `src/main/models/`
- [ ] Configure Human with `backend: 'node'`, point `modelBasePath` to bundled models directory
- [ ] Verify Human initializes without GPU — CPU-only mode must work

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
  };
  ```

### 6.3 Create the Face Detector Module

- [ ] Create `src/main/face-detector.ts`
- [ ] Implement `detectFaces(imageBuffer: Buffer): Promise<FaceMetadata>`:
  - Decode buffer to tensor (Human accepts Node.js Buffer via `human.image()`)
  - Run `human.detect(tensor, { face: { enabled: true }, body: { enabled: false }, hand: { enabled: false } })`
  - Extract face count, bounding boxes, eye open/close states, expression
  - Determine `eyesOpen` = all detected faces have left+right iris score above threshold
  - Determine `blinkDetected` = any face has eye openness below blink threshold
  - Return `FaceMetadata`
  - If no faces detected, return `{ hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [] }`
- [ ] Add input guard: skip detection if image dimensions are too small (< 64px)
- [ ] Ensure no face data is logged, stored, or transmitted externally

### 6.4 Wire into Pipeline

- [ ] In `image-processor.ts`, after producing each `ImageRecord`, call `detectFaces(buffer)` and attach result as `record.faceMetadata`
- [ ] Add IPC handler: `'scan-faces'` — takes a single base64 image, returns `FaceMetadata`

✅ **Done Criteria:** Portrait images return `hasFaces: true` with correct bounding boxes. Landscape images return `hasFaces: false`. Blink test image returns `blinkDetected: true`.

---

## Phase 7 — Duplicate Detection

> Goal: Burst shots are grouped and only the best candidate from each group proceeds to scoring.

### 7.1 Install Perceptual Hashing Library

- [ ] Install a phash library compatible with Node.js (e.g. `sharp` with a custom DCT implementation, or `imghash`, or `looks-same`)
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
- [ ] Implement `groupDuplicates(images: ImageRecord[]): Promise<DuplicateGroup[]>`:
  - Compute phash for every image
  - Build adjacency: images with distance ≤ threshold (default: 10 bits) are in the same cluster
  - Use union-find or simple BFS to form groups
  - For each group, designate `representative` as the first image (ordering by filename = chronological for burst shots)
  - Images that are unique (not in any group) each become their own single-member group
- [ ] Export `SIMILARITY_THRESHOLD = 10` as a configurable constant
- [ ] Add IPC handler: `'detect-duplicates'` — takes list of image IDs and hashes, returns groups

✅ **Done Criteria:** A folder of 5 near-identical burst shots groups into 1 cluster with 1 representative. 5 completely different images produce 5 single-member groups.

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

## Phase 9 — Single AI Call

> Goal: One image + one provider (Claude) → one valid `ScoreRecord`. This is the atomic unit the whole pipeline is built on.

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
  type AIRawResponse = { scores: ScoringWeights; reasoning: string };
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
- [ ] Implement `callAI(params: AICallParams): Promise<AIRawResponse>`:
  - Build request body per OpenAI chat completions format
  - Include image as base64 in the `content` array (vision message format)
  - POST to `baseUrl + '/chat/completions'`
  - Set headers: `Authorization: Bearer {apiKey}`, `Content-Type: application/json`
  - Parse response: extract `choices[0].message.content`
  - Strip any accidental markdown fences from JSON string
  - Parse JSON — if invalid, throw `AIParseError` with the raw response for debugging
- [ ] Implement `computeWeightedTotal(scores: ScoringWeights, weights: ScoringWeights): number` — weighted average to 2 decimal places
- [ ] Implement `assignTier(total: number): 'S' | 'A' | 'B' | 'rejected'`:
  - S: top 10% of range (90+)
  - A: 75–89
  - B: 55–74
  - Rejected: < 55
- [ ] Implement `scoreImage(params: AICallParams): Promise<ScoreRecord>` — calls `callAI()`, computes total, assigns tier, returns full `ScoreRecord`

### 9.4 Handle API Errors

- [ ] 401 Unauthorized → throw `AIAuthError` — "Invalid API key"
- [ ] 429 Too Many Requests → throw `AIRateLimitError` with `retryAfter` seconds from header
- [ ] 5xx Server Error → throw `AIServerError` — retryable
- [ ] Network timeout → throw `AITimeoutError`
- [ ] All errors must include provider name and model for debugging

### 9.5 End-to-End Test

- [ ] Write a manual test script: load one fixture JPEG, call `scoreImage()` with Claude, print the `ScoreRecord` to console
- [ ] Verify: all 6 dimension scores are 0–100, total is correctly weighted, reasoning is a non-empty string, tier is assigned

✅ **Done Criteria:** `scoreImage()` called with a real image and a real Claude API key returns a valid `ScoreRecord` with all fields populated. Invalid JSON from AI is caught and rethrown as a typed error.

---

## Phase 10 — Full Batch Pipeline (Serial)

> Goal: The complete end-to-end flow works for any folder, processed one image at a time, with a live progress UI.

### 10.1 Implement Discovery Pass

- [ ] In `ai-client.ts`, implement `runDiscoveryPass(sampleImages: ImageRecord[], params): Promise<string>`:
  - Select 5–8 representative images (spread evenly across the sorted list)
  - Send all sample images in a single API call with a discovery prompt:
    - "Look at these sample photos. Describe: what genre are they? what does 'best' look like in this context? what technical qualities matter most?"
  - Return the AI's plain-text context summary string
  - Store in session as `discoveryContext`

### 10.2 Implement the Orchestrator

- [ ] Create `src/main/pipeline.ts` (or extend `ipc-handlers.ts`)
- [ ] Implement `runPipeline(settings: AppSettings)`:
  1. Create new session (or load existing if resuming)
  2. Scan input folder → get full image list
  3. Filter out already-scored images (resume case)
  4. Check free tier limit
  5. Process all images → `ImageRecord[]` (RAW decode + resize + base64)
  6. Run face detection on each image
  7. Run duplicate detection → get `DuplicateGroup[]`
  8. Collect representatives for scoring; mark duplicates as skipped
  9. Run discovery pass on 5–8 sample representatives
  10. Serial scoring loop: for each representative → call `scoreImage()` → save to session → emit progress IPC event
  11. After all scored: copy top N images to output folder
  12. Save `results.json` to output folder
  13. Mark session complete
  14. Emit `'pipeline-complete'` IPC event

### 10.3 Build the Processing Screen

- [ ] Create `src/renderer/screens/Processing.tsx`
- [ ] Progress bar — `scoredCount / totalImages * 100%`
- [ ] Current image filename being processed
- [ ] Live log — scrollable list of status messages (e.g. "Decoded raw file: IMG_001.CR3", "Scored: IMG_002.JPG — Score 87.4 (A-tier)")
- [ ] Estimated time remaining — calculate from elapsed time per image × remaining images
- [ ] Resume banner — if `session-has-existing` returns true on mount, show: "A previous session was found. Resume from image 47?" with Resume / Start Fresh buttons
- [ ] Cancel button — calls `'pipeline-cancel'` IPC, transitions to Setup screen

### 10.4 Connect Pipeline to App Navigation

- [ ] "Start Culling" in Setup → validates inputs → calls `'pipeline-start'` IPC → transitions to Processing screen
- [ ] `'pipeline-complete'` IPC event → transitions to Results screen (stub for now)
- [ ] `'pipeline-image-scored'` IPC event → updates progress bar and log in real-time

✅ **Done Criteria:** A folder of 20 mixed images (JPEG + 2 RAW) runs fully end-to-end: scanned → face-detected → deduplicated → discovery pass → serial scoring → results.json written to disk. Progress bar tracks correctly.

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

- [ ] In `pipeline.ts`, replace the serial scoring `for` loop with `BatchScheduler.run()`
- [ ] Pass concurrency setting from `AppSettings`
- [ ] Emit `'pipeline-image-scored'` progress event after each individual image scores (not each batch)
- [ ] Scores still saved to session after each image via `session-manager`

### 11.4 Update Processing Screen

- [ ] Update time-remaining estimate to account for parallel processing (total time ÷ concurrency rate)
- [ ] Show current batch indicator in log: "Scoring batch 3/12 (5 parallel calls)..."

✅ **Done Criteria:** 50-image folder with concurrency=5 completes in roughly 1/5 the time vs. serial. Rate limit errors cause retry (not crash). Auth errors abort and surface a clear message.

---

## Phase 12 — Results Screen

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

### 12.6 Manual Tier Overrides

- [ ] Allow drag-and-drop of image tiles between tier tabs
- [ ] On tier change: update local `ScoreRecord.tier`, re-render, update output folder (move/copy file if needed)
- [ ] Persist manual overrides to `session.json`

✅ **Done Criteria:** Results screen shows all images in correct tiers, tier tabs update counts live, compare mode works for 2–4 images, keyboard shortcuts navigate and tier-move correctly, face boxes appear on hover.

---

## Phase 13 — XMP Export

> Goal: Every scored image has an XMP sidecar file that Lightroom Classic and Capture One can read natively.

### 13.1 Install XMP Library

- [ ] Install `xmp-metadata` npm package: `npm install xmp-metadata`
  - If package is insufficient, plan a custom XML writer using Node.js built-ins
- [ ] Verify package can read and write `.xmp` files without modifying the original image

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

### 13.4 Auto-Export Integration

- [ ] In `pipeline.ts`, after scoring is complete: if `settings.xmpExport === true`, automatically call `writeAllSidecars()`
- [ ] Emit `'xmp-export-complete'` IPC event with count

### 13.5 Validate Output

- [ ] Open a sidecar `.xmp` file in a text editor — verify it is valid XML with correct XMP namespaces
- [ ] Import folder into Lightroom Classic (if available) — verify star ratings appear on images
- [ ] Import folder into Capture One (if available) — verify ratings appear

✅ **Done Criteria:** Every scored image has a `.xmp` sidecar with correct star rating. Lightroom Classic displays the ratings without manual import steps.

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
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: "claude-sonnet-4",
    },
    openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
    gemini: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-2.5-flash",
    },
    ollama: { baseUrl: "http://localhost:11434/v1", defaultModel: "llava" },
    custom: { baseUrl: "", defaultModel: "" },
  };
  ```
- [ ] In `ai-client.ts`, build request headers based on provider:
  - Claude: `x-api-key: {apiKey}`, `anthropic-version: 2023-06-01`
  - OpenAI/Gemini/Custom: `Authorization: Bearer {apiKey}`
  - Ollama: no auth header (empty API key is valid)
- [ ] Handle Gemini's slightly different endpoint path for vision models

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

✅ **Done Criteria:** Starting with an empty folder shows a clear error. Cancelling mid-run, restarting, and choosing "Resume" continues from the correct image. Dry-run shows a sensible cost estimate.

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

✅ **Done Criteria:** `npm test` runs all test files and passes with 0 failures. Coverage report shows >80% coverage on all pipeline modules.

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

✅ **Done Criteria:** On a clean machine with no development tools installed, the CullAI installer installs and runs cleanly on all three platforms. A full culling run of 20 images completes without error.

---

## Final Checklist Before v1.0 Ship

- [ ] All 18 phases completed with all checkboxes checked
- [ ] `npm test` passes with 0 failures
- [ ] App runs clean on Windows, macOS, and Linux
- [ ] No API key ever appears in any log output
- [ ] XMP sidecars validated in Lightroom Classic
- [ ] Free tier limits enforced correctly (500 images, 2 profiles, no RAW, no XMP)
- [ ] Pro/Lifetime tier unlocks all features
- [ ] README.md is up to date and accurate
- [ ] Release tagged and installers published on GitHub Releases

---

_Written by Ashmin Dhungana - May 2026_
