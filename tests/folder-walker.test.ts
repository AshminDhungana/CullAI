import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { walkFolders } from '../../src/main/folder-walker';

describe('walkFolders', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walker-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function mkdir(relative: string) {
    fs.mkdirSync(path.join(tmpDir, relative), { recursive: true });
  }

  it('returns root folder when no subdirectories exist', async () => {
    const result = await walkFolders(tmpDir);
    expect(result).toEqual([tmpDir]);
  });

  it('finds all nested subdirectories', async () => {
    mkdir('a');
    mkdir('a/b');
    mkdir('c');

    const result = await walkFolders(tmpDir);
    expect(result).toContain(tmpDir);
    expect(result).toContain(path.join(tmpDir, 'a'));
    expect(result).toContain(path.join(tmpDir, 'a', 'b'));
    expect(result).toContain(path.join(tmpDir, 'c'));
    expect(result).toHaveLength(4);
  });

  it('excludes hidden directories', async () => {
    mkdir('visible');
    mkdir('.hidden');

    const result = await walkFolders(tmpDir);
    expect(result).toContain(path.join(tmpDir, 'visible'));
    expect(result).not.toContain(path.join(tmpDir, '.hidden'));
  });

  it('excludes .cullai_cache directories', async () => {
    mkdir('wedding');
    mkdir('.cullai_cache');

    const result = await walkFolders(tmpDir);
    expect(result).not.toContain(path.join(tmpDir, '.cullai_cache'));
  });
});
