# Timebox Auto-Suggestion Feature

## Overview

Intelligent timebox suggestion system that learns from historic task data to provide contextual time estimates when creating new tasks.

## Goals

- Reduce cognitive load during task creation
- Improve estimation accuracy over time through machine learning from actual data
- Emphasize activity-based suggestions (context-aware)
- Make suggestions non-intrusive and optional

## Data Sources

### Historic Task Data (taskStatistics Store)

```typescript
interface TaskCompletionRecord {
  taskId: string;
  title: string;
  completedAt: Date;
  timeBoxSeconds: number | null;      // Original estimate
  actualTimeSpentSeconds: number;     // Actual time (ground truth)
  activity: string | null;             // Activity (high priority signal)
  topic: string | null;                // Topic/category
  topicColorCode: string | null;
  isUnplanned: boolean;
}
```

### Input Context (TaskForm)

- `title`: Task title (min 3 chars for suggestion)
- `activity`: Selected activity/topic (high priority signal)
- `notes`: Optional description

## Heuristic Algorithm

### 1. Similarity Scoring

#### Dual-Factor Matching

The algorithm uses **both activity and topic** for matching, with different weights:

- **Activity Match (Primary)**: 3.0x multiplier
  - Exact match on `activity` field
  - Highest priority signal for time estimation
  - Example: "reporting" tasks have similar durations

- **Topic Match (Secondary)**: 1.5x multiplier
  - Exact match on `topic` field
  - Provides context refinement
  - Example: "Projekt A" vs "Projekt B" may have different complexities

- **Combined Match (Best Case)**: 4.5x multiplier (3.0 × 1.5)
  - Both activity AND topic match
  - Most accurate predictions
  - Example: "reporting" in "Projekt A" matches other "reporting" tasks in "Projekt A"

#### Title Similarity

- **Exact match**: 100% similarity
- **Word overlap**: Jaccard similarity coefficient

  ```text
  similarity = (common_words) / (total_unique_words)
  ```

- **Keywords extraction**: Remove common stop words (der, die, das, und, etc.)

#### Composite Score

```text
multiplier = 1.0
if (activity_match) multiplier *= 3.0
if (topic_match) multiplier *= 1.5
final_score = title_similarity * multiplier
```

**Example Scenarios:**

| Title Match | Activity | Topic | Multiplier | Priority |
|-------------|----------|-------|------------|----------|
| 80% | ✓ | ✓ | 4.5x | Highest |
| 80% | ✓ | ✗ | 3.0x | High |
| 80% | ✗ | ✓ | 1.5x | Medium |
| 80% | ✗ | ✗ | 1.0x | Low |

### 2. Time Calculation Strategy

#### Data Selection

1. Filter records with `final_score >= 0.3` (30% similarity threshold)
2. Sort by score descending
3. Take top N records (max 10)

#### Time Aggregation

Use **weighted median** of `actualTimeSpentSeconds` (not `timeBoxSeconds`):

- Actual time spent is ground truth (more accurate than estimates)
- Weighted by similarity score
- Median (not mean) to reduce outlier impact

#### Rounding

Round to nearest **5-minute increment** for usability:

```
suggested_minutes = Math.round(median_seconds / 60 / 5) * 5
```

### 3. Suggestion Trigger

#### When to Show

- Title length >= 3 characters OR
- Activity is selected

#### When to Hide

- No similar tasks found (score < threshold)
- User manually enters a timebox value
- User clicks suggestion (suggestion applied and removed)

### 4. Confidence Indicator

Display confidence based on:

- Number of similar tasks found
- Average similarity score
- Variance in time spent across matches

```typescript
interface TimeboxSuggestion {
  suggestedMinutes: number;
  confidence: 'low' | 'medium' | 'high';
  matchCount: number;
  matchDescription: string; // e.g., "basierend auf 5 ähnlichen Aufgaben"
}
```

## User Interface

### Location

Below the timebox input field in TaskForm.vue

### Visual Design

```
┌─────────────────────────────────┐
│ Timebox                          │
│ ┌─────────────────────────────┐ │
│ │ [Input: _____] Minuten      │ │
│ └─────────────────────────────┘ │
│                                  │
│ ┌─────────────────────────────┐ │
│ │ 💡 Vorschlag: 30 Min        │ │ ← Clickable button
│ │ (basierend auf 3 ähnlichen  │ │
│ │  Aufgaben mit "Backend")    │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### Behavior

1. **Initial state**: Suggestion hidden
2. **On title/activity change**: Calculate and show suggestion (if available)
3. **On suggestion click**:
   - Set timebox input to suggested value
   - Remove suggestion element
4. **On manual input**: Hide suggestion
5. **On form reset**: Re-show suggestion if applicable

### German UI Strings

- Button label: `"Vorschlag: {X} Min"`
- Description patterns:
  - With activity: `"basierend auf {N} ähnlichen Aufgaben mit \"{activity}\""`
  - Without activity: `"basierend auf {N} ähnlichen Aufgaben"`
  - High confidence: `"✓ Basierend auf {N} sehr ähnlichen Aufgaben"`

## Implementation Architecture

### Files to Create/Modify

#### 1. Type Definition

`types/timeboxSuggestion.ts`

```typescript
export interface TimeboxSuggestion {
  suggestedMinutes: number;
  confidence: 'low' | 'medium' | 'high';
  matchCount: number;
  matchDescription: string;
  similarTasks: Array<{
    title: string;
    topic: string | null;
    actualMinutes: number;
    similarityScore: number;
  }>;
}
```

#### 2. Composable

`composables/useTimeboxSuggestion.ts`

- `calculateSuggestion(title: string, activity: string | null): TimeboxSuggestion | null`
- Helper functions for similarity, filtering, aggregation

#### 3. Component Update

`components/task/TaskForm.vue`

- Import composable
- Add suggestion state and watchers
- Render suggestion button
- Handle click to apply suggestion

## Edge Cases & Considerations

### Data Quality

- **No historic data**: No suggestion shown
- **Insufficient similarity**: Threshold prevents poor suggestions
- **Outliers**: Median aggregation handles extreme values

### Privacy & Performance

- All data is local (localStorage)
- Computation runs client-side
- Debounce title input (300ms) to reduce calculations

### Progressive Disclosure

- Start simple: Basic title + activity matching
- Future enhancements:
  - Natural language processing for better title similarity
  - Time-of-day patterns
  - User-specific learning curves
  - Integration with external AI services (optional)

## Testing Strategy

### Unit Tests

- Similarity scoring algorithm
- Time aggregation logic
- Edge cases (empty data, single match, exact duplicates)

### Integration Tests

- Composable with real taskStatistics data
- UI interaction (show, hide, apply)

### User Acceptance

- A/B test: suggestion adoption rate
- Track: estimated vs actual time (does suggestion improve accuracy?)

## Future Enhancements

### Phase 2

- Learn from user behavior (which suggestions are accepted/rejected)
- Contextual factors: day of week, time of day
- Machine learning model (optional, client-side TensorFlow.js)

### Phase 3

- Sentiment analysis of task titles (complexity indicators)
- Integration with calendar for realistic availability checks
- Team-level learning (aggregate anonymized data)

## Success Metrics

1. **Adoption rate**: % of tasks where suggestion is used
2. **Accuracy improvement**: Reduce gap between estimated and actual time
3. **User satisfaction**: Qualitative feedback
4. **Time saved**: Reduce task creation friction
