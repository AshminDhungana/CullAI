import { describe, it, expect, vi } from 'vitest';
import { BatchScheduler } from '../../src/main/batch-scheduler';
import { ScoreRecord } from '../../src/shared/types';

// Mock the AI client so no real network calls are made.
vi.mock('../../src/main/ai-client', () => ({
  scoreImage: vi.fn().mockImplementation(async () => ({
    filename: 'test.jpg',
    scores: { quality: 80, aesthetic: 80, composition: 80, sharpness: 80, exposure: 80, faceEyes: 80 },
    total: 80,
    tier: 'S' as const,
    reasoning: 'Mock scoring',
    faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
  })),
}));

describe('BatchScheduler', () => {
  it('processes all images in queue', async () => {
    const images = Array.from({ length: 5 }, (_, i) => ({
      id: `img-${i}`,
      filePath: `/tmp/img-${i}.jpg`,
      filename: `img-${i}.jpg`,
      isRaw: false,
      base64: 'ZmFrZQ==',
      width: 640,
      height: 480,
    }));

    const controller = new AbortController();
    const scheduler = new BatchScheduler({
      concurrency: 2,
      signal: controller.signal,
    });

    const results: ScoreRecord[] = [];
    for await (const result of scheduler.run(images)) {
      results.push(result.record);
    }

    expect(results).toHaveLength(5);
    expect(results.every(r => r.total === 80)).toBe(true);
  });

  it('respects abort signal', async () => {
    const images = Array.from({ length: 10 }, (_, i) => ({
      id: `img-${i}`,
      filePath: `/tmp/img-${i}.jpg`,
      filename: `img-${i}.jpg`,
      isRaw: false,
      base64: 'ZmFrZQ==',
      width: 640,
      height: 480,
    }));

    const controller = new AbortController();
    const scheduler = new BatchScheduler({
      concurrency: 2,
      signal: controller.signal,
    });

    // Abort 50ms into the run
    setTimeout(() => controller.abort(), 50);

    const results: ScoreRecord[] = [];
    try {
      for await (const result of scheduler.run(images)) {
        results.push(result.record);
      }
    } catch {
      // Abort may reject — that's fine
    }

    expect(results.length).toBeLessThan(10);
  });
});
