/**
 * src/shared/constants.ts
 */
/**
 * Splash screen display duration in milliseconds.
 * Animation is ~1.52s, then holds for ~1.5s before dismissing.
 */
export declare const SPLASH_DURATION_MS = 3000;
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
export declare const PROVIDER_TOKEN_COSTS: Record<string, ProviderTokenCost>;
/**
 * Computes estimated USD cost from cumulative token counts.
 *
 * @param provider         AIProvider string key.
 * @param totalInputTokens  Cumulative input tokens so far.
 * @param totalOutputTokens Cumulative output tokens so far.
 * @returns Estimated cost in USD, rounded to 4 decimal places.
 *          Returns 0 for unknown providers or zero-cost providers (ollama, custom).
 */
export declare function estimateCost(provider: string, totalInputTokens: number, totalOutputTokens: number): number;
