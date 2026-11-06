# TaskPriorityBadge Dynamic Styling Refactoring

**Date**: 2025-01-25  
**Component**: `components/task/TaskPriorityBadge.vue`

## Problem Statement

The `TaskPriorityBadge` component was using hardcoded priority values to determine which CSS classes to apply:
- Priority 4 → `.priority-max` class
- Priority 3 → `.priority-high` class
- Other priorities → no special styling

This approach didn't account for user configurations where priority values might differ based on their Notion database setup or local task priorities.

## Solution Implemented

Refactored the component to **dynamically determine** the highest and second-highest priority values from the actual tasks in the store.

### Key Changes

#### 1. Dynamic Priority Detection
```typescript
const availablePriorities = computed(() => {
  const priorities = new Set<number>();
  tasksStore.tasks.forEach(task => {
    const prio = Number(task.priority);
    if (prio > 0) {
      priorities.add(prio);
    }
  });
  return Array.from(priorities).sort((a, b) => b - a);
});
```

#### 2. Max Priority Calculation
```typescript
const maxPriorityValue = computed(() => {
  if (availablePriorities.value.length > 0 && availablePriorities.value[0]) {
    return availablePriorities.value[0];
  }
  // Fallback to hardcoded value when no tasks exist
  return 4;
});
```

#### 3. High Priority Calculation
```typescript
const highPriorityValue = computed(() => {
  if (availablePriorities.value.length > 1 && availablePriorities.value[1]) {
    return availablePriorities.value[1];
  }
  // Fallback to hardcoded value when fewer than 2 priority levels exist
  return 3;
});
```

#### 4. Dynamic CSS Class Assignment
```typescript
const prioCssClass = computed(() => {
  if (priorityValue.value === maxPriorityValue.value) {
    return 'priority-max';
  }
  if (priorityValue.value === highPriorityValue.value) {
    return 'priority-high';
  }
  return '';
});
```

## Benefits

### 1. **Adaptive to User Configuration**
- Works with any priority scheme (1-4, 1-3, 1-5, etc.)
- Automatically adjusts to the priorities actually used in tasks

### 2. **Consistent Visual Hierarchy**
- The **highest** priority in use always gets the most prominent styling (`.priority-max`)
- The **second-highest** priority gets secondary styling (`.priority-high`)
- Other priorities remain unstyled, maintaining visual focus

### 3. **Backward Compatible**
- Falls back to hardcoded values (4=max, 3=high) when no tasks exist
- Maintains existing behavior for standard configurations

### 4. **Performance Optimized**
- Uses Vue computed properties for reactive updates
- Efficient Set-based deduplication
- Only recalculates when task list changes

## Example Scenarios

### Scenario 1: Standard 1-4 Priority Scale
**Tasks**: Priority 1, 2, 3, 4  
**Result**:
- Priority 4 → `.priority-max` (red styling)
- Priority 3 → `.priority-high` (warning styling)
- Priority 1, 2 → no special styling

### Scenario 2: Limited Priority Usage
**Tasks**: Only Priority 2 and 4  
**Result**:
- Priority 4 → `.priority-max` (red styling)
- Priority 2 → `.priority-high` (warning styling)

### Scenario 3: Custom Priority Range
**Tasks**: Priority 5, 6, 7, 8  
**Result**:
- Priority 8 → `.priority-max` (red styling)
- Priority 7 → `.priority-high` (warning styling)
- Priority 5, 6 → no special styling

## Technical Details

### Dependencies
- `useTasksStore()` - Access to all tasks for priority analysis
- Vue `computed()` - Reactive priority calculations

### CSS Classes
- `.priority-max` - Applied to highest priority (red/error tokens)
- `.priority-high` - Applied to second-highest priority (warning tokens)
- No class - Applied to all other priorities (neutral styling)

### Type Safety
- Proper null checks for array access
- TypeScript type guards for priority values
- Handles edge cases (no tasks, single priority level)

## Testing Recommendations

1. **Empty State**: Verify fallback behavior when no tasks exist
2. **Single Priority**: Test with tasks having only one priority level
3. **Multiple Priorities**: Verify correct max/high assignment with 3+ levels
4. **Dynamic Updates**: Confirm styling updates when tasks are added/removed
5. **Priority Changes**: Test when task priorities are modified

## Files Modified

- `/components/task/TaskPriorityBadge.vue` - Complete refactor of priority logic

## Alignment with Project Rules

✅ **02-code-style-and-language.md**: Uses Composition API, TypeScript, computed properties  
✅ **03-component-standards.md**: Maintains component responsibility, proper JSDoc  
✅ **04-store-and-state.md**: Uses store getters, no direct state mutation  
✅ **07-performance-and-dnd.md**: Efficient computed properties, no unnecessary recalculations

## Future Enhancements

### Option 1: Store Priority Options in Config
Store the available priority options from Notion database schema in `NotionConfig` during setup. This would allow:
- Direct access to configured priority names
- Better alignment with Notion property configuration
- No need to infer from existing tasks

### Option 2: Custom Priority Thresholds
Allow users to configure which priority levels should receive special styling through settings.

### Option 3: More Granular Styling
Support additional priority levels (e.g., `.priority-medium`, `.priority-low`) with configurable thresholds.
