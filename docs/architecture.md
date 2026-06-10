# Project System Map & Architecture

```
cullai/
├── assets/                              # Project assets (logos, screenshots)
├── docs/                                # Documentation
│   ├── architecture.md
│   ├── specs.md
│   ├── tech_stack.md
│   └── todo.md
├── src/                                 # Source code
│   ├── main/                            # Electron main process (Node.js)
│   │   ├── index.ts                     # App entry point
│   │   ├── orchestrator.ts               # Full batch pipeline orchestration (Phase 10)
│   │   ├── batch-scheduler.ts            # Batch processing logic and scheduling
│   │   ├── folder-walker.ts                # Recursive directory scanning & file filtering
│   │   ├── ipc-handlers.ts              # IPC communication
│   │   ├── license-manager.ts           # License validation
│   │   ├── raw-decoder.ts               # RAW → JPEG buffer decoder (Phase 4.2)
│   │   ├── raw-cache.ts                 # RAW preview caching logic
│   │   ├── image-processor.ts           # Image processing pipeline
│   │   ├── cache-cleaner.ts             # Automatic cache cleanup
│   │   ├── safe-storage.ts              # Secure storage utilities
│   │   ├── time-sync.ts                 # Time synchronization
│   │   ├── usage-tracker.ts             # Usage analytics/tracking
│   │   ├── session-manager.ts           # Crash-safe session persistence
│   │   ├── duplicate-detector.ts         # Burst/duplicate detection (perceptual hashing)
│   │   ├── face-detector.ts             # Face and eye detection
│   │   ├── ai-client.ts                # AI scoring API client (Phase 9)
│   │   ├── ai-errors.ts                # AI-specific error handling
│   │   ├── lightdrift-libraw.d.ts       # LibRaw ambient declarations
│   │   └── preload.js                   # Electron preload script
│   ├── renderer/                        # React UI (Electron window)
│   │   ├── assets/                      # UI assets
│   │   ├── components/                  # Shared UI Components
│   │   │   ├── CompareView.tsx          # Image comparison view
│   │   │   ├── FaceOverlay.tsx           # Face/eye detection overlay
│   │   │   ├── ImageTile.tsx            # Individual image card
│   │   │   ├── KeyboardCuller.tsx       # Keyboard-driven culling logic
│   │   │   ├── GenrePresetSelector.tsx
│   │   │   ├── ScoringWeightsPanel.tsx
│   │   │   ├── CacheSettingsPanel.tsx
│   │   │   ├── EncryptionStatusBadge.tsx
│   │   │   ├── ExtensionFilter.tsx
│   │   │   ├── LicensePanel.tsx
│   │   │   ├── PrefixFilter.tsx
│   │   │   ├── RecentFoldersDropdown.tsx
│   │   │   ├── ReferenceImageUpload.tsx
│   │   │   ├── ModelCombobox.tsx
│   │   │   └── SplashScreen.tsx
│   │   ├── hooks/                       # React custom hooks
│   │   │   ├── useIgnoreRules.ts
│   │   │   ├── useRecentFolders.ts
│   │   │   └── useTheme.ts
│   │   ├── screens/                     # App screens (Processing, Results, Setup)
│   │   │   ├── Processing.tsx
│   │   │   ├── Results.tsx
│   │   │   └── Setup.tsx
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── index.html
│   │   ├── index.tsx
│   │   └── main.tsx
│   ├── scripts/                         # Build/Dev scripts
│   │   ├── download-fixtures.ts         # Downloads CC0 RAW samples (Phase 4.3)
│   │   ├── hash-license-keys.ts         # Generates license key hashes for license-manager
│   │   ├── test-ai-call.ts              # Tests AI scoring API integration
│   │   └── test-raw-decode.ts           # Manual RAW decode test + timing (Phase 4.3)
│   └── shared/                          # Shared types and constants
│       ├── constants.ts
│       ├── genre-presets.ts
│       ├── license.ts
│       └── types.ts
├── tests/                               # Test suite
│   └── fixtures/                        # Sample images (JPEG, RAW, HEIC)
│       ├── README.md                    # How to populate fixtures, CC0 sources, visual checklist
│       └── ...                          # Binary RAW sample files
├── electron-builder.config.ts
├── LICENSE
├── package.json
├── postcss.config.js
├── README.md
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.renderer.json
└── vite.config.ts
```
