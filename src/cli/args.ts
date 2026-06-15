/**
 * src/cli/args.ts
 *
 * CLI argument parser for Phase 19 — Headless CLI Mode.
 *
 * Uses Commander to parse CLI arguments and convert them into an
 * intermediate CLIArgs object. The runner in runner.ts will then map
 * CLIArgs → AppSettings.
 */

import { Command } from 'commander';
import type { AIProvider } from '../shared/types';
import { PROVIDER_DEFAULTS } from '../shared/constants';
import { GENRE_PRESETS } from '../shared/genre-presets';

// ---------------------------------------------------------------------------
// CLI argument types
// ---------------------------------------------------------------------------

export interface CLIArgs {
  input: string;
  output: string;
  count: number;
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  weights?: string;
  noXmp: boolean;
  dryRun: boolean;
  verbose: boolean;
  headless: boolean;
  benchmark: boolean;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('cullai')
  .description('AI-powered photo culling — headless CLI mode')
  .version('1.0.0')
  .option('-i, --input <path>', 'Input folder containing images (required)')
  .option('-o, --output <path>', 'Output folder for results (defaults to a subfolder of input)')
  .option('-c, --count <n>', 'Number of images to select (default: 20, 0 = all S-tier)', '20')
  .option('-p, --provider <name>', 'AI provider: claude | openai | gemini | ollama | custom (default: claude)', 'claude')
  .option('-k, --api-key <key>', 'API key for the selected provider (optional — falls back to secure storage)')
  .option('-m, --model <name>', 'Model name (optional — defaults per provider)')
  .option('-w, --weights <csv>', 'Scoring weights as "q,a,c,s,e,f" (default: general preset)')
  .option('--no-xmp', 'Skip XMP sidecar generation (default: enabled in CLI)', false)
  .option('--dry-run', 'Estimate cost and show plan without calling the AI', false)
  .option('-v, --verbose', 'Print verbose output including cost per image', false)
  .option('--headless', 'Launch in headless mode without a GUI window (set by Electron entry wrapper)', false)
  .option('--benchmark', 'Run benchmark mode on a fixed set of fixture images', false);

export function parseCLIArgs(argv: string[]): CLIArgs {
  program.parse(argv);
  const opts = program.opts<Record<string, unknown>>();

  const provider = (opts.provider as string) ?? 'claude';

  // Validate provider
  const validProviders: readonly string[] = ['claude', 'openai', 'gemini', 'ollama', 'custom'];
  if (!validProviders.includes(provider)) {
    console.error(`Error: Invalid provider "${provider}". Must be one of: ${validProviders.join(', ')}`);
    process.exit(2);
  }

  // Validate --input is provided
  const input = opts.input as string | undefined;
  if (!input) {
    console.error('Error: --input is required. Run with --help for usage.');
    process.exit(2);
  }

  // Compute output default (a .cullai_results subfolder inside input)
  const output = (opts.output as string | undefined) ?? '';

  // Validate weights format if provided
  if (opts.weights && typeof opts.weights === 'string') {
    const parts = opts.weights.split(',').map((s) => s.trim());
    if (parts.length !== 6 || parts.some((s) => isNaN(Number(s)))) {
      console.error('Error: --weights must be 6 comma-separated numbers, e.g. "25,20,15,15,10,15"');
      process.exit(2);
    }
 }
       // Validate count is a non-negative integer
       const countStr = opts.count as string | undefined;
       const count = countStr ? parseInt(countStr, 10) : 20;
  if (isNaN(count) || count < 0) {
    console.error('Error: --count must be a non-negative integer');
    process.exit(2);
  }

  return {
    input,
    output,
    count,
    provider: provider as AIProvider,
    apiKey: opts.apiKey ? String(opts.apiKey) : undefined,
    model: opts.model ? String(opts.model) : undefined,
    weights: opts.weights ? String(opts.weights) : undefined,
    noXmp: Boolean(opts.noXmp),
    dryRun: Boolean(opts.dryRun),
    verbose: Boolean(opts.verbose),
    headless: Boolean(opts.headless),
    benchmark: Boolean(opts.benchmark),
  };
}
