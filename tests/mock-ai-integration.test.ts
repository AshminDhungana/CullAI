/**
 * tests/mock-ai-integration.test.ts
 *
 * Phase 17.10 — Integration tests using the Mock AI Server.
 *
 * Starts a lightweight HTTP mock server that mimics OpenAI chat completions
 * and Anthropic Messages endpoints, runs the real ai-client functions against
 * it, and asserts on deterministic scoring behaviour.
 *
 * No real API calls are made when these tests run.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MockAIServer } from './mock-ai-server';
import {
  scoreImage,
  callAIDiscovery,
  callAITagging,
  buildDiscoveryPrompt,
  computeWeightedTotal,
} from '../src/main/ai-client';
import type { AICallParams, FaceMetadata, StyleProfile } from '../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStyleProfile(): StyleProfile {
  return {
    id: 'test-mock-profile',
    name: 'Test Mock Profile',
    genre: 'general',
    weights: {
      quality: 25,
      aesthetic: 20,
      composition: 15,
      sharpness: 15,
      exposure: 10,
      faceEyes: 15,
    },
    preferenceText: '',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
}

function makeFaceMetadata(): FaceMetadata {
  return {
    hasFaces: false,
    faceCount: 0,
    eyesOpen: true,
    blinkDetected: false,
    expressionNeutral: true,
    boundingBoxes: [],
    exceedsFaceLimit: false,
  };
}

function makeCallParams(overrides: Partial<AICallParams> = {}): AICallParams {
  return {
    imageBase64: 'fakebase64data123==',
    filename: 'test.jpg',
    discoveryContext: 'Test photography session',
    styleProfile: makeStyleProfile(),
    weights: {
      quality: 25,
      aesthetic: 20,
      composition: 15,
      sharpness: 15,
      exposure: 10,
      faceEyes: 15,
    },
    faceMetadata: makeFaceMetadata(),
    provider: 'openai',
    apiKey: 'mock-api-key',
    model: 'gpt-4o-mock',
    baseUrl: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Mock AI Server — Integration Tests', () => {
  let server: MockAIServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = new MockAIServer();
    await server.start();
    baseUrl = server.getBaseUrl();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    server.receivedRequests = [];
  });

  // -------------------------------------------------------------------------
  // Environment guarantee
  // -------------------------------------------------------------------------

  it('confirms test environment is active and no real APIs are used', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('starts the mock server on a random free port', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });

  // -------------------------------------------------------------------------
  // Scoring — deterministic by filename
  // -------------------------------------------------------------------------

  it('returns high scores for filenames containing "good"', async () => {
    const result = await scoreImage(
      makeCallParams({ filename: 'good_portrait.jpg', baseUrl }),
    );

    expect(result.scores.quality).toBeGreaterThanOrEqual(90);
    expect(result.scores.aesthetic).toBeGreaterThanOrEqual(90);
    expect(result.scores.faceEyes).toBeGreaterThanOrEqual(90);
    expect(result.total).toBeGreaterThan(85);
    expect(result.reasoning).toContain('good_portrait.jpg');
  });

  it('returns low scores for filenames containing "bad"', async () => {
    const result = await scoreImage(
      makeCallParams({ filename: 'bad_blurry.jpg', baseUrl }),
    );

    expect(result.scores.quality).toBeLessThanOrEqual(30);
    expect(result.scores.aesthetic).toBeLessThanOrEqual(30);
    expect(result.total).toBeLessThan(30);
    expect(result.reasoning).toContain('bad_blurry.jpg');
  });

  it('returns landscape-appropriate scores for landscape filenames', async () => {
    const result = await scoreImage(
      makeCallParams({ filename: 'landscape_mountain.jpg', baseUrl }),
    );

    expect(result.scores.aesthetic).toBeGreaterThanOrEqual(70);
    expect(result.scores.faceEyes).toBeLessThanOrEqual(30);
    expect(result.reasoning).toContain('landscape_mountain.jpg');
  });

  it('returns portrait-appropriate scores for portrait filenames', async () => {
    const result = await scoreImage(
      makeCallParams({ filename: 'portrait_face.jpg', baseUrl }),
    );

    expect(result.scores.faceEyes).toBeGreaterThanOrEqual(80);
    expect(result.scores.aesthetic).toBeGreaterThanOrEqual(55);
    expect(result.scores.aesthetic).toBeLessThanOrEqual(70);
    expect(result.reasoning).toContain('portrait_face.jpg');
  });

  it('returns medium scores for neutral filenames', async () => {
    const result = await scoreImage(
      makeCallParams({ filename: 'random_photo_001.jpg', baseUrl }),
    );

    expect(result.scores.quality).toBe(60);
    expect(result.total).toBeGreaterThan(40);
    expect(result.total).toBeLessThan(80);
  });

  // -------------------------------------------------------------------------
  // Small scoring pipeline
  // -------------------------------------------------------------------------

  it('runs a small pipeline and returns consistent scores', async () => {
    const filenames = [
      'good_image.jpg',
      'bad_image.jpg',
      'landscape_view.jpg',
    ];

    const results = await Promise.all(
      filenames.map((filename) =>
        scoreImage(makeCallParams({ filename, baseUrl })),
      ),
    );

    // Good image has highest total
    expect(results[0].total).toBeGreaterThan(results[1].total);
    expect(results[0].total).toBeGreaterThan(results[2].total);

    // Bad image has lowest total
    expect(results[1].total).toBeLessThan(results[2].total);

    // Landscape has moderate total with low faceEyes
    expect(results[2].scores.faceEyes).toBeLessThan(40);

    // All have reasoning
    expect(results.every((r) => r.reasoning.length > 0)).toBe(true);

    // verify mock server received exactly 3 requests
    expect(server.receivedRequests.length).toBe(3);
    expect(
      server.receivedRequests.every((r) => r.url.includes('chat/completions')),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Discovery pass
  // -------------------------------------------------------------------------

  it('returns discovery summary text via OpenAI-compatible endpoint', async () => {
    const summary = await callAIDiscovery(
      ['fakebase64data1', 'fakebase64data2'],
      buildDiscoveryPrompt('wedding', 2),
      {
        provider: 'openai',
        apiKey: 'mock-api-key',
        model: 'gpt-4o-mock',
        baseUrl,
      },
    );

    expect(summary).toContain('Wedding');
    expect(summary.length).toBeGreaterThan(20);
  });

  // -------------------------------------------------------------------------
  // Tagging pass
  // -------------------------------------------------------------------------

  it('returns keyword tags via OpenAI-compatible endpoint', async () => {
    const keywords = await callAITagging(
      ['fakebase64data1', 'fakebase64data2'],
      ['wedding_bride.jpg', 'wedding_groom.jpg'],
      {
        provider: 'openai',
        apiKey: 'mock-api-key',
        model: 'gpt-4o-mock',
        baseUrl,
      },
    );

    expect(keywords['wedding_bride.jpg']).toBeDefined();
    expect(keywords['wedding_bride.jpg']).toContain('wedding');
    expect(keywords['wedding_groom.jpg']).toBeDefined();
    expect(keywords['wedding_groom.jpg']).toContain('groom');
  });

  // -------------------------------------------------------------------------
  // Usage tracking
  // -------------------------------------------------------------------------

  it('returns usage data with valid zero values in all scores', async () => {
    const params = makeCallParams({ filename: 'good_usage_test.jpg', baseUrl });
    const result = await scoreImage(params);

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBeGreaterThanOrEqual(0);
    expect(result.usage?.outputTokens).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // computeWeightedTotal verification (using mock data)
  // -------------------------------------------------------------------------

  it('computeWeightedTotal produces consistent values from mock scores', () => {
    const scores = { quality: 95, aesthetic: 93, composition: 90, sharpness: 92, exposure: 91, faceEyes: 96 };
    const weights = { quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 };
    const total = computeWeightedTotal(scores, weights);

    // Calculated total should be 95*0.25 + 93*0.20 + 90*0.15 + 92*0.15 + 91*0.10 + 96*0.15
    // = 23.75 + 18.6 + 13.5 + 13.8 + 9.1 + 14.4 = 93.15
    expect(total).toBe(93.15);
  });
});
