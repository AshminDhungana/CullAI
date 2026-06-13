import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanFolder } from '../../src/main/image-processor';

describe('scanFolder — prefix filter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-filter-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function touch(name: string) {
    fs.writeFileSync(path.join(tmpDir, name), '');
  }

  it('excludes files without matching prefix', () => {
    touch('IMG_001.jpg');
    touch('DSC_002.jpg');
    touch('IMG_003.jpg');

    const result = scanFolder(tmpDir, undefined, ['IMG_']);
    expect(result).toHaveLength(2);
    expect(result.every(p => path.basename(p).startsWith('IMG_'))).toBe(true);
  });

  it('is case-insensitive by default', () => {
    touch('img_001.jpg');
    touch('IMG_002.jpg');

    const result = scanFolder(tmpDir, undefined, ['img_']);
    expect(result).toHaveLength(2);
  });
});
