# Project System Map & Architecture

<!--
  This file is the single source of truth for the project's high-level structure.
  Keep it in sync with the actual file tree. When adding, removing, or renaming
  modules, update this document and the inline comments below.
-->

```
cullai/
├── .github/                               # GitHub automation
│   └── workflows/
│       ├── build.yml                      # CI: build, test, and package on every push
│       └── release.yml                    # CD: signed release builds for all platforms
├── assets/                                # Project assets (logos, marketing screenshots)
├── build/                                 # Build-time resources (icons, entitlements, favicons)
├── docs/                                  # Documentation
│   ├── architecture.md                    ← You are here
│   ├── tech_stack.md                        Technology choices and rationale
│   ├── todo.md                              Backlog and known issues
│   ├── CODE_SIGNING.md                      Code-signing certificate setup
│   └── RELEASE_NOTES.md                     Versioned release notes
├── scripts/                               # Standalone build/dev scripts
│   └── build-cli.js                       # CLI entry-point bundler
├── src/                                   # Source code
│   ├── cli/                               # Headless CLI for batch workflows
│   │   ├── args.ts                        # CLI argument parsing (yargs-style)
│   │   └── runner.ts                      # CLI bootstrap and exit-code handling
│   ├── main/                              # Electron main process (Node.js)
│   │   ├── index.ts                         App entry point — window management, menu, lifecycle
│   │   ├── preload.js                       Preload script (exposes safe IPC to renderer)
│   │   ├── ipc-handlers.ts                  IPC channel definitions and handlers
│   │   # ── Domain modules (alphabetical) ──
│   │   ├── ai-client.ts                     AI scoring API client (Phase 9)
│   │   ├── ai-errors.ts                     AI-specific error taxonomy and recovery
│   │   ├── auto-tagging.ts                  AI-driven automated keyword tagging
│   │   ├── auto-updater.ts                  Auto-update check, download, and install logic
│   │   ├── batch-scheduler.ts               Batch processing queue and scheduling
│   │   ├── benchmark.ts                     Performance benchmark harness
│   │   ├── cache-cleaner.ts                 Automatic temp/cache cleanup
│   │   ├── duplicate-detector.ts            Burst/duplicate detection (perceptual hashing)
│   │   ├── face-detector.ts                 Face and eye detection pipeline
│   │   ├── folder-walker.ts                 Recursive directory scanning & file filtering
│   │   ├── image-processor.ts               Image decoding, resizing, and format conversion
│   │   ├── license-manager.ts               License validation and feature gating
│   │   ├── logger.ts                        Structured logging (main process)
│   │   ├── maintenance.ts                   Maintenance-mode checks and graceful degradation
│   │   ├── orchestrator.ts                  Full batch pipeline orchestration (Phase 10)
│   │   ├── raw-cache.ts                     RAW preview caching logic
│   │   ├── raw-decoder.ts                   RAW → JPEG buffer decoder (Phase 4.2)
│   │   ├── safe-storage.ts                  Encrypted credential/key storage
│   │   ├── session-manager.ts               Crash-safe session persistence and recovery
│   │   ├── time-sync.ts                     Time synchronization for telemetry
│   │   ├── usage-tracker.ts                 Anonymous usage analytics
│   │   ├── xmp-writer.ts                    XMP metadata read/write
│   │   └── lightdrift-libraw.d.ts           Ambient type declarations for LibRaw wrapper
│   ├── renderer/                          # React UI (Electron renderer process)
│   │   ├── assets/                          Static assets served by the renderer
│   │   ├── components/                      # Reusable UI components
│   │   │   ├── CacheSettingsPanel.tsx       Cache size and TTL configuration UI
│   │   │   ├── CompareView.tsx              Side-by-side image comparison canvas
│   │   │   ├── EncryptionStatusBadge.tsx    Visual indicator for encryption state
│   │   │   ├── ExtensionFilter.tsx          Toggle filtering by file extension
│   │   │   ├── FaceOverlay.tsx              SVG overlay for detected faces/eyes
│   │   │   ├── GenrePresetSelector.tsx      Dropdown for photography genre presets
│   │   │   ├── ImageTile.tsx                Thumbnail grid item with hover actions
│   │   │   ├── KeyboardCuller.tsx           Keyboard shortcut handler for rapid culling
│   │   │   ├── LicensePanel.tsx             License activation and status display
│   │   │   ├── ModelCombobox.tsx            AI model selection with search
│   │   │   ├── PrefixFilter.tsx             Filter by filename prefix patterns
│   │   │   ├── QuickActions.tsx             Floating action bar (delete, star, reject)
│   │   │   ├── RecentFoldersDropdown.tsx    Recently-opened folders list
│   │   │   ├── RecentSessionsPanel.tsx      Crash-recovery session chooser
│   │   │   ├── ReferenceImageUpload.tsx     Drag-and-drop reference image input
│   │   │   ├── ScoringWeightsPanel.tsx      Customizable AI scoring sliders
│   │   │   ├── SplashScreen.tsx             Boot splash with version info
│   │   │   ├── StyleProfileManager.tsx      Create/edit user-defined style profiles
│   │   │   └── UpdateBanner.tsx             In-app update availability notice
│   │   ├── hooks/                         # React custom hooks (business logic abstraction)
│   │   │   ├── useIgnoreRules.ts            Ignore-pattern management
│   │   │   ├── useRecentFolders.ts          Recent-folder persistence
│   │   │   ├── useTheme.ts                  Dark/light/system theme detection
│   │   │   └── useUpdater.ts                Auto-update state machine hook
│   │   ├── screens/                       # Top-level route screens
│   │   │   ├── Processing.tsx               Live batch progress and ETA
│   │   │   ├── Results.tsx                  Ranked/culled image results grid
│   │   │   └── Setup.tsx                    Initial folder and settings configuration
│   │   ├── utils/                         # Renderer-side pure helpers
│   │   │   └── thumbnailUrl.ts              Blob-URL generation for thumbnails
│   │   ├── App.tsx                          Root component with routing and providers
│   │   ├── main.tsx                         Vite entry point (renders <App/>)
│   │   ├── index.tsx                        Additional entry shim (legacy compat)
│   │   ├── index.css                        Global Tailwind + custom styles
│   │   └── index.html                       Vite HTML template
│   ├── scripts/                           # TypeScript utility scripts (build-time / manual)
│   │   ├── download-fixtures.ts             Downloads CC0 RAW samples for testing (Phase 4.3)
│   │   ├── generate-icons.ts                Generates multi-resolution ICO/ICNS from source
│   │   ├── hash-license-keys.ts             Generates SHA-256 hashes for license-manager whitelist
│   │   ├── test-ai-call.ts                  One-shot AI scoring API smoke test
│   │   └── test-raw-decode.ts               Manual RAW decode benchmark + timing (Phase 4.3)
│   └── shared/                            # Isomorphic code (types, constants, presets)
│       ├── constants.ts                     App-wide constants (limits, defaults, regexes)
│       ├── genre-presets.ts                 Predefined genre scoring profiles
│       ├── license.ts                       License model and validation types
│       └── types.ts                         Shared TypeScript interfaces and type guards
├── tests/                                 # Test suite (Vitest)
│   ├── __mocks__/                         # Manual module mocks
│   │   ├── lightdrift-libraw.ts             Mock for native RAW decoder
│   │   └── sharp.ts                         Mock for image processing library
│   ├── fixtures/                            Sample RAW/JPEG/HEIC files (see fixtures/README.md)
│   ├── helpers/                             Test helper utilities
│   │   └── fixtures.ts                      Fixture loading wrappers
│   ├── ai-client.test.ts
│   ├── batch-scheduler.test.ts
│   ├── duplicate-detector.test.ts
│   ├── extension-filter.test.ts
│   ├── face-detector.test.ts
│   ├── folder-walker.test.ts
│   ├── genre-presets.test.ts
│   ├── image-processor.test.ts
│   ├── keyword-tagging.test.ts
│   ├── mock-ai-integration.test.ts
│   ├── orchestrator.test.ts
│   ├── prefix-filter.test.ts
│   ├── raw-cache.test.ts
│   ├── raw-decoder.test.ts
│   ├── scoring-weights.test.ts
│   ├── session-manager.test.ts
│   ├── subfolder-processing.test.ts
│   └── xmp-writer.test.ts
├── .gitignore                             # Git ignore patterns
├── CODE_SIGNING.md                        # Apple/Windows code-signing docs
├── electron-builder.yml                   # Electron Builder release config
├── electron-builder.config.ts.bak           # Previous TS config (backup only)
├── LICENSE                                # MIT or proprietary license text
├── package.json                           # Dependencies, scripts, and metadata
├── package-lock.json                      # Locked dependency tree
├── postcss.config.js                        PostCSS configuration (Tailwind)
├── README.md                              # User-facing project overview
├── RELEASE_NOTES.md                       # Per-version changelog
├── tailwind.config.js                     # Tailwind theme and purge settings
├── tsconfig.json                          # Root TypeScript configuration
├── tsconfig.main.json                     # Main process TS config (Node target)
├── tsconfig.renderer.json                 # Renderer process TS config (DOM target)
├── vite.config.ts                         # Vite dev server and build config
└── vitest.config.ts                         # Vitest unit-test runner config
```

## Module Dependency Guidelines

- **Renderer** (`src/renderer/`) must never import from `src/main/` directly. All communication goes through `ipc-handlers.ts` via the preload bridge.
- **Main** (`src/main/`) owns all heavy I/O: file system, native modules, network.
- **Shared** (`src/shared/`) is the only code that may be imported from both sides. Keep it free of Node.js or DOM APIs.
- **CLI** (`src/cli/`) reuses `src/shared/` and `src/main/` logic but has its own argument parsing and exit-code handling.
