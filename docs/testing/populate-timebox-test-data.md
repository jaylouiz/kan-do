# Populate Timebox Suggestion Test Data

## Problem
The timebox suggestion feature requires historic task completion data to work. If you have no completed tasks in your statistics store, no suggestions will appear.

## Solution: Add Test Data

### Option 1: Use Built-in Mock Data Generator

Open the browser console and run:

```javascript
const statisticsStore = useTaskStatisticsStore();
statisticsStore.addMockData();
```

This will add 30 days of realistic mock task completion data.

### Option 2: Add Specific Test Data

For testing the exact scenario from your screenshot ("Design anpassen" with activity "Programmieren"):

```javascript
const statisticsStore = useTaskStatisticsStore();

// Add realistic programming/design tasks
const testRecords = [
  {
    taskId: 'test-1',
    title: 'UI Design anpassen',
    completedAt: new Date(),
    timeBoxSeconds: 2700,
    actualTimeSpentSeconds: 3000, // 50 min
    estimationAccuracy: 111,
    activity: 'Programmieren',
    topic: 'Frontend',
    topicColorCode: '#3b82f6',
    isUnplanned: false,
  },
  {
    taskId: 'test-2',
    title: 'Design überarbeiten',
    completedAt: new Date(),
    timeBoxSeconds: 1800,
    actualTimeSpentSeconds: 2400, // 40 min
    estimationAccuracy: 133,
    activity: 'Programmieren',
    topic: 'UI/UX',
    topicColorCode: '#10b981',
    isUnplanned: false,
  },
  {
    taskId: 'test-3',
    title: 'Layout anpassen',
    completedAt: new Date(),
    timeBoxSeconds: 1500,
    actualTimeSpentSeconds: 1800, // 30 min
    estimationAccuracy: 120,
    activity: 'Programmieren',
    topic: 'Frontend',
    topicColorCode: '#3b82f6',
    isUnplanned: false,
  },
  {
    taskId: 'test-4',
    title: 'Komponente erstellen',
    completedAt: new Date(),
    timeBoxSeconds: 3600,
    actualTimeSpentSeconds: 4200, // 70 min
    estimationAccuracy: 117,
    activity: 'Programmieren',
    topic: 'Backend',
    topicColorCode: '#ef4444',
    isUnplanned: false,
  },
];

testRecords.forEach(record => {
  statisticsStore.completionRecords.push(record);
});

console.log('Added test data. Total records:', statisticsStore.completionRecords.length);
```

### Option 3: Complete Some Real Tasks

1. Create a task with activity and topic
2. Move it through your workflow to "Done"
3. The task will automatically be recorded in statistics
4. Future similar tasks will get suggestions

## Verify Data Exists

Check if you have any completion records:

```javascript
const statisticsStore = useTaskStatisticsStore();
console.log('Total completion records:', statisticsStore.completionRecords.length);
console.log('Records:', statisticsStore.completionRecords);
```

## Debug Suggestion Calculation

Test the suggestion algorithm directly:

```javascript
const { calculateSuggestion } = useTimeboxSuggestion();

const result = calculateSuggestion(
  'Design anpassen',      // title
  'Programmieren',        // activity
  null                    // topic (optional)
);

console.log('Suggestion result:', result);
```

Expected output if data exists:
```json
{
  "suggestedMinutes": 40,
  "confidence": "medium",
  "matchCount": 3,
  "matchDescription": "Basierend auf 3 ähnlichen Aufgaben mit \"Programmieren\"",
  "similarTasks": [...]
}
```

## Clear Test Data

To start fresh:

```javascript
const statisticsStore = useTaskStatisticsStore();
statisticsStore.clearAllRecords();
console.log('Cleared all records');
```

## Expected Behavior

After adding test data:

1. Open the task creation form
2. Enter title: "Design anpassen"
3. Select activity: "Programmieren"
4. **You should see a suggestion button appear** below the Timebox input
5. The button shows: "💡 Vorschlag: 40 Min (basierend auf 3 ähnlichen Aufgaben mit 'Programmieren')"
6. Click the button to apply the suggestion

## Troubleshooting

### No suggestion appears

Check the browser console for debug logs:
```
[TimeboxSuggestion] Calculation triggered: { title, activity, topic, suggestion, ... }
[TimeboxSuggestion] Show suggestion? true/false
```

Common issues:
- **No historic data**: Add test data using methods above
- **Title too short**: Must be ≥3 characters
- **Manual timebox entered**: Suggestion hides when you manually enter a value
- **Editing existing task**: Suggestions don't show for tasks that already have a timebox
- **Low similarity**: No tasks match well enough (threshold is 30%)

### Suggestion shows wrong value

The algorithm uses **actual time spent**, not the original timebox estimate. This is intentional - it learns from reality, not estimates.

### Want different suggestions

Adjust the test data to match your typical work patterns. The algorithm will suggest based on:
1. **Title similarity** (word overlap)
2. **Activity match** (3.0x boost)
3. **Topic match** (1.5x boost)
4. **Combined match** (4.5x boost for both)
