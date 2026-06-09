/**
 * test-ai-call.ts
 *
 * Phase 9 — Manual end-to-end test script.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx src/scripts/test-ai-call.ts
 *
 * Optional env vars:
 *   PROVIDER        claude | openai | ollama | gemini | custom  (default: claude)
 *   AI_API_KEY      API key (falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY)
 *   AI_MODEL        Override model string
 *   AI_BASE_URL     Base URL for ollama / custom  (default: http://localhost:11434)
 *   FIXTURE_PATH    Path to a JPEG to score  (default: tests/fixtures/sample.jpg)
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — assertion failed or unexpected error
 */

import * as fs from 'fs';
import * as path from 'path';
import { scoreImage, computeWeightedTotal } from '../main/ai-client';
import type { AICallParams, FaceMetadata, ScoringWeights, StyleProfile } from '../shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌  ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function header(title: string): void {
  const bar = '─'.repeat(60);
  console.log(`\n${bar}`);
  console.log(`  ${title}`);
  console.log(bar);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const provider = (env('PROVIDER', 'claude')) as AICallParams['provider'];

const apiKey: string = (() => {
  if (env('AI_API_KEY')) return env('AI_API_KEY');
  if (provider === 'claude')  return env('ANTHROPIC_API_KEY');
  if (provider === 'openai')  return env('OPENAI_API_KEY');
  if (provider === 'gemini')  return env('GEMINI_API_KEY');
  return '';
})();

const MODEL_DEFAULTS: Record<string, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  ollama: 'llava',
  custom: 'llava',
};
const model   = env('AI_MODEL', MODEL_DEFAULTS[provider] ?? 'claude-sonnet-4-6');
const baseUrl = env('AI_BASE_URL', provider === 'ollama' ? 'http://localhost:11434' : '');

// ---------------------------------------------------------------------------
// Fixture image
// ---------------------------------------------------------------------------

const fixturePath = env(
  'FIXTURE_PATH',
  path.join(process.cwd(), 'tests', 'fixtures', 'sample.jpg'),
);

if (!fs.existsSync(fixturePath)) {
  console.error(
    `\n❌  Fixture not found: ${fixturePath}\n` +
    `    Set FIXTURE_PATH=path/to/image.jpg or add a sample.jpg to tests/fixtures/`,
  );
  process.exit(1);
}

const imageBase64 = fs.readFileSync(fixturePath).toString('base64');
const filename = path.basename(fixturePath);

// ---------------------------------------------------------------------------
// Minimal stubs for test context
// ---------------------------------------------------------------------------

const weights: ScoringWeights = {
  quality:     25,
  aesthetic:   20,
  composition: 15,
  sharpness:   15,
  exposure:    10,
  faceEyes:    15,
};

const styleProfile: StyleProfile = {
  id:             'test-profile-001',
  name:           'Test Profile',
  genre:          'portrait',
  weights,
  preferenceText: 'Natural light, candid moments, authentic emotion.',
  createdAt:      new Date().toISOString(),
  lastUsedAt:     new Date().toISOString(),
};

const faceMetadata: FaceMetadata = {
  hasFaces:         false,
  faceCount:        0,
  eyesOpen:         false,
  blinkDetected:    false,
  expressionNeutral: false,
  boundingBoxes:    [],
  exceedsFaceLimit: false,
};

const params: AICallParams = {
  imageBase64,
  filename,
  discoveryContext:
    'Outdoor portrait session in a park. Mixed natural light. ' +
    'Approximately 50 images. Subjects include adults in casual clothing.',
  styleProfile,
  weights,
  faceMetadata,
  provider,
  apiKey,
  model,
  baseUrl,
};

// ---------------------------------------------------------------------------
// Run test
// ---------------------------------------------------------------------------

header(`Phase 9 — AI Call Test`);
console.log(`  Provider  : ${provider}`);
console.log(`  Model     : ${model}`);
console.log(`  Base URL  : ${baseUrl || '(default)'}`);
console.log(`  Fixture   : ${filename}`);
console.log(`  API key   : ${apiKey ? '✓ present' : '⚠ MISSING'}`);

if (!apiKey && provider !== 'ollama') {
  console.error(
    `\n⚠  No API key found for provider "${provider}". ` +
    `Set the ANTHROPIC_API_KEY / OPENAI_API_KEY env var.`,
  );
  process.exit(1);
}

header('Calling scoreImage()...');
const start = Date.now();

let result: Awaited<ReturnType<typeof scoreImage>>;
try {
  result = await scoreImage(params);
} catch (err: unknown) {
  console.error('\n❌  scoreImage() threw:', err);
  process.exit(1);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(2);
console.log(`  Completed in ${elapsed}s`);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

header('Assertions');

const SCORE_KEYS: (keyof ScoringWeights)[] = [
  'quality', 'aesthetic', 'composition', 'sharpness', 'exposure', 'faceEyes',
];

for (const key of SCORE_KEYS) {
  const v = result.scores[key];
  assert(typeof v === 'number', `scores.${key} is not a number`);
  assert(v >= 0 && v <= 100, `scores.${key} = ${v} is out of range 0–100`);
  console.log(`  ✓  scores.${key.padEnd(12)} = ${v}`);
}

assert(typeof result.total === 'number', 'total is not a number');
assert(result.total >= 0 && result.total <= 100, `total ${result.total} is out of range`);
console.log(`  ✓  total               = ${result.total}`);

// Verify weighted total matches our own calculation (within float tolerance)
const recomputed = computeWeightedTotal(result.scores, weights);
assert(
  Math.abs(recomputed - result.total) < 0.01,
  `total ${result.total} does not match recomputed ${recomputed}`,
);
console.log(`  ✓  weighted total check  passed (recomputed: ${recomputed})`);

assert(typeof result.reasoning === 'string', 'reasoning is not a string');
assert(result.reasoning.trim().length > 0, 'reasoning is empty');
console.log(`  ✓  reasoning             present (${result.reasoning.length} chars)`);

assert(result.tier === 'rejected', `tier should be 'rejected' placeholder, got "${result.tier}"`);
console.log(`  ✓  tier                  = '${result.tier}' (Phase 10 placeholder)`);

assert(result.filename === filename, `filename mismatch`);
console.log(`  ✓  filename              = ${result.filename}`);

assert(typeof result.usage === 'object', 'usage is missing');
assert(typeof result.usage!.inputTokens === 'number', 'usage.inputTokens is not a number');
assert(typeof result.usage!.outputTokens === 'number', 'usage.outputTokens is not a number');
console.log(`  ✓  usage                 in=${result.usage!.inputTokens}  out=${result.usage!.outputTokens}`);

// ---------------------------------------------------------------------------
// Print full result
// ---------------------------------------------------------------------------

header('Full ScoreRecord');
console.log(JSON.stringify(result, null, 2));

console.log(`\n✅  All assertions passed.\n`);