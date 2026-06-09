/**
 * src/main/lightdrift-libraw.d.ts
 *
 * Ambient type shim for lightdrift-libraw.
 *
 * WHY THIS FILE EXISTS HERE (not in src/shared/types.ts)
 * ────────────────────────────────────────────────────────
 * lightdrift-libraw is a native Node.js addon used exclusively in the
 * Electron main process (src/main/raw-decoder.ts). It must never be
 * imported by renderer code, and its type declaration must never be
 * reachable by Vite's renderer build.
 *
 * Keeping this file inside src/main/ ensures:
 *   • tsconfig.main.json   ("include": ["src/main/**/*"]) picks it up ✓
 *   • tsconfig.renderer.json ("include": ["src/renderer/**/*"]) ignores it ✓
 *   • Vite's import-analysis scanner (root: ./src/renderer) never sees it ✓
 *
 * WHY export = instead of export default
 * ────────────────────────────────────────────────────────
 * lightdrift-libraw/lib/index.d.ts uses CommonJS `export =` syntax.
 * Using `export default` caused TS2306 ("not a module") as recorded in
 * tsconfig_main.tsbuildinfo. The correct form for CJS re-exports is:
 *   import LibRaw = require('lightdrift-libraw');
 * which is what raw-decoder.ts already uses at runtime.
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer or src/shared.
 */

declare module 'lightdrift-libraw' {
  import LibRaw = require('libraw');
  export = LibRaw;
}