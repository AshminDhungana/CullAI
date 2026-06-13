import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { walkFolders } from '../../src/main/folder-walker';

describe('walkFolders — depth and structure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpmp(), 'subfolder-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function mkdir(relative: string) {
    const full = path.join(tmpDir, relative);
    fs.mkdirSync(full, { recursive: true });
    return full;
  }

  it('returns root and one-level subfolders', async () => {
    mkdir('sub1');
    mkdir('sub2');

    const result = await walkFolders(tmpDir);
    expect(result).toContain(tmpDir);
    expect(result).toContain(path.join(tmpDir, 'sub1'));
    expect(result).toContain(path.join(tmpDir, 'sub2'));
    expect(result).toHaveLength(3);
  });

  it('returns deeply nested subfolders', async () => {
    mkdir('a/b/c');
    mkdir('a/d');

    const result = await walkFolders(tmpDir);
    expect(result).toContain(path.join(tmpDir, 'a', 'b', 'c'));
    expect(result).toContain(path.join(tmpDir, 'a', 'd'));
  });

  it('skips hidden directories', async () => {
    mkdir('visible');
    mkdir('.hidden');

    const result = await walkFolders(tmpDir);
    expect(result).not.toContain(path.join(tmpDir, '.hidden'));
  });

  it('skips .cullai_cache directories', async () => {
    mkdir('wedding');
    mkdir('.cullai_cache');

    const result = await walkFolders(tmpDir);
    expect(result).not.toContain(path.join(tmpDir, '.cullai_cache'));
  });
});
