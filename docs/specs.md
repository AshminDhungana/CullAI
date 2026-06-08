# CullAI — Product Specifications (v1.0)

> **Blueprint Purpose:** Defines the complete scope, business logic, rules, and expected behavior of CullAI.  
> **Audience:** Developers, testers, AI agents, and product stakeholders.  
> **Last Updated:** May 2026

---

## 1. Product Overview

**CullAI** is a cross‑platform desktop application that uses AI vision to automatically select the best photos from a folder. It replaces the tedious manual process of **culling** (sorting and selecting) with an intelligent, configurable pipeline.

### 1.1 Core Promise

> “From memory card to keepers — automatically, with full privacy and local control.”

- **No cloud storage** – images leave the user’s machine only as resized previews sent to the chosen AI API.
- **On‑device face detection & RAW decoding** – no external service sees the original files.
- **Crash‑safe sessions** – resume exactly where you left off.

### 1.2 User Personas

| Persona                  | Description                                                                | Key Needs                                                                     |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Wedding Photographer** | Shoots 2000+ RAW images per event, needs fast selection of 200–300 keepers | High accuracy for faces/emotions, burst handling, Lightroom integration (XMP) |
| **Sports Photographer**  | High burst rates (10+ fps), prioritises sharpness and peak action          | Duplicate grouping, sharpness‑heavy weights, fast throughput                  |
| **Hobbyist**             | Mixed folders (JPEG + RAW), uses local AI (Ollama) to avoid costs          | Simple setup, free tier, no subscription                                      |
| **Studio Portrait**      | Controlled lighting, needs perfect eye focus and expressions               | Face & eyes weight up to 30%, blink detection, reference image                |

---

## 2. Functional Scope (by Epic)

### Epic 1: Project & UI Foundation

- **Splash screen** with branded animation (1.5–2.5s, skippable).
- **Setup screen** with all configuration inputs (folders, genre, weights, AI provider, limits, filters).
- **Processing screen** with progress bar, current file, estimated time & cost.
- **Results screen** with tiered gallery (S/A/B/Rejected), keyboard shortcuts, compare mode, face overlays.

### Epic 2: Image Ingestion & Pre‑processing

- Scan input folder for supported image formats (JPEG, PNG, HEIC, all major RAW).
- Apply **extension filter** (e.g., only `.CR3`), **prefix filter** (e.g., `IMG_`), and `.cullaiignore` (glob patterns).
- **Recursive subfolder processing** with option to preserve folder structure in output.
- **RAW decoding** via `lightdrift-libraw` → embedded JPEG preview extraction for fast thumbnails, full decode for AI scoring.
- **Smart RAW caching** (per‑folder `.cullai_cache`) with size/age limits and manual cleanup.

### Epic 3: On‑Device Analysis

- **Face & eye detection** (`@vladmandic/human` with fallback) – returns face count, bounding boxes, eyes open, blink detection, expression neutrality.
- **Face limit** – images with more faces than `maxFacesPerImage` are immediately rejected (saves API calls).
- **Duplicate / burst detection** – perceptual hashing groups near‑identical images; only the best representative from each group is scored. Threshold configurable; can be disabled entirely.

### Epic 4: AI Scoring Pipeline

- **Discovery pass** – AI analyses 5–8 sample images + optional reference image to build a context summary (“What is ‘best’ for this shoot?”).
- **Scoring prompt** – includes discovery context, user style preference, scoring rubric (6 dimensions with user weights), face metadata.
- **Provider routing**:
  - **Claude** → Anthropic native API (`/v1/messages`).
  - **OpenAI / Gemini / Ollama / Custom** → OpenAI‑compatible `/chat/completions`.
- **Parallel batching** – configurable concurrency (1–10) with per‑image retry on rate limits / server errors.
- **Token & cost tracking** – real‑time estimation during dry‑run and live run.
- **Tier assignment (relative)** – after all scores are collected:
  - S = top 10% of scored images (min 1)
  - A = next 30%
  - B = next 30%
  - Rejected = bottom 30% + any image with total score < 30 (absolute threshold).
- **Session persistence** – each score saved immediately to `session.json` (atomic write). Supports resume after crash/cancel.

### Epic 5: Output & Integration

- **XMP sidecar export** – writes Lightroom‑compatible star ratings (S=5, A=4, B=3, Rejected=1) and color labels.
- **AI‑powered auto‑tagging** (Pro feature) – generates 5–10 keywords for top S/A keepers; writes `<dc:subject>` into XMP.
- **Copy keepers** – copies selected images (S+A) to output folder; optional “fill with B‑tier / Rejected” to reach requested count.
- **Export formats** – `results.json` (full scores & reasoning), `cullai_scores.csv`, session bundle (`.zip` with JSON + XMPs).

### Epic 6: Licensing & Feature Gating

- **Free tier** – 500 images per calendar month, max 2 style profiles, no RAW, no XMP, no auto‑tagging.
- **Pro tier** – unlimited images, RAW support, XMP export, auto‑tagging, unlimited profiles.
- **Lifetime** – same as Pro, one‑time payment.
- License file (`.cullai-license`) stored in app data directory; no online validation required (offline‑friendly).

### Epic 7: CLI & Automation

- Headless mode (`--headless`) runs full pipeline without GUI, using same main process.
- Arguments: `--input`, `--output`, `--count`, `--provider`, `--api-key`, `--model`, `--weights`, `--no-xmp`, `--dry-run`.
- Outputs progress to stdout, final summary table, exit code 0 on success.

### Epic 8: Non‑Functional & Polish

- **Dry‑run** estimates token cost & output shortfall before starting.
- **Auto‑updater** – checks GitHub Releases daily, non‑modal notification.
- **Benchmark mode** (`--benchmark`) – measures stage times, memory, cache hit ratio on a fixed dataset.
- **Background maintenance** – deletes orphaned cache folders, trims old session logs.
- **Portable Windows executable** – no admin rights required.

---

## 3. Data Models (Core Entities)

> See `src/shared/types.ts` for exact TypeScript definitions.

### `AppSettings`

Stores all user configuration from Setup screen. Persisted via `electron-store`.

```ts
{
  inputFolder: string;
  outputFolder: string;
  numImagesToSelect: number; // 0 = all S-tier
  genre: GenrePreset;
  weights: ScoringWeights;
  preferenceText: string;
  provider: AIProvider;
  apiKey?: string; // encrypted
  baseUrl: string;
  model: string;
  concurrency: number; // 1-10
  dryRun: boolean;
  xmpExport: boolean;
  extensionFilter: Set<string>;
  prefixFilter: string[];
  referenceImage: { filename: string, base64: string } | null;
  maxFacesPerImage: number; // 0 = disabled
  duplicateThreshold: number; // 5-20 bits
  disableDuplicateGrouping: boolean;
  processSubfolders: boolean;
  preserveSubfolderStructure: boolean;
  enableAutoTagging: boolean;
  tagTopPercent: number; // 10-100
  // ... other toggles
}
```

````

### `ImageRecord`

Represents a single image after processing (resized base64, metadata).

```ts
{
  id: string; // hash of filePath+modified
  filePath: string;
  filename: string;
  isRaw: boolean;
  base64: string; // JPEG 1024px, quality 85
  width: number;
  height: number;
  faceMetadata?: FaceMetadata;
}
```

### `ScoreRecord` (persisted in session)

```ts
{
  filename: string;
  scores: ScoringWeights; // per-dimension 0-100
  total: number; // weighted composite
  tier: 'S' | 'A' | 'B' | 'rejected';
  reasoning: string;
  faceMetadata: FaceMetadata;
  keywords?: string[];
  usage?: { inputTokens: number; outputTokens: number };
}
```

### `Session`

```ts
{
  sessionId: string;
  createdAt: string;
  inputFolder: string;
  outputFolder: string;
  totalImages: number;
  scoredCount: number;
  status: 'running' | 'completed' | 'cancelled' | 'crashed';
  settings: AppSettings;
  scores: Record<string, ScoreRecord>;
  discoveryContext: string;
  outputShortfallReasons?: ShortfallReasons;
}
```

### `ShortfallReasons`

```ts
{
  duplicatesSkipped: number;
  belowThreshold: number;
  faceDetectionFailed: number;
  exceededFaceLimit: number;
  burstGrouped: number;
}
```

---

## 4. Business Rules & Logic

### 4.1 Tier Assignment (Post‑Scoring)

1. **Exclude** pre‑rejected images (face limit, decode errors) from the ranking pool.
2. **Sort** remaining images by `total` score descending.
3. **Percentile cutoffs** (applied to sorted list):
   - S = top 10% (minimum 1 if pool non‑empty)
   - A = next 30%
   - B = next 30%
   - Rejected = bottom 30%
4. **Absolute override** – any image with `total < 30` (out of 100) is demoted to Rejected, regardless of percentile.
5. Pre‑rejected images stay at Rejected.

### 4.2 Output Selection Logic

- If `numImagesToSelect === 0` → output **all S‑tier** images (no limit).
- If `numImagesToSelect > 0`:
  - First take all S‑tier images.
  - If still needed, take A‑tier images (in score order).
  - If user chose **“Fill with B‑tier”** and still short, take best B‑tier.
  - If user chose **“Fill with Rejected”** and still short, take best Rejected.
- If final count < requested, show shortfall reasons with option to add excluded images.

### 4.3 Free Tier Limits (enforced in Phase 3 & 10)

- **500 images per calendar month** – counter stored in `electron-store`, resets on 1st of each month.
- **Max 2 style profiles** – “Create New” disabled after 2.
- **RAW formats blocked** – when Free tier detected, `processFolder` rejects any RAW file with `FREE_LIMIT_EXCEEDED` error.
- **XMP export disabled** – toggle hidden or disabled.
- **Auto‑tagging disabled** – toggle hidden.

### 4.4 Duplicate / Burst Handling

- **Default:** Grouping enabled. Only `representative` from each group is scored; duplicates are not sent to AI.
- **When grouping is disabled** (user toggle) – every image is scored individually (useful for bursts where each shot is different).
- **Similarity threshold** – bits (default 10). Lower = stricter grouping.

### 4.5 Face Limit Rule

- If `maxFacesPerImage > 0` and `faceCount > maxFacesPerImage`:
  - Mark image as rejected **without** AI scoring.
  - Increment `exceededFaceLimit` counter.
  - Reason shown in shortfall summary.

### 4.6 Resume Logic

- On Processing screen mount, check for existing `session.json` in the **output folder**.
- If found and `status !== 'completed'`, show resume banner with remaining count and estimated time/cost.
- Resume starts from `scoredCount` and re‑uses already stored scores.
- “Start Fresh” clears the session file and begins a new pipeline.

---

## 5. External API Dependencies

### 5.1 AI Providers – Endpoint & Authentication

| Provider | Endpoint Format                         | Authentication                           | Notes                                                                       |
| -------- | --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Claude   | `https://api.anthropic.com/v1/messages` | `x-api-key` header + `anthropic-version` | **Native API**, not OpenAI‑compatible. `baseUrl` ignored.                   |
| OpenAI   | `{baseUrl}/chat/completions`            | `Authorization: Bearer {key}`            | baseUrl default = `https://api.openai.com/v1`                               |
| Gemini   | `{baseUrl}/chat/completions`            | `Authorization: Bearer {key}`            | baseUrl default = `https://generativelanguage.googleapis.com/v1beta/openai` |
| Ollama   | `{baseUrl}/chat/completions`            | No authentication                        | baseUrl default = `http://localhost:11434/v1`                               |
| Custom   | `{baseUrl}/chat/completions`            | `Authorization: Bearer {key}` (optional) | User provides full base URL.                                                |

### 5.2 Request/Response Format (OpenAI‑compatible)

**Request body:**

```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": { "url": "data:image/jpeg;base64,<base64>" }
        },
        { "type": "text", "text": "<scoring prompt>" }
      ]
    }
  ],
  "max_tokens": 1024
}
```

**Response (expected):**

```json
{
  "choices": [
    { "message": { "content": "{ \"quality\": 85, \"aesthetic\": 70, ... }" } }
  ],
  "usage": { "prompt_tokens": 800, "completion_tokens": 200 }
}
```

### 5.3 Claude Native API Format

**Request body:**

```json
{
  "model": "claude-sonnet-4-20250514",
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
            "data": "<base64>"
          }
        },
        { "type": "text", "text": "<scoring prompt>" }
      ]
    }
  ]
}
```

**Response:** `content[0].text` contains JSON; `usage.input_tokens` / `output_tokens`.

---

## 6. Edge Cases & Failure Modes

| Scenario                                    | Expected Behavior                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Input folder contains no supported images   | Setup screen validation shows error: “No supported images found.”                                    |
| Output folder is a subdirectory of input    | Yellow warning banner with “Continue?” + ignore checkbox (session‑only).                             |
| API key invalid (401) during scoring        | Pipeline aborts immediately; user sees “Invalid API key for provider X”.                             |
| Ollama not running                          | “Test Connection” shows failure; start button disabled until Ollama responds.                        |
| Network timeout during AI call              | Retry once; if still fails, mark image as scoring‑failed (reason in `reasoning`), continue pipeline. |
| `lightdrift-libraw` fails to decode a RAW file | Log error, skip image, add to `faceDetectionFailed` shortfall counter.                               |
| Session file corruption (partial write)     | `loadSession()` returns `null`; user can start fresh or attempt manual repair (not automated).       |
| User requests 200 images but only 180 exist | Confirmation dialog before start. After run, show shortfall reasons with “Add excluded?” option.     |
| Free user exceeds 500 monthly limit         | Pipeline rejects additional images with error code; upgrade prompt shown.                            |
| Duplicate grouping threshold too high       | Different images clustered incorrectly → user can adjust slider and re‑run.                          |
| Reference image has no faces                | “Test face detection” warns user; scoring continues (face weight may be irrelevant).                 |
| `.cullaiignore` pattern matches all files   | Setup shows “All files ignored – nothing to process”.                                                |

---

## 7. Data Flow (High‑Level Sequence)

```text
[User selects folder]
  → scanFolder() → apply filters & .cullaiignore → return file list
  → (if dry-run) estimate cost & output shortfall → ask confirm
  → createSession()
  → for each subfolder (if recursive):
      → decode RAWs (cache) / read JPEGs → resize to 1024px base64
      → face detection → attach FaceMetadata
      → duplicate grouping → select representatives
      → discovery pass (5-8 samples + reference) → store context
      → for each representative (parallel with concurrency):
          → callAI() → get ScoreRecord (no tier yet)
          → saveScore() → emit progress
      → after all representatives scored: assignTiers()
      → compute shortfall reasons → store in session
      → if XMP export enabled: writeXmpSidecar() for all scored images
      → if auto-tagging enabled & Pro: tag top S/A keepers → update XMPs
  → copy selected keepers to output folder (if Lightroom integration mode = copy)
  → markSessionComplete()
  → Results screen loads session & displays gallery
```

---

## 8. Performance & Resource Targets

| Metric                        | Target                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| RAW decode (first run)        | ≤ 2 seconds per image (CR3, NEF, ARW) on modern CPU         |
| RAW cache hit                 | ≤ 50 ms per image (read from disk)                          |
| Face detection per image      | ≤ 300 ms (CPU‑only)                                         |
| Duplicate hashing per image   | ≤ 100 ms                                                    |
| AI scoring latency (Claude 4) | ≤ 3 seconds per image (including network)                   |
| Concurrent API calls          | Default 5, max 10 (to avoid rate limits)                    |
| Memory usage (10k images)     | ≤ 1.5 GB (virtualised grid, lazy‑loaded previews)           |
| Session file write (atomic)   | ≤ 10 ms per score (JSON serialisation + temp rename)        |
| Cache cleanup (auto)          | Runs after each session, < 1 second for typical cache sizes |

---

## 9. User Stories (Key Workflows)

| ID    | As a…                | I want to…                                                                                     | So that…                                                                |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| US‑01 | Wedding photographer | Select a folder of 2000 RAW images, choose “Wedding” preset, set concurrency to 8, click Start | I get ~300 keepers in 15 minutes, with XMP sidecars ready for Lightroom |
| US‑02 | Sports shooter       | Enable burst grouping, raise sharpness weight to 30%, set similarity threshold to 12           | Burst sequences are merged; only the sharpest frame is scored           |
| US‑03 | Hobbyist (Free tier) | Use Ollama (local), process 300 JPEGs, output 50 best                                          | No API cost, no privacy concerns, results within 5 minutes              |
| US‑04 | Portrait studio      | Upload a reference image (perfect eye focus), test face detection, set face weight 30%         | AI prioritises images with similar eye sharpness                        |
| US‑05 | Power user (Pro)     | Save a custom style profile “Low‑key event”, then next week load it instantly                  | No need to re‑configure weights each time                               |
| US‑06 | Batch editor         | Process a root folder with 10 sub‑folders (Reception, Ceremony…) and preserve structure        | Output folder mirrors input, each subfolder has its own keepers         |
| US‑07 | Automation script    | Run `cullai --headless --input /jobs/wedding --output /out --count 200` from cron              | Culling happens overnight without GUI interaction                       |

---

## 10. Glossary

| Term                | Definition                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Culling**         | Process of selecting the best images from a larger set, discarding the rest.                                                                                    |
| **S/A/B/Rejected**  | Tiered output: S = best shots (top 10%), A = strong selections (next 30%), B = decent but not selected (next 30%), Rejected = bottom 30% + low absolute scores. |
| **Discovery Pass**  | Single AI call at the beginning of a session that analyses sample images to understand the shoot genre and user’s definition of “best”.                         |
| **XMP Sidecar**     | XML metadata file that Lightroom and Capture One read to apply star ratings, labels, and keywords without altering original images.                             |
| **Perceptual Hash** | Fingerprint of an image that is robust against small changes (compression, resize), used to group burst shots.                                                  |
| **`lightdrift-libraw`** | Open‑source RAW decoding library. CullAI uses its Node.js native binding (supports Node 24 + Electron 42).                                                  |
| **`safeStorage`**   | Electron API that encrypts data using OS‑native keychain/DPAPI/kwallet.                                                                                         |
| **Dry‑Run**         | Simulation that estimates token cost and probable output count without making API calls.                                                                        |

---

## 11. Out of Scope for v1.0

- Video file support (`.mp4`, `.mov`).
- Direct Lightroom plugin / integration (only XMP sidecar).
- Cloud backup or sync of sessions.
- Mobile app or web version.
- Advanced editing (exposure correction, cropping).
- Batch renaming of keepers.
- Multi‑user collaborative culling.
- Training custom AI models.

---
````
