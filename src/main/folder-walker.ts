/**
 * src/main/folder-walker.ts
 *
 * Phase 10b — Recursive folder discovery.
 *
 * walkFolders(rootPath) returns every subdirectory under rootPath that
 * contains at least one file. Hidden directories (names starting with '.')
 * and the RAW cache directory (.cullai_cache) are excluded at every depth.
 *
 * The root itself is always included as the first entry (relative path '').
 * Subdirectories are returned as paths relative to rootPath, so the caller
 * can reconstruct absolute paths with path.join(rootPath, relPath).
 *
 * MAIN-PROCESS ONLY.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Folder names that are always excluded from recursive walks. */
const EXCLUDED_DIRS = new Set(['.cullai_cache', 'node_modules', '.git']);

/**
 * Recursively discovers all subdirectories under `rootPath` that contain
 * at least one non-hidden file (direct children only, not nested).
 *
 * The root itself (represented as '') is always the first entry.
 * Hidden folders (names starting with '.') are never traversed.
 *
 * @param rootPath  Absolute path to the root folder.
 * @returns         Array of relative subfolder paths ('' for root, 'sub/dir' for children).
 */
export async function walkFolders(rootPath: string): Promise<string[]> {
  const resolved = path.resolve(rootPath);
  const result: string[] = [];

  await _walk(resolved, resolved, result);

  // Always include root as first entry even if it has no direct files —
  // the orchestrator will simply find zero images in it and move on.
  if (!result.includes('')) {
    result.unshift('');
  }

  return result;
}

async function _walk(
  rootPath: string,
  currentPath: string,
  acc: string[],
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip silently.
    return;
  }

  const hasFiles = entries.some(
    (e) => e.isFile() && !e.name.startsWith('.'),
  );

  const relPath = path.relative(rootPath, currentPath).replace(/\\/g, '/');

  if (hasFiles) {
    acc.push(relPath);
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      !EXCLUDED_DIRS.has(entry.name)
    ) {
      await _walk(rootPath, path.join(currentPath, entry.name), acc);
    }
  }
}