# CullAI v1.0.0 Release Notes

**Release Date:** June 14, 2026

## What's New

CullAI v1.0.0 is the first stable release of the AI-powered photo culling application. This version packages everything from 20 development phases into downloadable installers for Windows, macOS, and Linux.

## Features

### Core
- **Full RAW format support** — CR3, NEF, ARW, RAF, DNG, ORF, RW2, PEF, 3FR and more
- **Multi-provider AI** — Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), Ollama (local/offline), and custom OpenAI-compatible endpoints
- **On-device face & eye detection** — blink detection, expression scoring, face sharpness — no face data sent to any API
- **Duplicate & burst detection** — perceptual hashing groups near-identical shots before scoring
- **6-dimension weighted scoring** — Quality, Aesthetic, Composition, Sharpness, Exposure, Face & Eyes
- **7 genre presets** — General, Wedding, Portrait, Sports, Landscape, Street, Event
- **Style profiles** — save and reuse your scoring configuration across sessions
- **Session resume** — crash or cancel mid-job? Pick up exactly where you left off
- **Dry-run mode** — estimate token cost before committing to a full run
- **Secure key storage** — API keys encrypted via OS keychain (`safeStorage`)

### Results & Export
- **Tiered gallery** — S / A / B / Rejected with per-image score breakdown
- **Per-image AI reasoning** — see exactly why the AI rated each shot
- **Keyboard shortcuts** — P pick, X reject, ↑↓ navigate, R rescue, C compare
- **Compare mode** — side-by-side 2–4 image comparison
- **XMP sidecar export** — star ratings and color labels for Lightroom Classic and Capture One
- **Export results JSON / CSV** — full scores and reasoning for every image
- **Session archive (.zip)** — bundle session.json, results.json, and XMP sidecars

### Performance & UX
- **Parallel API batching** — configurable concurrent calls for fast throughput
- **RAW preview caching** — smart cache with configurable size and age limits
- **Virtualized results grid** — handles 10,000+ images without lag
- **Undo for manual overrides** — revert accidental tier changes
- **Auto-updater** — silent background update checks with one-click install

## Installers

| Platform | Format | Notes |
|----------|--------|-------|
| Windows | NSIS (.exe) | Full installer with desktop/start menu shortcuts |
| Windows | Portable (.exe) | Runs without installation |
| macOS | DMG (.dmg) | Drag to Applications |
| macOS | ZIP (.zip) | Standalone archive |
| Linux | AppImage | Runs without installation |

## Minimum Requirements

- **Windows:** Windows 10 or later (64-bit)
- **macOS:** macOS 11 (Big Sur) or later (Intel & Apple Silicon)
- **Linux:** Ubuntu 20.04+, Fedora, or equivalent (64-bit)
- **RAM:** 4 GB minimum (8 GB recommended)
- **Disk:** 500 MB for app + cache space for RAW previews

## Known Issues

- **Code signing not yet enabled** — installers are unsigned. Windows SmartScreen and macOS Gatekeeper may show warnings. This will be addressed in a future release once code signing certificates are obtained.
- **Ollama on Windows:** Ensure Ollama is running before starting CullAI if using a local model.

## Feedback & Support

- 🐛 **Bug reports:** [GitHub Issues](https://github.com/AshminDhungana/CullAI/issues)
- 💡 **Feature requests:** [GitHub Discussions](https://github.com/AshminDhungana/CullAI/discussions)

---

_Ashmin Dhungana — June 2026_
