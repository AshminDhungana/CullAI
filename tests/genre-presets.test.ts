import { describe, it, expect } from 'vitest';
import { GENRE_PRESETS } from '../src/shared/genre-presets';

describe('GENRE_PRESETS', () => {
  it('should have exactly 7 presets', () => {
    expect(Object.keys(GENRE_PRESETS)).toHaveLength(7);
  });

  it('should contain all expected genre keys', () => {
    const expectedKeys = ['general', 'wedding', 'portrait', 'sports', 'landscape', 'street', 'event'];
    expect(Object.keys(GENRE_PRESETS).sort()).toEqual(expectedKeys.sort());
  });

  it.each(Object.entries(GENRE_PRESETS))(
    'preset "%s" should have exactly 6 weight keys',
    (_genre, preset) => {
      const keys = Object.keys(preset);
      expect(keys).toHaveLength(6);
      expect(keys).toEqual(
        expect.arrayContaining(['quality', 'aesthetic', 'composition', 'sharpness', 'exposure', 'faceEyes']),
      );
    },
  );

  it.each(Object.entries(GENRE_PRESETS))(
    'preset "%s" weights should sum to 100',
    (_genre, preset) => {
      const total =
        preset.quality +
        preset.aesthetic +
        preset.composition +
        preset.sharpness +
        preset.exposure +
        preset.faceEyes;
      expect(total).toBe(100);
    },
  );

  it.each(Object.entries(GENRE_PRESETS))(
    'preset "%s" should have non-negative weight values',
    (_genre, preset) => {
      for (const val of Object.values(preset)) {
        expect(val).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it('landscape should have faceEyes = 0', () => {
    expect(GENRE_PRESETS.landscape.faceEyes).toBe(0);
  });

  it('portrait should have the highest faceEyes weight', () => {
    const faceEyesWeights = Object.values(GENRE_PRESETS).map((p) => p.faceEyes);
    const maxFaceEyes = Math.max(...faceEyesWeights);
    expect(GENRE_PRESETS.portrait.faceEyes).toBe(maxFaceEyes);
  });
});
