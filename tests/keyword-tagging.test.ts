import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeXmpSidecar } from '../src/main/xmp-writer';

describe('XMP keyword tagging', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyword-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('embeds keywords as dc:subject with rdf:Bag', async () => {
    const imagePath = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(imagePath, 'fake');

    const score = {
      filename: 'IMG_001.jpg',
      scores: {},
      total: 82,
      tier: 'S' as const,
      reasoning: 'Great shot',
      faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
      keywords: ['portrait', 'golden hour', 'emotion'],
    } as any;

    await writeXmpSidecar(score, imagePath, true, score.keywords);

    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');

    expect(xml).toContain('<dc:subject>');
    expect(xml).toContain('<rdf:Bag>');
    expect(xml).toContain('<rdf:li>portrait</rdf:li>');
    expect(xml).toContain('<rdf:li>golden hour</rdf:li>');
    expect(xml).toContain('<rdf:li>emotion</rdf:li>');
  });

  it('omits dc:subject when keywords array is empty', async () => {
    const imagePath = path.join(tmpDir, 'IMG_001.jpg');
    fs.writeFileSync(imagePath, 'fake');

    const score = {
      filename: 'IMG_001.jpg',
      scores: {},
      total: 82,
      tier: 'S' as const,
      reasoning: 'Great shot',
      faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
      keywords: [],
    } as any;

    await writeXmpSidecar(score, imagePath, true, score.keywords);

    const xmpPath = path.join(tmpDir, 'IMG_001.xmp');
    const xml = fs.readFileSync(xmpPath, 'utf8');
    expect(xml).not.toContain('dc:subject');
  });
});
