/**
 * ai-client.ts
 *
 * Phase 9 — Single AI scoring call.
 * Phase 10 — Discovery pass (multi-image, plain-text response).
 *
 * Implements five functions that together form the atomic scoring + discovery unit:
 *
 *   buildScoringPrompt()    → deterministic prompt string from AICallParams
 *   buildDiscoveryPrompt()  → discovery-pass prompt for multi-image genre analysis
 *   callAI()               → provider-routed HTTP request → AIRawResponse
 *   callAIDiscovery()      → multi-image plain-text call for the discovery pass
 *   computeWeightedTotal() → weighted average of 6 dimension scores
 *   scoreImage()           → full ScoreRecord (tier set to 'rejected' placeholder;
 *                            real tier assignment happens in Phase 10 orchestrator)
 *
 * Provider routing:
 *   - 'claude'  → Anthropic native API (/v1/messages) — always api.anthropic.com,
 *                 baseUrl is intentionally ignored for this provider.
 *   - all others → OpenAI-compatible /chat/completions via params.baseUrl
 *
 * Error hierarchy (see ai-errors.ts):
 *   AIAuthError       401  non-retryable
 *   AIRateLimitError  429  retryable after retryAfter seconds
 *   AIServerError     5xx  retryable
 *   AITimeoutError    —    retryable (fetch aborted after TIMEOUT_MS)
 *   AIParseError      —    non-retryable (bad model output)
 */

import type {
  AICallParams,
  AIRawResponse,
  AIProvider,
  ScoringWeights,
  ScoreRecord,
  GenrePreset,
} from '../shared/types';

import {
  AIAuthError,
  AIRateLimitError,
  AIServerError,
  AITimeoutError,
  AIParseError,
} from './ai-errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard timeout for every AI HTTP call. 30 s is generous for a single image. */
const TIMEOUT_MS = 30_000;

/** Anthropic API base URL — hardcoded, never overridden by params.baseUrl. */
const ANTHROPIC_BASE = 'https://api.anthropic.com';

/** Anthropic API version header value. */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Models known to be retired. callAI() logs a warning if it sees one of these
 * so operators can update their configuration without digging through error logs.
 */
const RETIRED_MODEL_SUBSTRINGS = ['20250514'];

// ---------------------------------------------------------------------------
// Scoring dimension metadata
// — used to annotate the prompt with human-readable descriptions for each axis
// ---------------------------------------------------------------------------

const DIMENSION_DESCRIPTIONS: Record<keyof ScoringWeights, string> = {
  quality:     'Overall technical image quality (noise, artefacts, dynamic range)',
  aesthetic:   'Visual appeal, mood, and artistic intent',
  composition: 'Framing, rule of thirds, leading lines, balance',
  sharpness:   'Focus accuracy and motion blur across the primary subject',
  exposure:    'Correct exposure — clipped highlights or blocked shadows reduce score',
  faceEyes:    'For images with faces: eye sharpness, catch-lights, open eyes, expressions',
};

// ---------------------------------------------------------------------------
// 9.2  buildScoringPrompt
// ---------------------------------------------------------------------------

/**
 * Builds the text prompt sent to the AI alongside the image.
 *
 * The prompt is fully deterministic given the same params — no randomness —
 * which means identical inputs always produce identical prompts (useful for
 * caching and reproducible tests).
 */
export function buildScoringPrompt(params: AICallParams): string {
  const {
    filename,
    discoveryContext,
    styleProfile,
    weights,
    faceMetadata,
  } = params;

  // ── Face metadata block ────────────────────────────────────────────────────
  const faceLines: string[] = [];
  if (faceMetadata.hasFaces) {
    faceLines.push(`Face detected: yes`);
    faceLines.push(`Face count: ${faceMetadata.faceCount}`);
    faceLines.push(`Eyes open: ${faceMetadata.eyesOpen ? 'yes' : 'no'}`);
    faceLines.push(`Blink detected: ${faceMetadata.blinkDetected ? 'yes' : 'no'}`);
    faceLines.push(`Expression neutral: ${faceMetadata.expressionNeutral ? 'yes' : 'no'}`);
  } else {
    faceLines.push(`Face detected: no`);
  }

  // ── Scoring rubric block — built from live weights so prompt always ────────
  // matches what the user configured, not hardcoded percentages.
  const rubricLines = (Object.keys(weights) as (keyof ScoringWeights)[]).map((dim) => {
    const w = weights[dim];
    const desc = DIMENSION_DESCRIPTIONS[dim];
    return `  - ${dim} (weight ${w}%): ${desc}`;
  });

  // ── Preference text — empty string is fine, the AI handles it gracefully ──
  const preferenceSection = styleProfile.preferenceText.trim()
    ? `User style preference: ${styleProfile.preferenceText.trim()}`
    : `User style preference: none specified`;

  return [
    `You are a professional photo culling assistant scoring a single image for a ${styleProfile.genre} photography shoot.`,
    ``,
    `Image filename: ${filename}`,
    ``,
    `Session context (from discovery pass):`,
    discoveryContext.trim() || `No discovery context available.`,
    ``,
    preferenceSection,
    ``,
    `Face metadata:`,
    ...faceLines,
    ``,
    `Scoring rubric — score each dimension from 0 to 100:`,
    ...rubricLines,
    ``,
    `Instructions:`,
    `- Examine the image carefully before scoring.`,
    `- Score each dimension independently on a 0–100 scale.`,
    `- If no faces are present, score faceEyes as 50 (neutral — not penalised).`,
    `- Provide a brief plain-text reasoning (2–4 sentences) explaining your scores.`,
    ``,
    `CRITICAL: Your entire response must be a single JSON object with exactly these keys:`,
    `{`,
    `  "quality": <0-100>,`,
    `  "aesthetic": <0-100>,`,
    `  "composition": <0-100>,`,
    `  "sharpness": <0-100>,`,
    `  "exposure": <0-100>,`,
    `  "faceEyes": <0-100>,`,
    `  "reasoning": "<plain text, no newlines>"`,
    `}`,
    ``,
    `Do NOT include markdown formatting, code fences, backticks, preamble, or any text`,
    `outside the JSON object. Output the raw JSON object and nothing else.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 10.1  buildDiscoveryPrompt
// ---------------------------------------------------------------------------

/**
 * Builds the plain-text prompt for the discovery pass.
 *
 * The discovery pass sends 5–8 representative sample images to the AI in a
 * single call and asks for a brief contextual summary of the shoot. This
 * summary is then threaded into every subsequent scoring prompt via the
 * `discoveryContext` field.
 *
 * The response is expected to be plain text (2–3 sentences), NOT JSON.
 *
 * @param genre        The shoot genre from AppSettings.
 * @param sampleCount  Number of sample images attached to this call.
 * @returns            Prompt string.
 */
export function buildDiscoveryPrompt(genre: GenrePreset, sampleCount: number): string {
  return [
    `You are analysing a batch of ${sampleCount} sample image${sampleCount !== 1 ? 's' : ''} from a ${genre} photography shoot.`,
    ``,
    `Examine all provided images together and answer the following in 2–3 sentences of plain text:`,
    `1. What is the visual style, subject matter, and overall mood of this shoot?`,
    `2. What does "best" mean in this specific context — what qualities should the strongest images have?`,
    ``,
    `Write your answer as a single paragraph of plain text. Do not use lists, headings, JSON, or`,
    `markdown. Your summary will be used as context for individual image scoring, so be specific`,
    `about what makes a great shot in this particular session.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 10.1  callAIDiscovery — multi-image plain-text call
// ---------------------------------------------------------------------------

/**
 * Makes a single AI API call with multiple sample images for the discovery pass.
 *
 * Unlike callAI(), this function:
 *   - Accepts an array of base64 image strings (5–8 images).
 *   - Returns raw plain text, not a parsed JSON score object.
 *   - Uses a longer timeout (60 s) because multi-image calls take more time.
 *
 * Provider routing follows the same logic as callAI():
 *   - claude  → Anthropic Messages API (multiple image content blocks)
 *   - others  → OpenAI-compatible /chat/completions (multiple image_url blocks)
 *
 * @param imageBase64s  Array of base64-encoded JPEG strings (no data-URI prefix).
 * @param prompt        Discovery prompt text (from buildDiscoveryPrompt).
 * @param params        Provider routing fields: provider, apiKey, model, baseUrl.
 * @returns             Plain-text discovery summary string from the AI.
 */
export async function callAIDiscovery(
  imageBase64s: string[],
  prompt: string,
  params: Pick<AICallParams, 'provider' | 'apiKey' | 'model' | 'baseUrl'>,
): Promise<string> {
  const { provider, model, apiKey, baseUrl } = params;

  // Multi-image calls take longer — use a more generous timeout.
  const discoveryTimeoutMs = 60_000;

  if (provider === 'claude') {
    return callClaudeDiscovery(model, apiKey, imageBase64s, prompt, discoveryTimeoutMs);
  } else {
    return callOpenAICompatDiscovery(provider, model, apiKey, baseUrl, imageBase64s, prompt, discoveryTimeoutMs);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a provider's base URL for OpenAI-compatible endpoints.
 *
 * Rules:
 *   - Strip trailing slashes.
 *   - If the URL does NOT end with /v1, append /v1.
 *     (Handles both "http://localhost:11434" and "http://localhost:11434/v1".)
 */
function normaliseBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v\d+$/.test(url)) {
    url = `${url}/v1`;
  }
  return url;
}

/**
 * Parses the `Retry-After` HTTP response header.
 * Returns the value in whole seconds, defaulting to 60 if missing or unparseable.
 */
function parseRetryAfter(headers: Headers): number {
  const raw = headers.get('retry-after') ?? headers.get('Retry-After');
  if (!raw) return 60;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 60 : Math.max(1, n);
}

/**
 * Strips accidental markdown fences that some models prepend despite
 * the explicit instruction not to.
 *
 * Handles:
 *   ```json\n{...}\n```
 *   ```\n{...}\n```
 *   {…}     (pass-through — already clean)
 */
function stripMarkdownFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Validates that a parsed object contains all 6 expected score keys with
 * numeric values in the 0–100 range, plus a non-empty reasoning string.
 *
 * Returns a normalised ScoringWeights + reasoning, or throws AIParseError.
 */
function validateAndExtractScores(
  parsed: unknown,
  provider: string,
  model: string,
  rawResponse: string,
): { scores: ScoringWeights; reasoning: string } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AIParseError(provider, model, rawResponse, 'root value is not an object');
  }

  const obj = parsed as Record<string, unknown>;
  const SCORE_KEYS: (keyof ScoringWeights)[] = [
    'quality', 'aesthetic', 'composition', 'sharpness', 'exposure', 'faceEyes',
  ];

  const scores = {} as ScoringWeights;

  for (const key of SCORE_KEYS) {
    const val = obj[key];
    if (typeof val !== 'number') {
      throw new AIParseError(
        provider, model, rawResponse,
        `key "${key}" is ${val === undefined ? 'missing' : `"${typeof val}" (expected number)`}`,
      );
    }
    if (!isFinite(val) || val < 0 || val > 100) {
      throw new AIParseError(
        provider, model, rawResponse,
        `key "${key}" value ${val} is out of range 0–100`,
      );
    }
    // Round to nearest integer — some models return e.g. 72.5
    scores[key] = Math.round(val);
  }

  const reasoning = obj['reasoning'];
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    throw new AIParseError(
      provider, model, rawResponse,
      'key "reasoning" is missing or empty',
    );
  }

  return { scores, reasoning: reasoning.trim() };
}

// ---------------------------------------------------------------------------
// 9.3  callAI — provider-specific routing
// ---------------------------------------------------------------------------

/**
 * Makes a single AI API call for one image.
 *
 * Branches on `params.provider`:
 *   - 'claude'  → Anthropic Messages API
 *   - all others → OpenAI-compatible chat completions
 *
 * Returns a validated AIRawResponse. All HTTP/network errors are converted to
 * typed instances from ai-errors.ts.
 */
export async function callAI(params: AICallParams): Promise<AIRawResponse> {
  const { provider, model, apiKey, imageBase64 } = params;

  // ── Retired model guard ────────────────────────────────────────────────────
  if (RETIRED_MODEL_SUBSTRINGS.some((s) => model.includes(s))) {
    console.warn(
      `[ai-client] Warning: model "${model}" may be retired. ` +
      `Consider updating to claude-sonnet-4-6 or claude-opus-4-7.`,
    );
  }

  const prompt = buildScoringPrompt(params);

  return provider === 'claude'
    ? callClaude(provider, model, apiKey, imageBase64, prompt)
    : callOpenAICompat(provider, model, apiKey, params.baseUrl, imageBase64, prompt);
}

// ---------------------------------------------------------------------------
// Claude (Anthropic native API) — single image scoring
// ---------------------------------------------------------------------------

async function callClaude(
  provider: AIProvider,
  model: string,
  apiKey: string,
  imageBase64: string,
  prompt: string,
): Promise<AIRawResponse> {
  const url = `${ANTHROPIC_BASE}/v1/messages`;

  const body = JSON.stringify({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AITimeoutError(provider, model);
    }
    throw err;
  }

  await assertHttpOk(res, provider, model);

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const rawText = data.content?.find((b) => b.type === 'text')?.text ?? '';
  return parseAIResponse(rawText, provider, model, data.usage
    ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
    : undefined,
  );
}

// ---------------------------------------------------------------------------
// Claude (Anthropic native API) — multi-image discovery pass
// ---------------------------------------------------------------------------

async function callClaudeDiscovery(
  model: string,
  apiKey: string,
  imageBase64s: string[],
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const url = `${ANTHROPIC_BASE}/v1/messages`;

  // Build content array: one image block per sample, then the text prompt.
  const content: object[] = [
    ...imageBase64s.map((b64) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: b64,
      },
    })),
    { type: 'text', text: prompt },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content }],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AITimeoutError('claude', model);
    }
    throw err;
  }

  await assertHttpOk(res, 'claude', model);

  const data = await res.json() as {
    content: Array<{ type: string; text?: string }>;
  };

  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (openai / gemini / ollama / custom) — single image scoring
// ---------------------------------------------------------------------------

async function callOpenAICompat(
  provider: AIProvider,
  model: string,
  apiKey: string,
  rawBaseUrl: string,
  imageBase64: string,
  prompt: string,
): Promise<AIRawResponse> {
  const baseUrl = normaliseBaseUrl(
    // Ollama default when the user left baseUrl empty
    rawBaseUrl || (provider === 'ollama' ? 'http://localhost:11434' : ''),
  );
  const url = `${baseUrl}/chat/completions`;

  // Build headers — Ollama works without an Authorization header (and errors
  // if a malformed one is supplied with an empty key).
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body = JSON.stringify({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              // 'high' detail = full-res processing for quality assessment
              detail: 'high',
            },
          },
        ],
      },
    ],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AITimeoutError(provider, model);
    }
    throw err;
  }

  await assertHttpOk(res, provider, model);

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const rawText = data.choices?.[0]?.message?.content ?? '';
  return parseAIResponse(rawText, provider, model, data.usage
    ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
    : undefined,
  );
}

// ---------------------------------------------------------------------------
// OpenAI-compatible — multi-image discovery pass
// ---------------------------------------------------------------------------

async function callOpenAICompatDiscovery(
  provider: AIProvider,
  model: string,
  apiKey: string,
  rawBaseUrl: string,
  imageBase64s: string[],
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const baseUrl = normaliseBaseUrl(
    rawBaseUrl || (provider === 'ollama' ? 'http://localhost:11434' : ''),
  );
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Build content: text prompt first, then one image_url block per sample.
  const content: object[] = [
    { type: 'text', text: prompt },
    ...imageBase64s.map((b64) => ({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${b64}`,
        detail: 'low', // Discovery pass only needs a coarse look
      },
    })),
  ];

  const body = JSON.stringify({
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content }],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AITimeoutError(provider, model);
    }
    throw err;
  }

  await assertHttpOk(res, provider, model);

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Shared HTTP error assertion
// ---------------------------------------------------------------------------

/**
 * Throws the appropriate typed error for non-2xx HTTP responses.
 * Extracts the provider's error message from the JSON body when available.
 */
async function assertHttpOk(
  res: Response,
  provider: string,
  model: string,
): Promise<void> {
  if (res.ok) return;

  // Attempt to extract a human-readable message from the response body.
  let detail: string | undefined;
  try {
    const body = await res.json() as Record<string, unknown>;
    // Anthropic: { error: { message: "..." } }
    // OpenAI:    { error: { message: "..." } }
    detail = (body?.error as any)?.message ?? undefined;
  } catch {
    // JSON parse failed — no detail available
  }

  switch (res.status) {
    case 401:
      throw new AIAuthError(provider, model, detail);
    case 429:
      throw new AIRateLimitError(provider, model, parseRetryAfter(res.headers));
    default:
      if (res.status >= 500) {
        throw new AIServerError(provider, model, res.status, detail);
      }
      // 4xx other than 401/429 — surface as a generic Error with context
      throw new Error(
        `[${provider}/${model}] Unexpected HTTP ${res.status}` +
          (detail ? `: ${detail}` : ` (${res.statusText})`),
      );
  }
}

// ---------------------------------------------------------------------------
// Shared response parsing
// ---------------------------------------------------------------------------

function parseAIResponse(
  rawText: string,
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number } | undefined,
): AIRawResponse {
  if (!rawText.trim()) {
    throw new AIParseError(provider, model, rawText, 'response text is empty');
  }

  const cleaned = stripMarkdownFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new AIParseError(
      provider, model, rawText,
      err instanceof SyntaxError ? err.message : 'JSON.parse failed',
    );
  }

  const { scores, reasoning } = validateAndExtractScores(
    parsed, provider, model, rawText,
  );

  return {
    scores,
    reasoning,
    usage: usage ?? { inputTokens: 0, outputTokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// 9.3  computeWeightedTotal
// ---------------------------------------------------------------------------

/**
 * Computes the composite weighted score to 2 decimal places.
 *
 * Each dimension contributes (score × weight%) to the total.
 * Weights are expected to sum to 100 but this function does not enforce that
 * constraint — if they don't, the output will simply not be a percentage.
 */
export function computeWeightedTotal(
  scores: ScoringWeights,
  weights: ScoringWeights,
): number {
  const keys: (keyof ScoringWeights)[] = [
    'quality', 'aesthetic', 'composition', 'sharpness', 'exposure', 'faceEyes',
  ];
  const raw = keys.reduce(
    (sum, k) => sum + scores[k] * (weights[k] / 100),
    0,
  );
  return Math.round(raw * 100) / 100;
}

// ---------------------------------------------------------------------------
// 9.3  scoreImage — the public entry point used by Phase 10
// ---------------------------------------------------------------------------

/**
 * Scores a single image: calls the AI, computes the weighted total, and
 * assembles a full ScoreRecord.
 *
 * `tier` is set to `'rejected'` as a placeholder. The Phase 10 orchestrator
 * assigns real tiers once all images in the session have been scored and can
 * be compared against one another.
 *
 * `usage` is always present — providers that return no usage data get zeros.
 */
export async function scoreImage(params: AICallParams): Promise<ScoreRecord> {
  const raw = await callAI(params);

  const total = computeWeightedTotal(raw.scores, params.weights);

  return {
    filename: params.filename,
    scores: raw.scores,
    total,
    // Tier is intentionally 'rejected' here — Phase 10 overwrites this after
    // ranking all scores across the full session.
    tier: 'rejected',
    reasoning: raw.reasoning,
    faceMetadata: params.faceMetadata,
    usage: raw.usage ?? { inputTokens: 0, outputTokens: 0 },
  };
}