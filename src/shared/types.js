"use strict";
// =============================================================================
// CullAI — Shared Types
// Used by both the Electron main process and the React renderer.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultAppSettings = defaultAppSettings;
// -----------------------------------------------------------------------------
// Default AppSettings factory
// -----------------------------------------------------------------------------
/**
 * Returns a fresh AppSettings object with sensible defaults.
 * Spread-merge with persisted values to upgrade stored settings gracefully.
 */
function defaultAppSettings() {
    return {
        inputFolder: '',
        outputFolder: '',
        numImagesToSelect: 20,
        genre: 'general',
        weights: {
            quality: 25,
            aesthetic: 20,
            composition: 15,
            sharpness: 15,
            exposure: 10,
            faceEyes: 15,
        },
        activeProfileId: null,
        preferenceText: '',
        provider: 'claude',
        apiKey: '',
        baseUrl: '',
        model: 'claude-sonnet-4-6',
        concurrency: 5,
        extensionFilter: [],
        prefixFilter: [],
        prefixCaseInsensitive: true,
        ignorePatterns: [],
        referenceImage: null,
        disableDuplicateGrouping: false,
        duplicateThreshold: 10,
        maxFacesPerImage: 0,
        lightroomMode: 'copyToOutput',
        enableXmpExport: false,
        shortfallStrategy: 'stop',
        processSubfolders: false,
        preserveSubfolderStructure: false,
        enableAutoTagging: false,
        tagTopPercent: 20,
        dryRun: false,
        rawCacheMaxSizeGb: 5,
        rawCacheMaxAgeDays: 30,
        disableRawCache: false,
        useEmbeddedPreview: true,
    };
}
//# sourceMappingURL=types.js.map