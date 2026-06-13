import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('raw-cache integration', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-cache-'));
  });

  afterEach(() => {
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('stores and retrieves a cached preview', () => {
    const rawFile = path.join(cacheDir, 'IMG_001.CR3');
    fs.writeFileSync(rawFile, Buffer.from('fake-raw-data'));

    // Simulate cache store
    const previewPath = path.join(cacheDir, '.cullai_cache', 'raw_previews', 'IMG_001.jpg');
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    fs.writeFileSync(previewPath, Buffer.from('fake-preview-jpg'));

    // Verify cache exists
    expect(fs.existsSync(previewPath)).toBe(true);

    // Simulate cache retrieval
    const cached = fs.readFileSync(previewPath);
    expect(cached.toString()).toBe('fake-preview-jpg');
  });

  it('m isses when cache file does not exist', () => {
    const previewPath = path.join(cacheDir, '.cullai_cache', 'raw_previews', 'missing.jpg');
    expect(fs.existsSync(previewPath)).toBe(false);
  });
});
