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
//   Claude:  https://www.anthropic.com/pricing  (claude-sonnet-4-6)
//   OpenAI:  https://openai.com/pricing         (gpt-4.1 — replaces gpt-4o as API default)
//   Gemini:  https://ai.google.dev/pricing       (gemini-3.5-flash — GA May 2026)
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
  // gpt-4.1 pricing (replaces gpt-4o as recommended API default)
  openai:  { inputPerMToken: 2.00,  outputPerMToken: 8.00  },
  // gemini-3.5-flash pricing (GA May 2026, replaces gemini-1.5-pro as default)
  gemini:  { inputPerMToken: 1.50,  outputPerMToken: 9.00  },
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

// ---------------------------------------------------------------------------
// Phase 15 — Provider default configurations
//
// Single source of truth for both the renderer (Setup.tsx auto-fill on
// provider change) and the main process (test-connection fallback model).
//
// Model string rationale (updated June 2026):
//   claude  → claude-sonnet-4-6
//               Recommended daily-driver. $3/$15 per MTok. Vision-capable.
//   openai  → gpt-4.1
//               Launched April 2025. Outperforms gpt-4o across benchmarks.
//               $2/$8 per MTok. gpt-5.5 exists but is 2.5× more expensive
//               with no meaningful gain for photo scoring.
//   gemini  → gemini-3.5-flash
//               GA'd May 19 2026 at Google I/O. 1M context, multimodal.
//               $1.50/$9.00 per MTok. gemini-2.5-flash deprecated Jun 17 2026.
//   ollama  → llava
//               Canonical local vision model. Free.
//   custom  → '' (user must supply)
//
// Note: claude baseUrl is intentionally empty — ai-client.ts hardcodes
// https://api.anthropic.com/v1/messages and ignores baseUrl for Claude.
// ---------------------------------------------------------------------------

export type ProviderDefaults = {
  /** Base URL for OpenAI-compatible providers. Empty string for Claude (hardcoded in ai-client). */
  baseUrl: string;
  /** Default model string pre-filled in Setup UI and used as fallback in test-connection. */
  defaultModel: string;
};

export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  claude: { baseUrl: '',                                                         defaultModel: 'claude-sonnet-4-6' },
  openai: { baseUrl: 'https://api.openai.com/v1',                               defaultModel: 'gpt-4.1'           },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.5-flash'  },
  ollama: { baseUrl: 'http://localhost:11434/v1',                                defaultModel: 'llava'             },
  custom: { baseUrl: '',                                                         defaultModel: ''                  },
};