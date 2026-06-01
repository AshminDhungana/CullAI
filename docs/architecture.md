# Project System Map & Architecture

```
cullai/
├── docs/                                # Documentation
│   ├── architecture.md
│   ├── specs.md
│   ├── tech_stack.md
│   └── todo.md
├── src/                                 # Source code
│   ├── main/                            # Electron main process (Node.js)
│   │   └── index.ts                     # App entry point
│   ├── renderer/                        # React UI (Electron window)
│   │   ├── assets/                      # Static assets
│   │   ├── components/                  # UI Components
│   │   │   ├── GenrePresetSelector.tsx
│   │   │   ├── ScoringWeightsPanel.tsx
│   │   │   └── SplashScreen.tsx
│   │   ├── screens/                     # App screens
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── index.html
│   │   ├── index.tsx
│   │   └── main.tsx
│   └── shared/                          # Types and constants
│       ├── constants.ts
│       ├── genre-presets.ts
│       └── types.ts
├── tests/                               # Test suite
│   └── fixtures/                        # Sample images (JPEG, RAW, HEIC)
├── electron-builder.config.ts
├── package.json
├── postcss.config.js
├── README.md
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.renderer.json
└── vite.config.ts
```
