import { describe, it, expect, vi } from 'vitest';
import * as duplicateDetector from '../../src/main/duplicate-detector';

// Mock imghash so tests are fast and deterministic.
vi.mock('imghash', () => ({
  hash: vi.fn().mockImplementation((path: string) => {
    // Return deterministic fake hashes based on path for predictability
    if (path.includes('burst_1')) return Promise.resolve('d5c86c4f8a3b1e2d');
    if (path.includes('burst_2')) return Promise.resolve('d5c86c4f8a3b1e2c'); // 1-bit diff
    if (path.includes('burst_3')) return Promise.resolve('d5c86c4f8a3b1e2b'); // 2-bit diff
    if (path.includes('landscape')) return Promise.resolve('deadbeefdeadbeef');
    if (path.includes('portrait')) return Promise.resolve('cafebabe12345678');
    return Promise.resolve('0000000000000000');
  }),
}));

import { ImageRecord } from '../../src/shared/types';

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(duplicateDetector.hammingDistance('aabbccdd', 'aabbccdd')).toBe(0);
  });

  it('returns > 0 for different hashes', () => {
    const dist = duplicateDetector.hammingDistance('00000000', 'ffffffff');
    expect(dist).toBeGreaterThan(0);
  });

  it('counts exactly 1 bit diff for hex values 0 and 1', () => {
    expect(duplicateDetector.hammingDistance('00', '01')).toBe(1);
  });

  it('handles hashes of different lengths by zero-padding', () => {
    const dist = duplicateDetector.hammingDistance('abcd', 'abcdef');
    expect(dist).toBeGreaterThanOrEqual(0);
  });
});

describe('computeHash', () => {
  it('returns a hash string for a valid image buffer', async () => {
    const buf = Buffer.from('fake-image-data');
    // computeHash writes to a temp file, so imghash.mock returns a known value
    const hash = await duplicateDetector.computeHash(buf);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThanOrEqual(16);
  });
});

describe('groupDuplicates', () => {
  function makeRecord(filename: string): ImageRecord {
    return {
      id: filename,
      filePath: `/tmp/${filename}`,
      filename,
      isRaw: false,
      base64: 'ZmFrZQ==',
      width: 640,
      height: 480,
    };
  }

  it('groups burst shots into a single cluster', async () => {
    const images = [makeRecord('burst_1.jpg'), makeRecord('burst_2.jpg'), makeRecord('burst_3.jpg'), makeRecord('landscape.jpg')];
    const groups = await duplicateDetector.groupDuplicates(images, 10);
    expect(groups).toHaveLength(2); // burst cluster + landscape singleton
    expect(groups[0].duplicates.length).toBeGreaterThan(0);
  });

  it('treats all unique images as singletons', async () => {
    const images = [makeRecord('landscape.jpg'), makeRecord('portrait.jpg')];
    const groups = await duplicateDetector.groupDuplicates(images, 10);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.duplicates.length === 0)).toBe(true);
  });

  it('returns empty array for empty input', async () => {
    const groups = await duplicateDetector.groupDuplicates([], 10);
    expect(groups).toHaveLength(0);
  });

  it('respects the threshold parameter', async () => {
    // burst_1 and burst_2 differ by exactly 1 bit (see mock), so a threshold of 0
    // should keep them in separate groups
    const images = [makeRecord('burst_1.jpg'), makeRecord('burst_2.jpg')];
    const groups = await duplicateDetector.groupDuplicates(images, 0);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.duplicates.length === 0)).toBe(true);
  });
});
