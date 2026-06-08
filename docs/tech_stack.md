# CullAI — Technology Stack & Architectural Standards

> **Purpose:** Lock down the programming languages, framework versions, libraries, and strict formatting guidelines for the CullAI project.  
> **AI Value:** Ensures all generated code adheres to the project’s specific constraints and modern best practices rather than generic patterns.

---

## 1. Core Stack (Exact Versions)

| Category              | Technology   | Version / Constraint            |
| --------------------- | ------------ | ------------------------------- |
| **Runtime**           | Node.js      | 24.x (LTS)                      |
| **Desktop Framework** | Electron     | 42.x                            |
| **UI Library**        | React        | 18.2+                           |
| **Language**          | TypeScript   | 5.0+                            |
| **Build Tool**        | Vite         | 5.x (renderer) + `tsc` for main |
| **Styling**           | Tailwind CSS | 3.4+                            |
| **Package Manager**   | npm          | 10.x                            |

---

## 2. TypeScript Configuration (Strict)

All TypeScript code must adhere to the following `tsconfig` settings (enforced in both `tsconfig.main.json` and `tsconfig.renderer.json`):

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "esModuleInterop": true,
    "skipLibCheck": false,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- **No `any` type** – use `unknown` or proper interfaces.
- **All shared types** must be defined in `src/shared/types.ts`.
- **Promise returns** must be explicitly typed (`Promise<ImageRecord>` not `Promise<any>`).

---

## 3. Architectural Laws (Non‑Negotiable)

### 3.1 Process Separation

- **Main process** (`src/main/`) – Electron main, Node.js APIs, native modules (`lightdrift-libraw`, `sharp`), file system, IPC handlers, face detection, session manager, AI client.
- **Renderer process** (`src/renderer/`) – React UI, Tailwind styling, no direct Node.js imports. Organized into `/components`, `/screens`, and `/assets`. Communicates exclusively via `window.electronAPI` (preload script).
- **Shared code** (`src/shared/`) – TypeScript types, constants, genre presets. **Must not import** any Node.js or browser‑only modules.

### 3.2 IPC Communication Pattern

- All IPC channels are defined as string constants in `src/shared/ipc-channels.ts`.
- Preload script (`src/main/preload.ts`) exposes a typed `electronAPI` object with a **single** function per channel.
- Renderer calls `window.electronAPI.someFunction(...args)`.
- Main process registers handlers using `ipcMain.handle(channel, handler)`.
- No `ipcRenderer.send` or `ipcRenderer.invoke` directly in React components.

### 3.3 State Persistence

- **User settings** & **style profiles** – stored via `electron-store` (encrypted where sensitive).
- **Sessions** – stored as `session.json` inside the output folder (atomic writes: temp file → rename).
- **RAW preview cache** – stored in `{inputFolder}/.cullai_cache/raw_previews/` (or global cache if configured).
- **API keys** – encrypted with Electron `safeStorage` before writing to `electron-store`.

### 3.4 Error Handling

- All asynchronous operations must be wrapped in try/catch that surfaces a typed `CullAIError` (defined in `src/shared/errors.ts`).
- Never display raw stack traces to the user.
- Recoverable errors (rate limits, timeouts) have a `retry` flag; fatal errors (auth, missing folder) abort the pipeline.

### 3.5 Logging & Privacy

- No API keys, face data, or full image base64 strings may appear in console logs (even in development).
- Use `process.env.NODE_ENV === 'development' ? console.log : () => {}` for debugging.
- Face detection results (`FaceMetadata`) are never written to disk or transmitted – only kept in memory for the current pipeline.

---

## 4. Key Libraries & Their Roles

| Library                            | Purpose                                                             | Version Pin |
| ---------------------------------- | ------------------------------------------------------------------- | ----------- |
| `sharp`                            | Resize, convert, encode JPEG/HEIC/WebP for AI & previews            | 0.33.x      |
| `lightdrift-libraw` (native addon) | Decode RAW files (CR3, NEF, ARW, RAF, DNG, etc.)                    | 1.x         |
| `@vladmandic/human`                | On‑device face & eye detection (primary, CPU‑only)                  | 3.x         |
| `modern-face-api.js` (fallback)    | Fallback for platforms where `human` fails                          | 0.22.x      |
| `imghash`                          | Perceptual hashing for duplicate / burst detection                  | 0.3.x       |
| `electron-store`                   | Persistent key‑value store for settings & profiles                  | 8.x         |
| `electron-updater`                 | Auto‑update via GitHub Releases                                     | 6.x         |
| `react-window`                     | Virtualized grid for large result sets                              | 1.8.x       |
| `lottie-react`                     | Splash screen animation (optional)                                  | 2.x         |
| `archiver`                         | ZIP export of session bundle                                        | 6.x         |
| `commander`                        | CLI argument parsing for headless mode                              | 12.x        |
| `vitest`                           | Unit & integration test runner                                      | 1.x         |
| `tailwindcss`                      | Utility CSS framework – **must use** for all styling                | 3.4.x       |
| `xmp-metadata` (or custom XML)     | Write XMP sidecars (if library fails, fall back to string template) | latest      |

> Note: Version Pin Can be different as it can change during development

---

## 5. Formatting & Linting Rules

### 5.1 Code Style (Prettier + ESLint)

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

- **Indentation:** 2 spaces (no tabs).
- **Quotes:** single quotes (`'`) for strings, double quotes only to avoid escaping.
- **Semicolons:** required at the end of every statement.
- **Line length:** 100 characters maximum.

### 5.2 Naming Conventions

| Element               | Convention             | Example                           |
| --------------------- | ---------------------- | --------------------------------- |
| Files (TS/TSX)        | kebab-case             | `face-detector.ts`, `setup.tsx`   |
| React components      | PascalCase             | `ImageTile`, `ProcessingScreen`   |
| Functions / variables | camelCase              | `detectFaces`, `scoreImage`       |
| Interfaces / types    | PascalCase             | `FaceMetadata`, `ScoreRecord`     |
| Constants (global)    | UPPER_SNAKE_CASE       | `DEFAULT_CONCURRENCY`             |
| IPC channel names     | lower‑case‑with‑dashes | `'scan-folder'`, `'session-save'` |

### 5.3 Tailwind CSS Guidelines

- **No custom CSS files** except for keyframe animations (splash screen). All styling must use Tailwind utility classes.
- **Dark theme:** use `dark:` variant with a consistent amber/gold accent (`text-amber-500`, `bg-amber-600`).
- **Spacing:** prefer Tailwind spacing scale (`p-4`, `m-2`, `gap-3`) over arbitrary values.
- **Responsive:** prefix with `sm:`, `md:`, `lg:` where needed; desktop-first is acceptable.

---

## 6. Testing Mandates

- **Unit tests** for:
  - RAW decoder (`isRawFile`, `decodeRaw` error handling).
  - Duplicate detector (hashing, Hamming distance, grouping logic).
  - Face detector (fixture images with/without faces, blink detection).
  - Scoring weights (normalization, weighted total, genre presets).
  - XMP writer (rating, label, valid XML, namespace declarations).
  - Session manager (create, save, load, resume, corruption recovery).
- **Integration tests** using a mock AI server (`tests/mock-ai-server.ts`) – no real API calls during `npm test`.
- **Coverage target:** ≥80% for all core pipeline modules (`raw-decoder`, `face-detector`, `duplicate-detector`, `ai-client`, `orchestrator`, `session-manager`).

---

## 7. Build & Packaging Constraints

- **Development:** `npm run dev` starts Vite dev server + Electron concurrently.
- **Production build:** `npm run build` runs TypeScript compilation (`tsc -p tsconfig.main.json` and `tsc -p tsconfig.renderer.json`), then `electron-builder`.
- **Native addons** (`lightdrift-libraw`) must be rebuilt for Electron using `electron-rebuild` (in `postinstall` script).
- **ASAR unpacking:** All `.node` files (native addons) must be listed in `asarUnpack` in `electron-builder.config.ts`.
- **Platform targets:** Windows (NSIS installer + portable EXE), macOS (DMG + ZIP), Linux (AppImage).

---

## 8. Environment Variables & Secrets

| Variable                      | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `NODE_ENV`                    | `development`, `production`, or `test` |
| `APPLE_ID`                    | (CI only) for macOS notarization       |
| `APPLE_APP_SPECIFIC_PASSWORD` |                                        |
| `WIN_CSC_LINK`                | Windows code signing certificate path  |
| `WIN_CSC_KEY_PASSWORD`        |                                        |

> **Never commit real API keys** – use `electron-store` with `safeStorage` encryption at runtime.

---

## 9. Architectural Diagrams (Mental Model)

```
┌─────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ raw-decoder  │  │ face-detector│  │ duplicate-       │   │
│  │ (lightdrift-  │  │ (@human/fallback)│ detector (phash)│   │
│  │  libraw)      │  │                  │                 │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                   │              │
│         └─────────┬───────┴───────────────────┘              │
│                   ▼                                          │
│         ┌─────────────────────────────┐                      │
│         │      orchestrator.ts        │                      │
│         │ (discovery → scoring → tier)│                      │
│         └─────────────┬───────────────┘                      │
│                       │                                      │
│         ┌─────────────┼─────────────┐                        │
│         ▼             ▼             ▼                        │
│  ┌────────────┐ ┌───────────┐ ┌──────────────┐              │
│  │ ai-client  │ │ session-  │ │ xmp-writer   │              │
│  │(provider   │ │ manager   │ │ (XML sidecar)│              │
│  │ routing)   │ │(session.json)            │              │
│  └────────────┘ └───────────┘ └──────────────┘              │
│                                                              │
│  IPC handlers (ipcMain.handle)  ←─┐                         │
└────────────────────────────────────┼─────────────────────────┘
                                     │ preload
┌────────────────────────────────────┼─────────────────────────┐
│                  RENDERER PROCESS  │                         │
│  window.electronAPI.*  ←───────────┘                         │
│  ┌──────────┐  ┌────────────┐  ┌───────────┐                │
│  │ Setup    │  │ Processing │  │ Results   │                │
│  │ (React)  │  │ (React)    │  │ (React)   │                │
│  └──────────┘  └────────────┘  └───────────┘                │
│         Tailwind CSS · React Router (implicit screens)       │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Version Locking & Updates

- All dependency versions are pinned in `package.json` (no `^` or `~` where possible, except for patch releases allowed for security fixes).
- Before upgrading any major library (Electron, React, TypeScript), test the entire pipeline with the new version.
- The following libraries are **frozen** until further notice:
  - `lightdrift-libraw` – because native ABI compatibility with Electron is fragile.
  - `@vladmandic/human` – model files would need re‑download; only upgrade if critical bug fix.

---

_Last updated: June 2026_
