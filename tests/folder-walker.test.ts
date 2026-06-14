import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { walkFolders } from '../src/main/folder-walker';

describe('walkFolders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function mkdirWithFile(relative: string) {
    const full = path.join(tmpDir, relative);
    fs.mkdirSync(full, { recursive: true });
    // Write a file so the folder is detected as "has files"
    fs.writeFileSync(path.join(full, 'file.txt'), 'hello');
    return full;
  }

  it('returns root folder when no subdirectories exist', async () => {
    // root folder itself needs a file to be included
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    const result = await walkFolders(tmpDir);
    // walkFolders returns '' as the root and relative paths for subfolders
    expect(result).toContain('');
  });

  it('finds all nested subdirectories', async () => {
    mkdirWithFile('a');
    mkdirWithFile('a/b');
    mkdirWithFile('c');

    const result = await walkFolders(tmpDir);
    expect(result).toContain('');
    expect(result).toContain('a');
    expect(result).toContain(path.join('a', 'b').replace(/\\/g, '/'));
    expect(result).toContain('c');
  });

  it('excludes hidden directories', async () => {
    mkdirWithFile('visible');
    mkdirWithFile('.hidden');

    const result = await walkFolders(tmpDir);
    expect(result).toContain('visible');
    expect(result).not.toContain('.hidden');
  });

  it('excludes .cullai_cache directories', async () => {
    mkdirWithFile('wedding');
    mkdirWithFile('.cullai_cache');

    const result = await walkFolders(tmpDir);
    expect(result).not.toContain('.cullai_cache');
  });
});
