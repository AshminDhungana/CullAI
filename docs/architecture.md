# Project System Map & Architecture

```
cullai/
├── docs/                                # Documentation
├── src/                                 # Source code
│   ├── main/                            # Electron main process (Node.js)
│   │   ├── index.ts                     # App entry point
│   │   ├── ipc-handlers.ts              # IPC bridge to renderer
│   │   ├── image-processor.ts           # Sharp resize + base64 encoding
│   │   ├── raw-decoder.ts               # libraw → JPEG/TIFF for RAW formats
│   │   ├── face-detector.ts             # On-device face/eye/blink detection
│   │   ├── ai-client.ts                 # OpenAI-compatible API calls
│   │   ├── batch-scheduler.ts           # Parallel batch manager + rate limiter
│   │   ├── duplicate-detector.ts        # Perceptual hash grouping
│   │   ├── session-manager.ts           # Incremental score persistence + resume
│   │   ├── xmp-writer.ts                # XMP sidecar file generation
│   │   ├── safe-storage.ts              # safeStorage API key wrapper
│   │   └── license.ts                   # License tier check (Free / Pro / Lifetime)
│   ├── renderer/                        # React UI (Electron window)
│   │   ├── App.tsx
│   │   ├── screens/
│   │   │   ├── Setup.tsx                # Configuration screen
│   │   │   ├── Processing.tsx           # Live progress screen
│   │   │   └── Results.tsx              # Tiered gallery results
│   │   └── components/
│   │       ├── ScoringWeightsPanel.tsx  # 6 sliders, auto-normalized
│   │       ├── GenrePresetSelector.tsx  # Genre dropdown + weight preview
│   │       ├── StyleProfileManager.tsx  # Create / load / save profiles
│   │       ├── ImageTile.tsx            # Tile with score, tier badge, reasoning
│   │       ├── CompareView.tsx          # Side-by-side 2–4 image comparison
│   │       ├── FaceOverlay.tsx          # Detected face highlight boxes
│   │       └── KeyboardCuller.tsx       # Keyboard shortcut handler
│   └── shared/                          # Types and constants
│       ├── types.ts
│       ├── genre-presets.ts
│       └── constants.ts
├── tests/
│   ├── fixtures/                        # Sample images (JPEG, RAW, HEIC)
│   ├── raw-decoder.test.ts
│   ├── duplicate-detector.test.ts
│   ├── face-detector.test.ts
│   ├── scoring-weights.test.ts
│   ├── xmp-writer.test.ts
│   └── session-manager.test.ts
├── package.json
├── tsconfig.json
└── electron-builder.config.ts
```
