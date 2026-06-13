import { describe, it, expect } from 'vitest';
import {
  computeWeightedTotal,
  buildScoringPrompt,
  buildDiscoveryPrompt,
} from '../../src/main/ai-client';
import { GENRE_PRESETS } from '../../src/shared/genre-presets';
import { ImageRecord } from '../../src/shared/types';

// ── computeWeightedTotal ───────────────────────────────────────────────────

describe('computeWeightedTotal', () => {
  it('computes a simple average when weights are uniform', () => {
    const scores = { quality: 50, aesthetic: 50, composition: 50, sharpness: 50, exposure: 50, faceEyes: 50 };
    const weights = { quality: 16.67, aesthetic: 16.67, composition: 16.66, sharpness: 16.67, exposure: 16.67, faceEyes: 16.66 };
    const result = computeWeightedTotal(scores, weights);
    expect(result).toBeCloseTo(50, 0);
  });

  it('returns 0 when all scores are 0', () => {
    const scores = { quality: 0, aesthetic: 0, composition: 0, sharpness: 0, exposure: 0, faceEyes: 0 };
    const weights = GENRE_PRESETS.general;
    expect(computeWeightedTotal(scores, weights)).toBe(0);
  });

  it('returns 100 when all scores are 100', () => {
    const scores = { quality: 100, aesthetic: 100, composition: 100, sharpness: 100, exposure: 100, faceEyes: 100 };
    const weights = GENRE_PRESETS.general;
    expect(computeWeightedTotal(scores, weights)).toBe(100);
  });

  it('ignores faceEyes when its landscape weight is 0', () => {
    const scores = { quality: 50, aesthetic: 50, composition: 50, sharpness: 50, exposure: 50, faceEyes: 99 };
    const weights = GENRE_PRESETS.landscape;
    const total = computeWeightedTotal(scores, weights);
    expect(total).toBeLessThanOrEqual(100);
    // faceEyes should not pull the total toward 99 because weight is 0
    expect(total).toBeLessThan(99);
  });
});

// ── buildScoringPrompt ─────────────────────────────────────────────────────

describe('buildScoringPrompt', () => {
  const baseParams = {
    imageBase64: 'b64data',
    filename: 'IMG_001.jpg',
    discoveryContext: 'A wedding shoot',
    styleProfile: null as any,
    weights: GENRE_PRESETS.wedding,
    faceMetadata: {
      hasFaces: true,
      faceCount: 2,
      eyesOpen: true,
      blinkDetected: false,
      expressionNeutral: true,
      boundingBoxes: [{ x: 0.5, y: 0.5, width: 0.2, height: 0.2 }],
      exceedsFaceLimit: false,
    },
    provider: 'claude' as const,
    apiKey: 'dummy',
    model: 'claude-test',
    baseUrl: '',
  };

  it('includes discovery context in prompt', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('A wedding shoot');
  });

  it('includes filename in prompt', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('IMG_001.jpg');
  });

  it('includes each scoring dimension label', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('quality');
    expect(prompt).toContain('aesthetic');
    expect(prompt).toContain('composition');
    expect(prompt).toContain('sharpness');
    expect(prompt).toContain('exposure');
    expect(prompt).toContain('faceEyes');
  });

  it('includes face metadata summary', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toLowerCase()).toContain('face');
  });

  it('produces identical output for identical params', () => {
    const p1 = buildScoringPrompt(baseParams);
    const p2 = buildScoringPrompt(baseParams);
    expect(p1).toBe(p2);
  });
});

// ── buildDiscoveryPrompt ───────────────────────────────────────────────────

describe('buildDiscoveryPrompt', () => {
  it('includes all sample image filenames', () => {
    const images: ImageRecord[] = [
      { id: '1', filePath: '/a/IMG_001.jpg', filename: 'IMG_001.jpg', isRaw: false, base64: 'b64', width: 100, height: 100 },
      { id: '2', filePath: '/a/IMG_002.jpg', filename: 'IMG_002.jpg', isRaw: false, base64: 'b64', width: 100, height: 100 },
    ];
    const prompt = buildDiscoveryPrompt(images, 'Wedding with natural light');
    expect(prompt).toContain('IMG_001.jpg');
    expect(prompt).toContain('IMG_002.jpg');
    expect(prompt).toContain('Wedding with natural light');
  });
});
