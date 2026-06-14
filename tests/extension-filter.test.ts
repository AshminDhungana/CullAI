import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanFolder } from '../src/main/image-processor';

describe('scanFolder — extension filter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-filter-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function touch(name: string) {
    fs.writeFileSync(path.join(tmpDir, name), '');
  }

  it('returns only CR3 files when extension filter is {".cr3"}', async () => {
    touch('IMG_001.jpg');
    touch('IMG_002.CR3');
    touch('IMG_003.png');

    const result = await scanFolder(tmpDir, { extensions: ['.cr3'] });
    expect(result).toHaveLength(1);
    expect(path.basename(result[0])).toBe('IMG_002.CR3');
  });

  it('returns all supported files when extension filter is empty', async () => {
    touch('a.jpg');
    touch('b.png');
    touch('c.nef');

    const result = await scanFolder(tmpDir);
    expect(result).toHaveLength(3);
  });

  it('is case-insensitive', async () => {
    touch('IMG_001.CR3');
    touch('IMG_002.cr3');

    const result = await scanFolder(tmpDir, { extensions: ['.cr3'] });
    expect(result).toHaveLength(2);
  });
});
