/**
 * src/shared/constants.ts
 */

/**
 * Splash screen display duration in milliseconds.
 * Animation is ~1.52s, then holds for ~1.5s before dismissing.
 */
export const SPLASH_DURATION_MS = 3000;

// ---------------------------------------------------------------------------
// Phase 11.5 — Per-provider token pricing
//
// Costs are in USD per 1,000,000 tokens (i.e. micro-dollars per token × 1e6).
// Using per-million because the numbers are more readable than per-token
// scientific notation, and the renderer divides by 1_000_000 when computing.
//
// Sources (update when providers revise pricing):
//   Claude:  https://www.anthropic.com/pricing  (claude-sonnet-4-6 / opus-4-7)
//   OpenAI:  https://openai.com/pricing         (gpt-4o)
//   Gemini:  https://ai.google.dev/pricing       (gemini-1.5-pro)
//   Ollama:  local model — no cost
//   Custom:  unknown endpoint — no cost
//
// Structure:  { inputPerMToken: number, outputPerMToken: number }
//   inputPerMToken  — USD per 1 000 000 input  tokens
//   outputPerMToken — USD per 1 000 000 output tokens
// ---------------------------------------------------------------------------

export type ProviderTokenCost = {
  /** USD per 1 000 000 input tokens. */
  inputPerMToken: number;
  /** USD per 1 000 000 output tokens. */
  outputPerMToken: number;
};

/**
 * Known per-provider pricing.
 *
 * 'claude', 'openai', 'gemini' use the most common/current model pricing as a
 * reasonable default. The renderer should treat these as estimates — exact cost
 * depends on the model actually selected, which may differ from this default.
 *
 * 'ollama' and 'custom' are free/unknown — both costs are 0.
 */
export const PROVIDER_TOKEN_COSTS: Record<string, ProviderTokenCost> = {
  // claude-sonnet-4-6 pricing
  claude:  { inputPerMToken: 3.00,  outputPerMToken: 15.00 },
  // gpt-4o pricing
  openai:  { inputPerMToken: 2.50,  outputPerMToken: 10.00 },
  // gemini-1.5-pro pricing
  gemini:  { inputPerMToken: 1.25,  outputPerMToken: 5.00  },
  // local — no API cost
  ollama:  { inputPerMToken: 0,     outputPerMToken: 0     },
  // user-supplied endpoint — cost unknown
  custom:  { inputPerMToken: 0,     outputPerMToken: 0     },
};

/**
 * Computes estimated USD cost from cumulative token counts.
 *
 * @param provider         AIProvider string key.
 * @param totalInputTokens  Cumulative input tokens so far.
 * @param totalOutputTokens Cumulative output tokens so far.
 * @returns Estimated cost in USD, rounded to 4 decimal places.
 *          Returns 0 for unknown providers or zero-cost providers (ollama, custom).
 */
export function estimateCost(
  provider: string,
  totalInputTokens: number,
  totalOutputTokens: number,
): number {
  const pricing = PROVIDER_TOKEN_COSTS[provider];
  if (!pricing) return 0;
  const raw =
    (totalInputTokens  / 1_000_000) * pricing.inputPerMToken +
    (totalOutputTokens / 1_000_000) * pricing.outputPerMToken;
  return Math.round(raw * 10_000) / 10_000;
}