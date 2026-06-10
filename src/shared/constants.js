"use strict";
/**
 * src/shared/constants.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_TOKEN_COSTS = exports.SPLASH_DURATION_MS = void 0;
exports.estimateCost = estimateCost;
/**
 * Splash screen display duration in milliseconds.
 * Animation is ~1.52s, then holds for ~1.5s before dismissing.
 */
exports.SPLASH_DURATION_MS = 3000;
/**
 * Known per-provider pricing.
 *
 * 'claude', 'openai', 'gemini' use the most common/current model pricing as a
 * reasonable default. The renderer should treat these as estimates — exact cost
 * depends on the model actually selected, which may differ from this default.
 *
 * 'ollama' and 'custom' are free/unknown — both costs are 0.
 */
exports.PROVIDER_TOKEN_COSTS = {
    // claude-sonnet-4-6 pricing
    claude: { inputPerMToken: 3.00, outputPerMToken: 15.00 },
    // gpt-4o pricing
    openai: { inputPerMToken: 2.50, outputPerMToken: 10.00 },
    // gemini-1.5-pro pricing
    gemini: { inputPerMToken: 1.25, outputPerMToken: 5.00 },
    // local — no API cost
    ollama: { inputPerMToken: 0, outputPerMToken: 0 },
    // user-supplied endpoint — cost unknown
    custom: { inputPerMToken: 0, outputPerMToken: 0 },
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
function estimateCost(provider, totalInputTokens, totalOutputTokens) {
    const pricing = exports.PROVIDER_TOKEN_COSTS[provider];
    if (!pricing)
        return 0;
    const raw = (totalInputTokens / 1000000) * pricing.inputPerMToken +
        (totalOutputTokens / 1000000) * pricing.outputPerMToken;
    return Math.round(raw * 10000) / 10000;
}
//# sourceMappingURL=constants.js.map