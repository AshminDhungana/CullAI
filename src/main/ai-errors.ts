/**
 * ai-errors.ts
 *
 * Typed error classes for AI client failures.
 *
 * Kept in a separate file so Phase 10 (orchestrator) and Phase 11 (parallel
 * batch runner) can import them without pulling in all of ai-client.ts.
 *
 * Every error carries `provider` and `model` so log messages and retry
 * logic can identify exactly which endpoint failed.
 */

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * The API key was rejected (HTTP 401).
 * Non-retryable — the user must correct their key.
 */
export class AIAuthError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string, detail?: string) {
    super(
      `[${provider}/${model}] Invalid API key (401)` +
        (detail ? ` — ${detail}` : ''),
    );
    this.name = 'AIAuthError';
    this.provider = provider;
    this.model = model;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * The provider returned HTTP 429 (Too Many Requests).
 * Retryable after `retryAfter` seconds.
 */
export class AIRateLimitError extends Error {
  readonly provider: string;
  readonly model: string;
  /** Seconds to wait before retrying. Defaults to 60 if the header was absent. */
  readonly retryAfter: number;

  constructor(provider: string, model: string, retryAfter: number) {
    super(
      `[${provider}/${model}] Rate limited — retry after ${retryAfter}s`,
    );
    this.name = 'AIRateLimitError';
    this.provider = provider;
    this.model = model;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Server error
// ---------------------------------------------------------------------------

/**
 * The provider returned a 5xx status code.
 * Retryable with backoff.
 */
export class AIServerError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly statusCode: number;

  constructor(provider: string, model: string, statusCode: number, detail?: string) {
    super(
      `[${provider}/${model}] Server error ${statusCode}` +
        (detail ? ` — ${detail}` : ' — retryable'),
    );
    this.name = 'AIServerError';
    this.provider = provider;
    this.model = model;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Network timeout
// ---------------------------------------------------------------------------

/**
 * The fetch request exceeded the timeout deadline (default 30 s).
 * Retryable.
 */
export class AITimeoutError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string) {
    super(`[${provider}/${model}] Request timed out`);
    this.name = 'AITimeoutError';
    this.provider = provider;
    this.model = model;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// JSON parse failure
// ---------------------------------------------------------------------------

/**
 * The AI returned a response that could not be parsed as valid JSON,
 * or the parsed object was missing required score keys.
 *
 * `rawResponse` is attached so callers can log it for debugging without
 * surfacing sensitive data to the renderer.
 */
export class AIParseError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly rawResponse: string;

  constructor(provider: string, model: string, rawResponse: string, reason?: string) {
    super(
      `[${provider}/${model}] Failed to parse AI response as JSON` +
        (reason ? `: ${reason}` : ''),
    );
    this.name = 'AIParseError';
    this.provider = provider;
    this.model = model;
    this.rawResponse = rawResponse;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// CullAI General Errors
// ---------------------------------------------------------------------------

/**
 * General application error carrying a machine-readable code
 * and whether the error can be recovered from.
 */
export class CullAIError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = false) {
    super(message);
    this.name = 'CullAIError';
    this.code = code;
    this.recoverable = recoverable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}