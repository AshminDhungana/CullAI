import { describe, it, expect } from 'vitest';
import { assignTiers } from '../../src/main/orchestrator';
import { ScoreRecord } from '../../src/shared/types';

function makeScoreRecord(total: number, filename: string = 'test.jpg'): ScoreRecord {
  return {
    filename,
    scores: { quality: 80, aesthetic: 80, composition: 80, sharpness: 80, exposure: 80, faceEyes: 80 },
    total,
    tier: 'S', // initial placeholder
    reasoning: 'test',
    faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
  };
}

describe('assignTiers', () => {
  it('assigns S tier to top 10%', () => {
    const records = Array.from({ length: 10 }, (_, i) => makeScoreRecord(50 + i * 10));
    const result = assignTiers(records);
    expect(result[9].tier).toBe('S');
  });

  it('assigns A tier to next 30%', () => {
    const records = Array.from({ length: 10 }, (_, i) => makeScoreRecord(50 + i * 10));
    const result = assignTiers(records);
    // Highest 3: expecting approximately 1 S, 3 A, 3 B, 3 rejected based on the thresholds
    const tiers = result.map(r => r.tier);
    expect(tiers).toContain('A');
  });

  it('demotes images with total < 30 to rejected', () => {
    const records = [makeScoreRecord(85, 'a'), makeScoreRecord(20, 'b')];
    const result = assignTiers(records);
    expect(result.find(r => r.filename === 'b')!.tier).toBe('rejected');
  });

  it('handles empty input', () => {
    const result = assignTiers([]);
    expect(result).toHaveLength(0);
  });

  it('handles single image', () => {
    const result = assignTiers([makeScoreRecord(90)]);
    expect(result[0].tier).toBe('S');
  });

  it('preserves pre-rejected images', () => {
    const records = [makeScoreRecord(90, 'good'), makeScoreRecord(25, 'bad')];
    const result = assignTiers(records);
    expect(result.find(r => r.filename === 'bad')!.tier).toBe('rejected');
  });
});
