import type { GenrePreset, ScoringWeights } from './types';
/**
 * Pre-configured scoring weights for each shoot genre.
 * All six values in every preset sum to exactly 100.
 */
export declare const GENRE_PRESETS: Record<GenrePreset, ScoringWeights>;
