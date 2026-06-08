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
│   │   ├── ipc-handlers.ts              # IPC communication
│   │   ├── license-manager.ts           # License validation
│   │   ├── raw-decoder.ts               # RAW → JPEG buffer decoder (Phase 4.2)
│   │   └── ...                          # Other core system utilities
│   ├── renderer/                        # React UI (Electron window)
│   │   ├── assets/                      # UI assets
│   │   ├── components/                  # Shared UI Components
│   │   │   ├── GenrePresetSelector.tsx
│   │   │   ├── ScoringWeightsPanel.tsx
│   │   │   └── ...                      # Other specialized UI components
│   │   ├── hooks/                       # React custom hooks
│   │   ├── screens/                     # App screens (Processing, Results, Setup)
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── index.html
│   │   ├── index.tsx
│   │   └── main.tsx
│   ├── scripts/                         # Build/Dev scripts
│   │   ├── download-fixtures.ts         # Downloads CC0 RAW samples (Phase 4.3)
│   │   ├── hash-license-keys.ts         # Generates license key hashes for license-manager
│   │   └── test-raw-decode.ts           # Manual RAW decode test + timing (Phase 4.3)
│   └── shared/                          # Shared types and constants
│       ├── constants.ts
│       ├── genre-presets.ts
│       ├── license.ts
│       └── types.ts
├── tests/                               # Test suite
│   └── fixtures/                        # Sample images (JPEG, RAW, HEIC)
│       ├── .gitignore                   # Excludes binary RAW files and output/ from git
│       ├── README.md                    # How to populate fixtures, CC0 sources, visual checklist
│       └── output/                      # Decoded JPEG output from test:raw (git-ignored)
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
