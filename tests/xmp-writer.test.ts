import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  sidecarPath,
  writeXmpSidecar,
  writeAllSidecars,
} from '../src/main/xmp-writer';
import type { ScoreRecord } from '../../src/shared/types';

describe('sidecarPath', () => {
  it('replaces extension with .xmp', () => {
    const result = sidecarPath('/photos/wedding/IMG_001.CR3');
    expect(result.endsWith('IMG_001.xmp')).toBe(true);
    expect(path.extname(result)).toBe('.xmp');
  });

  it('works for JPEG inputs', () => {
    const result = sidecarPath('/tmp/DSC_042.jpg');
    expect(result.endsWith('DSC_042.xmp')).toBe(true);
  });

  it('preserves the original directory', () => {
    const original = path.join('deep', 'nested', 'path', 'image.nef');
    const result = sidecarPath(original);
    expect(path.dirname(result)).toBe(path.dirname(original));
  });
});

describe('writeXmpSidecar', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmp-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  function makeScore(tier: ScoreRecord['tier']): ScoreRecord {
    return {
      filename: 'IMG_001.jpg',
      scores: { quality: 80, aesthetic: 75, composition: 70, sharpness: 85, exposure: 90, faceEyes: 80 },
      total: 82.34,
      tier,
      reasoning: 'Sharp focus, good exposure',
      faceMetadata: { hasFaces: true, faceCount: 1, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
      keywords: ['portrait', 'natural light'],
    };
  }

  it('writes a valid XML file for S-tier', async () => {
    const original = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(original, 'fake');
    await writeXmpSidecar(makeScore('S'), original, true, ['portrait', 'natural light']);

    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).toContain('<xmp:Rating>5</xmp:Rating>');
    expect(xml).toContain('<xmp:Label>Green</xmp:Label>');
  });

  it('writes A-tier with rating 4 and Blue label', async () => {
    const original = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(original, 'fake');
    await writeXmpSidecar(makeScore('A'), original, true);

    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).toContain('<xmp:Rating>4</xmp:Rating>');
    expect(xml).toContain('<xmp:Label>Blue</xmp:Label>');
  });

  it('writes rejected with rating 1 and Red label', async () => {
    const original = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(original, 'fake');
    await writeXmpSidecar(makeScore('rejected'), original, true);

    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).toContain('<xmp:Rating>1</xmp:Rating>');
    expect(xml).toContain('<xmp:Label>Red</xmp:Label>');
  });

  it('escapes XML special chars in reasoning', async () => {
    const original = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(original, 'fake');
    const score = makeScore('S');
    score.reasoning = 'Sharp focus on 5" lens & tripod';

    await writeXmpSidecar(score, original, true);
    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).toContain('&quot;');
    expect(xml).not.toContain('5"');
    expect(xml).toContain('&amp;');
  });

  it('includes dc:subject with rdf:Bag when keywords present', async () => {
    const original = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(original, 'fake');
    await writeXmpSidecar(makeScore('S'), original, true, ['portrait', 'natural light']);

    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).toContain('<dc:subject>');
    expect(xml).toContain('<rdf:Bag>');
    expect(xml).toContain('<rdf:li>portrait</rdf:li>');
    expect(xml).toContain('<rdf:li>natural light</rdf:li>');
  });

  it('omits dc:subject when no keywords', async () => {
    const original = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(original, 'fake');
    const score = makeScore('S');
    score.keywords = undefined;

    await writeXmpSidecar(score, original, true);
    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).not.toContain('dc:subject');
  });
});

describe('writeAllSidecars', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmp-batch-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('writes multiple sidecars and reports count', async () => {
    const scores: ScoreRecord[] = [
      { filename: 'A.jpg', scores: {}, total: 50, tier: 'S', reasoning: '', faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false } },
      { filename: 'B.jpg', scores: {}, total: 50, tier: 'A', reasoning: '', faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false } },
    ];

    const imagePathMap: Record<string, string> = {
      'A.jpg': path.join(tmpDir, 'A.jpg'),
      'B.jpg': path.join(tmpDir, 'B.jpg'),
    };

    fs.writeFileSync(imagePathMap['A.jpg'], 'fake');
    fs.writeFileSync(imagePathMap['B.jpg'], 'fake');

    const result = await writeAllSidecars(scores, imagePathMap, true);
    expect(result.written).toBe(2);
    expect(result.errors).toHaveLength(0);

    expect(fs.existsSync(path.join(tmpDir, 'A.xmp'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'B.xmp'))).toBe(true);
  });

  it('reports error when path mapping is missing', async () => {
    const scores: ScoreRecord[] = [
      { filename: 'missing.jpg', scores: {}, total: 50, tier: 'S', reasoning: '', faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false } },
    ];

    const result = await writeAllSidecars(scores, {}, true);
    expect(result.written).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
