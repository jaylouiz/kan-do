import { computed, type Ref } from 'vue';
import { useTaskStatisticsStore } from '~/store/taskStatistics';
import { translate } from '~/lib/i18n';
import type { TimeboxSuggestion, SimilarTaskMatch, SuggestionConfidence } from '~/types/timeboxSuggestion';
import type { TaskCompletionRecord } from '~/store/taskStatistics';

/**
 * German stop words to exclude from title similarity matching
 */
const GERMAN_STOP_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
  'und', 'oder', 'aber', 'doch', 'jedoch',
  'für', 'von', 'mit', 'zu', 'an', 'auf', 'in', 'bei',
  'ist', 'sind', 'war', 'waren', 'wird', 'werden',
  'hat', 'haben', 'hatte', 'hatten',
]);

/**
 * Configuration constants for suggestion algorithm
 */
const CONFIG = {
  /** Minimum similarity score to consider a task as relevant */
  MIN_SIMILARITY_THRESHOLD: 0.3,
  /** Multiplier for tasks with matching activity (primary factor) */
  ACTIVITY_MATCH_MULTIPLIER: 3.0,
  /** Multiplier for tasks with matching topic (secondary factor) */
  TOPIC_MATCH_MULTIPLIER: 1.5,
  /** Maximum number of similar tasks to consider */
  MAX_SIMILAR_TASKS: 10,
  /** Minimum title length to trigger suggestions */
  MIN_TITLE_LENGTH: 3,
  /** Round suggested time to this many minutes */
  TIME_ROUNDING_MINUTES: 5,
  /** Minimum matches for high confidence */
  HIGH_CONFIDENCE_MIN_MATCHES: 5,
  /** Minimum matches for medium confidence */
  MEDIUM_CONFIDENCE_MIN_MATCHES: 2,
};

/**
 * Composable for generating intelligent timebox suggestions based on historic task data
 */
export const useTimeboxSuggestion = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const statisticsStore = useTaskStatisticsStore();

  /**
   * Normalize and tokenize a string for similarity comparison
   */
  function normalizeAndTokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .trim()
        // Remove special characters but keep umlauts
        .replace(/[^\wäöüß\s-]/gi, '')
        // Split on whitespace and hyphens
        .split(/[\s-]+/)
        // Filter out stop words and empty strings
        .filter(word => word.length > 0 && !GERMAN_STOP_WORDS.has(word))
    );
  }

  /**
   * Calculate Jaccard similarity coefficient between two token sets
   * Returns value between 0 (no overlap) and 1 (identical)
   */
  function calculateJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0;
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Calculate similarity score between input and a historic task
   * Uses dual-factor scoring: activity (primary) + topic (secondary)
   */
  function calculateSimilarityScore(
    inputTitle: string,
    inputActivity: string | null,
    inputTopic: string | null,
    record: TaskCompletionRecord
  ): number {
    // Tokenize titles
    const inputTokens = normalizeAndTokenize(inputTitle);
    const recordTokens = normalizeAndTokenize(record.title);
    
    // Calculate title similarity
    let titleSimilarity = calculateJaccardSimilarity(inputTokens, recordTokens);
    
    // Boost for exact match
    if (inputTitle.toLowerCase().trim() === record.title.toLowerCase().trim()) {
      titleSimilarity = 1.0;
    }
    
    // Check activity match (primary factor)
    const activityMatch = inputActivity && 
                         record.activity && 
                         inputActivity.toLowerCase().trim() === record.activity.toLowerCase().trim();
    
    // Check topic match (secondary factor)
    const topicMatch = inputTopic && 
                      record.topic && 
                      inputTopic.toLowerCase().trim() === record.topic.toLowerCase().trim();
    
    // Apply multipliers:
    // - Activity match: 3.0x (primary)
    // - Topic match: 1.5x (secondary)
    // - Both match: 3.0x * 1.5x = 4.5x (best case)
    let multiplier = 1.0;
    if (activityMatch) {
      multiplier *= CONFIG.ACTIVITY_MATCH_MULTIPLIER;
    }
    if (topicMatch) {
      multiplier *= CONFIG.TOPIC_MATCH_MULTIPLIER;
    }
    
    const finalScore = titleSimilarity * multiplier;
    
    return Math.min(finalScore, 1.0); // Cap at 1.0 for normalized scores
  }

  /**
   * Calculate weighted median of time values
   */
  function calculateWeightedMedian(matches: Array<{ minutes: number; weight: number }>): number {
    if (matches.length === 0) return 0;
    
    // Sort by minutes
    const sorted = [...matches].sort((a, b) => a.minutes - b.minutes);
    
    // Calculate total weight
    const totalWeight = sorted.reduce((sum, m) => sum + m.weight, 0);
    
    // Find weighted median
    let cumulativeWeight = 0;
    const halfWeight = totalWeight / 2;
    
    for (const match of sorted) {
      cumulativeWeight += match.weight;
      if (cumulativeWeight >= halfWeight) {
        return match.minutes;
      }
    }
    
    // Fallback to last item (shouldn't reach here)
    const lastItem = sorted[sorted.length - 1];
    return lastItem?.minutes ?? 0;
  }

  /**
   * Determine confidence level based on match count and average similarity
   */
  function determineConfidence(matchCount: number, avgSimilarity: number): SuggestionConfidence {
    if (matchCount >= CONFIG.HIGH_CONFIDENCE_MIN_MATCHES && avgSimilarity >= 0.6) {
      return 'high';
    } else if (matchCount >= CONFIG.MEDIUM_CONFIDENCE_MIN_MATCHES && avgSimilarity >= 0.4) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Generate human-readable description of the suggestion
   */
  function generateDescription(
    matchCount: number,
    activity: string | null,
    confidence: SuggestionConfidence
  ): string {
    const prefix = confidence === 'high' ? '✓ ' : '';
    if (activity) {
      return prefix + translate('task.timeboxBasedOnSimilarWithActivity', { n: matchCount, activity }, matchCount);
    }

    return prefix + translate('task.timeboxBasedOnSimilar', { n: matchCount }, matchCount);
  }

  /**
   * Calculate timebox suggestion based on title, activity, and topic
   * 
   * @param title - Task title (min 3 characters)
   * @param activity - Optional activity for context (primary factor)
   * @param topic - Optional topic for context (secondary factor)
   * @returns Suggestion object or null if no suitable matches found
   */
  function calculateSuggestion(
    title: string,
    activity: string | null = null,
    topic: string | null = null
  ): TimeboxSuggestion | null {
    // Validate input
    if (!title || title.trim().length < CONFIG.MIN_TITLE_LENGTH) {
      return null;
    }
    
    // Get all completion records
    const records = statisticsStore.completionRecords;
    
    if (records.length === 0) {
      return null;
    }
    
    // Calculate similarity scores for all records
    const scoredRecords = records
      .map(record => ({
        record,
        score: calculateSimilarityScore(title, activity, topic, record),
      }))
      .filter(item => item.score >= CONFIG.MIN_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFIG.MAX_SIMILAR_TASKS);
    
    // No suitable matches found
    if (scoredRecords.length === 0) {
      return null;
    }
    
    // Build similar task matches (store both activity and topic)
    const similarTasks: SimilarTaskMatch[] = scoredRecords.map(item => ({
      title: item.record.title,
      activity: item.record.activity,
      topic: item.record.topic,
      actualMinutes: Math.round(item.record.actualTimeSpentSeconds / 60),
      similarityScore: item.score,
    }));
    
    // Calculate weighted median of actual time spent
    const weightedData = scoredRecords.map(item => ({
      minutes: item.record.actualTimeSpentSeconds / 60,
      weight: item.score,
    }));
    
    const medianMinutes = calculateWeightedMedian(weightedData);
    
    // Round to nearest interval
    const roundedMinutes = Math.max(
      CONFIG.TIME_ROUNDING_MINUTES,
      Math.round(medianMinutes / CONFIG.TIME_ROUNDING_MINUTES) * CONFIG.TIME_ROUNDING_MINUTES
    );
    
    // Calculate average similarity for confidence
    const avgSimilarity = scoredRecords.reduce((sum, item) => sum + item.score, 0) / scoredRecords.length;
    
    // Determine confidence
    const confidence = determineConfidence(scoredRecords.length, avgSimilarity);
    
    // Generate description
    const description = generateDescription(scoredRecords.length, activity, confidence);
    
    return {
      suggestedMinutes: roundedMinutes,
      confidence,
      matchCount: scoredRecords.length,
      matchDescription: description,
      similarTasks,
    };
  }

  /**
   * Reactive suggestion computation
   * 
   * @param title - Ref to title input
   * @param activity - Ref to activity input
   * @param topic - Ref to topic input
   * @returns Computed suggestion that updates when inputs change
   */
  function useSuggestion(
    title: Ref<string>,
    activity: Ref<string | null>,
    topic: Ref<string | null>
  ): Ref<TimeboxSuggestion | null> {
    return computed(() => calculateSuggestion(title.value, activity.value, topic.value));
  }

  return {
    calculateSuggestion,
    useSuggestion,
  };
};
