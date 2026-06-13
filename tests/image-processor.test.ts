import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanFolder } from '../../src/main/image-processor';

describe('scanFolder', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-proc-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function touch(name: string) {
    fs.writeFileSync(path.join(tmpDir, name), '');
  }

  it('finds all supported image files by default', () => {
    touch('IMG_001.jpg');
    touch('IMG_002.CR3');
    touch('DSC_003.png');
    touch('README.txt'); // should be ignored

    const result = scanFolder(tmpDir);
    expect(result).toHaveLength(3);
    expect(result).toContain(path.join(tmpDir, 'IMG_001.jpg'));
    expect(result).toContain(path.join(tmpDir, 'IMG_002.CR3'));
    expect(result).toContain(path.join(tmpDir, 'DSC_003.png'));
  });

  it('filters by extension', () => {
    touch('IMG_001.jpg');
    touch('IMG_002.CR3');
    touch('IMG_003.png');

    const result = scanFolder(tmpDir, new Set(['.cr3']));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('IMG_002.CR3');
  });

  it('filters by prefix', () => {
    touch('IMG_001.jpg');
    touch('DSC_002.jpg');
    touch('IMG_003.jpg');

    const result = scanFolder(tmpDir, undefined, ['IMG_']);
    expect(result).toHaveLength(2);
    expect(result.every(p => path.basename(p).startsWith('IMG_'))).toBe(true);
  });

  it('skips hidden files', () => {
    touch('IMG_001.jpg');
    touch('.DS_Store');
    touch('Thumbs.db');

    const result = scanFolder(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toContain('.DS_Store');
  });

  it('returns empty array for empty folder', () => {
    const result = scanFolder(tmpDir);
    expect(result).toHaveLength(0);
  });
});
