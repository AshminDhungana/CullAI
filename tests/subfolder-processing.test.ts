import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { walkFolders } from '../src/main/folder-walker';

describe('walkFolders — depth and structure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subfolder-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function mkdir(relative: string) {
    const full = path.join(tmpDir, relative);
    fs.mkdirSync(full, { recursive: true });
    // Write a file so the folder is considered "has files"
    fs.writeFileSync(path.join(full, 'file.txt'), 'hello');
    return full;
  }

  it('returns root and one-level subfolders', async () => {
    mkdir('sub1');
    mkdir('sub2');

    const result = await walkFolders(tmpDir);
    expect(result).toContain('');
    expect(result).toContain('sub1');
    expect(result).toContain('sub2');
  });

  it('returns deeply nested subfolders', async () => {
    mkdir('a/b/c');
    mkdir('a/d');

    const result = await walkFolders(tmpDir);
    expect(result).toContain('a/b/c');
    expect(result).toContain('a/d');
  });

  it('skips hidden directories', async () => {
    mkdir('visible');
    mkdir('.hidden');

    const result = await walkFolders(tmpDir);
    expect(result).toContain('visible');
    expect(result).not.toContain('.hidden');
  });

  it('skips .cullai_cache directories', async () => {
    mkdir('wedding');
    mkdir('.cullai_cache');

    const result = await walkFolders(tmpDir);
    expect(result).not.toContain('.cullai_cache');
  });
});
