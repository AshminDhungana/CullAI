import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createSession,
  saveScore,
  loadSession,
  hasExistingSession,
  getScoredIds,
  markSessionComplete,
  markSessionCancelled,
  clearSession,
  sessionFilePath,
  updateTier,
} from '../src/main/session-manager.ts';
import { AppSettings } from '../src/shared/types';

function makeSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    inputFolder: '/tmp/input',
    outputFolder: '/tmp/output',
    numImagesToSelect: 20,
    genre: 'general',
    weights: { quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 },
    activeProfileId: null,
    preferenceText: '',
    provider: 'claude',
    apiKey: 'test-key',
    baseUrl: '',
    model: 'claude-test',
    concurrency: 5,
    extensionFilter: [],
    prefixFilter: [],
    prefixCaseInsensitive: true,
    ignorePatterns: [],
    referenceImage: null,
    disableDuplicateGrouping: false,
    duplicateThreshold: 10,
    maxFacesPerImage: 0,
    lightroomMode: 'copyToOutput',
    enableXmpExport: false,
    shortfallStrategy: 'stop',
    processSubfolders: false,
    preserveSubfolderStructure: false,
    enableAutoTagging: false,
    tagTopPercent: 20,
    dryRun: false,
    rawCacheMaxSizeGb: 5,
    rawCacheMaxAgeDays: 30,
    disableRawCache: false,
    useEmbeddedPreview: true,
    ...overrides,
  };
}

describe('sessionFilePath', () => {
  it('returns absolute path to session.json inside output folder', () => {
    const p = sessionFilePath('/some/output');
    expect(p).toBe(path.resolve('/some/output', 'session.json'));
  });
});

describe('createSession', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates a session with correct initial state', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    const session = await createSession(settings, 100);

    expect(session.sessionId).toBeDefined();
    expect(session.status).toBe('running');
    expect(session.scoredCount).toBe(0);
    expect(session.totalImages).toBe(100);
    expect(session.settings).toBe(settings);
    expect(Object.keys(session.scores)).toHaveLength(0);
  });

  it('writes session.json to output folder', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 50);

    const filePath = path.join(tmpDir, 'session.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('generates a unique sessionId per call', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    const s1 = await createSession(settings, 10);
    const s2 = await createSession(settings, 10);
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });
});

describe('saveScore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-save-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeScore(filename: string) {
    return {
      filename,
      scores: { quality: 80, aesthetic: 75, composition: 70, sharpness: 85, exposure: 90, faceEyes: 80 },
      total: 82.34,
      tier: 'S' as const,
      reasoning: 'Sharp',
      faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
    };
  }

  it('increments scoredCount after each save', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);

    await saveScore(tmpDir, 'id-1', makeScore('IMG_001.jpg'));
    await saveScore(tmpDir, 'id-2', makeScore('IMG_002.jpg'));

    const session = await loadSession(tmpDir);
    expect(session!.scoredCount).toBe(2);
  });

  it('stores score keyed by imageId', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);

    const score = makeScore('IMG_001.jpg');
    await saveScore(tmpDir, 'abc123', score);

    const session = await loadSession(tmpDir);
    expect(session!.scores['abc123']).toBeDefined();
    expect(session!.scores['abc123'].filename).toBe('IMG_001.jpg');
  });

  it('is safe for concurrent saves', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 100);

    const promises = Array.from({ length: 20 }, (_, i) =>
      saveScore(tmpDir, `id-${i}`, makeScore(`IMG_${String(i).padStart(3, '0')}.jpg`))
    );
    await Promise.all(promises);

    const session = await loadSession(tmpDir);
    expect(session!.scoredCount).toBe(20);
  });
});

describe('loadSession', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-load-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns null when no session exists', async () => {
    const session = await loadSession(tmpDir);
    expect(session).toBeNull();
  });

  it('recovers from .bak when main file is corrupt', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);

    // Save a score to trigger an atomicWrite, which creates a .bak
    const score = {
      filename: 'test.jpg',
      scores: { quality: 80, aesthetic: 75, composition: 70, sharpness: 85, exposure: 90, faceEyes: 80 },
      total: 82.34,
      tier: 'S' as const,
      reasoning: 'Sharp',
      faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
    };
    await saveScore(tmpDir, 'id-1', score);

    // Corrupt the main file
    fs.writeFileSync(path.join(tmpDir, 'session.json'), '{ broken json');

    // Should fall back to .bak and still return a valid session
    const session = await loadSession(tmpDir);
    expect(session).not.toBeNull();
    expect(session!.status).toBe('running');
  });
});

describe('hasExistingSession', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-exists-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns false when no session exists', async () => {
    expect(await hasExistingSession(tmpDir)).toBe(false);
  });

  it('returns true after createSession', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);
    expect(await hasExistingSession(tmpDir)).toBe(true);
  });
});

describe('getScoredIds', () => {
  it('returns empty set when no scores', () => {
    const session = {
      sessionId: 'test',
      createdAt: new Date().toISOString(),
      inputFolder: '/tmp',
      outputFolder: '/tmp',
      totalImages: 10,
      scoredCount: 0,
      status: 'running' as const,
      settings: makeSettings(),
      scores: {},
      discoveryContext: '',
    };
    expect(getScoredIds(session)).toEqual(new Set());
  });

  it('returns set of keys from scores map', () => {
    const session = {
      sessionId: 'test',
      createdAt: new Date().toISOString(),
      inputFolder: '/tmp',
      outputFolder: '/tmp',
      totalImages: 10,
      scoredCount: 2,
      status: 'running' as const,
      settings: makeSettings(),
      scores: {
        id1: { scores: {}, total: 50, tier: 'S', reasoning: '', faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false } } as any,
        id2: { scores: {}, total: 40, tier: 'A', reasoning: '', faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false } } as any,
      },
      discoveryContext: '',
    };
    expect(getScoredIds(session)).toEqual(new Set(['id1', 'id2']));
  });
});

describe('markSessionComplete and markSessionCancelled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-mark-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('marks session as completed', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);
    await markSessionComplete(tmpDir);

    const session = await loadSession(tmpDir);
    expect(session!.status).toBe('completed');
  });

  it('marks session as cancelled', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);
    await markSessionCancelled(tmpDir);

    const session = await loadSession(tmpDir);
    expect(session!.status).toBe('cancelled');
  });
});

describe('clearSession', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-clear-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('deletes session.json', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);
    expect(fs.existsSync(path.join(tmpDir, 'session.json'))).toBe(true);

    await clearSession(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'session.json'))).toBe(false);
  });
});

describe('updateTier', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-update-tier-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('updates the tier of an existing score', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);

    const score = {
      filename: 'IMG_001.jpg',
      scores: { quality: 80, aesthetic: 75, composition: 70, sharpness: 85, exposure: 90, faceEyes: 80 },
      total: 82.34,
      tier: 'S' as const,
      reasoning: 'Good shot',
      faceMetadata: { hasFaces: false, faceCount: 0, eyesOpen: true, blinkDetected: false, expressionNeutral: true, boundingBoxes: [], exceedsFaceLimit: false },
    };

    await saveScore(tmpDir, 'id-1', score);
    const updated = await updateTier(tmpDir, 'id-1', 'A');

    expect(updated).not.toBeNull();
    expect(updated!.tier).toBe('A');

    const session = await loadSession(tmpDir);
    expect(session!.scores['id-1'].tier).toBe('A');
  });

  it('returns null when imageId does not exist', async () => {
    const settings = makeSettings({ outputFolder: tmpDir });
    await createSession(settings, 10);

    const result = await updateTier(tmpDir, 'nonexistent', 'B');
    expect(result).toBeNull();
  });
});
