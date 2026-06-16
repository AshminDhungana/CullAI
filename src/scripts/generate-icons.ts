/**
 * scripts/generate-icons.ts
 *
 * Generates platform-specific icon files from the source logo using icon-gen.
 * Uses jimp internally (pure-JS) so it does NOT require sharp or other native
 * modules that may have been rebuilt for Electron.
 *
 * Run: npx tsx src/scripts/generate-icons.ts
 * Or:  npm run build:icons
 */

import * as fs from 'fs';
import * as path from 'path';

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const SOURCE_GIF = path.join(__dirname, '..', 'renderer', 'assets', 'camera_logo.gif');
const BUILD_DIR = path.join(__dirname, '..', "..", 'build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Generation logic
// ────────────────────────────────────────────────────────────────────────────

async function generateIcons(): Promise<void> {
  // Validate source
  if (!fileExists(SOURCE_GIF)) {
    console.error('Source image not found:', SOURCE_GIF);
    console.error('Please ensure src/renderer/assets/camera_logo.gif exists.');
    process.exit(1);
  }

  // Ensure output directories exist
  ensureDir(BUILD_DIR);
  ensureDir(ICONS_DIR);

  console.log('Source:', SOURCE_GIF);
  console.log('Build directory:', BUILD_DIR);
  console.log('');

  try {
    // icon-gen is CommonJS-only — require it
    const icongen = require('icon-gen');

    // Generate icon.ico (Windows), icon.icns (macOS), and icon.png (Linux/General)
    const results = await icongen(SOURCE_GIF, BUILD_DIR, {
      report: true,
      ico: { name: 'icon' },
      icns: { name: 'icon' },
      favicon: { name: 'favicon' },
      png: { name: 'icon' },
    });

    console.log('\n✅ Icon generation complete!');
    console.log('\nGenerated files:');
    results.forEach((item: string) => console.log('  •', item));

    console.log('\nPlatform targets:');
    const icoPath = path.join(BUILD_DIR, 'icon.ico');
    const icnsPath = path.join(BUILD_DIR, 'icon.icns');
    const pngPath = path.join(BUILD_DIR, 'icon.png');

    if (fileExists(icoPath)) {
      console.log(`  • Windows: ${icoPath}`);
    }
    if (fileExists(icnsPath)) {
      console.log(`  • macOS:   ${icnsPath}`);
    }
    if (fileExists(pngPath)) {
      console.log(`  • Linux:   ${pngPath} (+ icons/)`);
    }

    console.log('\nNext steps:');
    console.log('  1. Run:  npm run build:all');
    console.log('  2. Or:   npx electron-builder --publish=never');
  } catch (err: any) {
    console.error('\n❌ Icon generation failed:', err.message || err);

    // Provide helpful diagnostics
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error('\n💡 Did you install dependencies? Run: npm install');
    } else if (err.message?.includes('jimp')) {
      console.error('\n💡 jimp failed to process the GIF. Try converting the source to PNG first:');
      console.error('   npx tsx -e "require(\'sharp\')(\'src/renderer/assets/camera_logo.gif\').png().toFile(\'build/icon.png\')"');
    } else if (err.message?.includes('Cannot')) {
      console.error('\n💡 Try reinstalling node_modules: rm -rf node_modules && npm install');
    }

    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

generateIcons().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
