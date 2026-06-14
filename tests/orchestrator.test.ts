import { describe, it, expect } from 'vitest';
import { assignTiers } from '../src/main/orchestrator';
import { ScoreRecord } from '../src/shared/types';

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
    const records = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${i}`,
      record: makeScoreRecord(50 + i * 10),
    }));
    const result = assignTiers(records);
    expect(result.find(r => r.id === 'id-9')?.record.tier).toBe('S');
  });

  it('assigns A tier to next 30%', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${i}`,
      record: makeScoreRecord(50 + i * 10),
    }));
    const result = assignTiers(records);
    const tiers = result.map(r => r.record.tier);
    expect(tiers).toContain('A');
  });

  it('demotes images with total < 30 to rejected', () => {
    const records = [
      { id: 'a', record: makeScoreRecord(85, 'a') },
      { id: 'b', record: makeScoreRecord(20, 'b') },
    ];
    const result = assignTiers(records);
    expect(result.find(r => r.id === 'b')?.record.tier).toBe('rejected');
  });

  it('handles empty input', () => {
    const result = assignTiers([]);
    expect(result).toHaveLength(0);
  });

  it('handles single image', () => {
    const result = assignTiers([{ id: '1', record: makeScoreRecord(90) }]);
    expect(result[0].record.tier).toBe('S');
  });

  it('preserves pre-rejected images', () => {
    const good = makeScoreRecord(90, 'good');
    const bad = makeScoreRecord(25, 'bad');
    bad.faceMetadata.exceedsFaceLimit = true;
    bad.tier = 'rejected'; // pre-rejected images should already have rejected tier
    const result = assignTiers([
      { id: 'good', record: good },
      { id: 'bad', record: bad },
    ]);
    expect(result.find(r => r.id === 'bad')?.record.tier).toBe('rejected');
  });
});
