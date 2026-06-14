import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeWeightedTotal,
  buildScoringPrompt,
  buildDiscoveryPrompt,
} from '../src/main/ai-client';
import { GENRE_PRESETS } from '../src/shared/genre-presets';

describe('computeWeightedTotal', () => {
  it('returns 0 when all scores are 0', () => {
    const scores = { quality: 0, aesthetic: 0, composition: 0, sharpness: 0, exposure: 0, faceEyes: 0 };
    expect(computeWeightedTotal(scores, GENRE_PRESETS.general)).toBe(0);
  });

  it('returns 100 when all scores are 100', () => {
    const scores = { quality: 100, aesthetic: 100, composition: 100, sharpness: 100, exposure: 100, faceEyes: 100 };
    expect(computeWeightedTotal(scores, GENRE_PRESETS.general)).toBe(100);
  });

  it('respects faceEyes weight of 0 in landscape preset', () => {
    const scores = { quality: 50, aesthetic: 50, composition: 50, sharpness: 50, exposure: 50, faceEyes: 100 };
    const total = computeWeightedTotal(scores, GENRE_PRESETS.landscape);
    // faceEyes weight is 0, so 100 faceEyes should not boost the total much
    expect(total).toBeLessThan(100);
    expect(total).toBeGreaterThan(0);
  });
});

describe('buildScoringPrompt', () => {
  const baseParams = {
    imageBase64: 'b64data',
    filename: 'IMG_001.jpg',
    discoveryContext: 'Wedding shoot in golden hour',
    styleProfile: {
      id: 'test',
      name: 'test',
      genre: 'wedding' as const,
      weights: GENRE_PRESETS.wedding,
      preferenceText: 'Natural light, candid moments',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    },
    weights: GENRE_PRESETS.wedding,
    faceMetadata: {
      hasFaces: true,
      faceCount: 2,
      eyesOpen: true,
      blinkDetected: false,
      expressionNeutral: true,
      boundingBoxes: [],
      exceedsFaceLimit: false,
    },
    provider: 'claude' as const,
    apiKey: 'dummy',
    model: 'claude-test',
    baseUrl: '',
  };

  it('includes filename', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('IMG_001.jpg');
  });

  it('includes discovery context', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('Wedding shoot in golden hour');
  });

  it('includes all 6 scoring dimensions', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('quality');
    expect(prompt).toContain('aesthetic');
    expect(prompt).toContain('composition');
    expect(prompt).toContain('sharpness');
    expect(prompt).toContain('exposure');
    expect(prompt).toContain('faceEyes');
  });

  it('includes style profile preference text', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt).toContain('Natural light, candid moments');
  });

  it('includes face metadata when faces detected', () => {
    const prompt = buildScoringPrompt(baseParams);
    expect(prompt.toLowerCase()).toContain('face');
    expect(prompt).toContain('Eyes open: yes');
    expect(prompt).toContain('Blink detected: no');
  });
});

describe('buildDiscoveryPrompt', () => {
  it('includes genre in prompt', () => {
    const prompt = buildDiscoveryPrompt('wedding', 5);
    expect(prompt).toContain('wedding');
    expect(prompt).toContain('5 sample image');
  });

  it('uses singular form when sample count is 1', () => {
    const prompt = buildDiscoveryPrompt('portrait', 1);
    expect(prompt).toContain('1 sample image');
    expect(prompt).not.toContain('1 sample images');
  });
});
