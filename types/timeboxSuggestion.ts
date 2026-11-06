/**
 * Confidence level for timebox suggestions
 */
export type SuggestionConfidence = 'low' | 'medium' | 'high';

/**
 * Similar task match used in suggestion calculation
 */
export interface SimilarTaskMatch {
  /** Original task title */
  title: string;
  /** Task activity (primary matching factor) */
  activity: string | null;
  /** Task topic (secondary matching factor) */
  topic: string | null;
  /** Actual time spent in minutes */
  actualMinutes: number;
  /** Similarity score (0-1) */
  similarityScore: number;
}

/**
 * Timebox suggestion result
 */
export interface TimeboxSuggestion {
  /** Suggested timebox in minutes */
  suggestedMinutes: number;
  /** Confidence level based on match quality and count */
  confidence: SuggestionConfidence;
  /** Number of similar tasks found */
  matchCount: number;
  /** Human-readable description in German */
  matchDescription: string;
  /** Similar tasks used for calculation (for debugging/transparency) */
  similarTasks: SimilarTaskMatch[];
}
