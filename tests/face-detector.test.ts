import { describe, it, expect, vi } from 'vitest';

// Mock electron before importing face-detector
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const mockDetect = vi.fn().mockResolvedValue({
  face: [
    {
      faceScore: 0.95,
      box: { x: 10, y: 10, w: 50, h: 50 },
      mesh: [],
      iris: 0,
      gaze: { angle: 0 },
      age: 30,
      gender: 'Male',
      emotion: [{ emotion: 'happy', score: 0.9 }],
    },
  ],
});

const mockLoad = vi.fn().mockResolvedValue(undefined);

// Mock the main package entry — the source code does require('@vladmandic/human')
vi.mock('@vladmandic/human', () => ({
  default: class Human {
    load = mockLoad;
    detect = mockDetect;
  },
}));

import { detectFaces } from '../src/main/face-detector';

describe('detectFaces', () => {
  it('detects face in portrait image', async () => {
    const buffer = Buffer.from('fake-portrait');
    const meta = await detectFaces(buffer);
    expect(meta.hasFaces).toBe(true);
    expect(meta.faceCount).toBeGreaterThanOrEqual(1);
  });

  it('returns correct face metadata', async () => {
    const buffer = Buffer.from('fake-portrait');
    const meta = await detectFaces(buffer);
    expect(meta.boundingBoxes).toHaveLength(1);
    expect(meta.boundingBoxes[0].width).toBeGreaterThan(0);
  });
});
