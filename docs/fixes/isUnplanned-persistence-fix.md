# Fix: isUnplanned Flag Persistence Issue

## Problem
The `isUnplanned` flag was being lost on page reload or sync operations when using Notion integration. Users would create ad-hoc tasks with `isUnplanned: true`, but after reloading the page or syncing with Notion, the flag would be reset to `false`.

## Root Cause
The `isUnplanned` flag was **never being written to Notion** during task creation or updates:

1. **Task Creation** (`createTask` in `NotionIntegration.ts`): 
   - Wrote many properties (title, status, priority, timeBox, topic, activity, custom properties)
   - ❌ **Missing**: Call to write `isUnplanned` flag

2. **Task Updates** (`updateTask` in `NotionIntegration.ts`):
   - Updated status, timeSpent, completedDate
   - ❌ **Missing**: Call to write `isUnplanned` flag

3. **Task Reading** (`getActiveBoardTasks`):
   - ✅ Correctly read the unplanned flag via `extractUnplannedFlag()` method
   - Used configured mapping (boolean checkbox or value-based matching)

### Flow Breakdown
```
1. Ad-hoc task created → isUnplanned = true set locally ✅
2. Saved to Notion → unplanned property NOT written ❌
3. Returned to store → isUnplanned still true (from input echo) ✅
4. Page reload/sync → fetches from Notion → property doesn't exist → returns false ❌
5. Flag lost ❌
```

## Solution Implemented

### Changes Made
**File**: `/integrations/NotionIntegration.ts`

1. **Added method calls** to write unplanned flag:
   - In `createTask()` method: Added `this.writeUnplannedFlag(properties, task.isUnplanned ?? false);`
   - In `updateTask()` method: Added `this.writeUnplannedFlag(properties, task.isUnplanned ?? false);`

2. **Existing helper method**: `writeUnplannedFlag()` was already implemented (lines 484-509)
   - Supports two modes:
     - **Boolean mode**: Writes directly to a checkbox property
     - **Value mode**: Sets a specific value in select/multi_select property

### Code Changes

```typescript
// In createTask() - Line 428
// Add unplanned flag if configured and set
this.writeUnplannedFlag(properties, task.isUnplanned ?? false);

// In updateTask() - Line 619
// Add unplanned flag if configured
this.writeUnplannedFlag(properties, task.isUnplanned ?? false);
```

### writeUnplannedFlag Method
The method already existed and handles both mapping modes:

```typescript
private writeUnplannedFlag(properties: Record<string, any>, isUnplanned: boolean): void {
  const mapping = this.propertyMapping.unplanned;
  
  // No mapping configured: nothing to write
  if (!mapping) return;

  if (mapping.mode === 'boolean' && mapping.propertyName) {
    // Boolean mode: write checkbox property
    properties[mapping.propertyName] = {
      checkbox: isUnplanned,
    };
  } else if (mapping.mode === 'value' && mapping.valuePropertyName && mapping.matchValue) {
    // Value mode: set the match value for select/multi_select
    if (isUnplanned) {
      properties[mapping.valuePropertyName] = {
        select: { name: mapping.matchValue },
      };
    }
    // When false, we don't clear it as it may have other values
  }
}
```

## User Configuration

Users can configure the unplanned mapping in the Notion setup wizard (PropertyMapper component):

### Configuration Options
1. **No mapping**: All tasks treated as planned
2. **Boolean mode**: Use a Notion checkbox property
   - Select a checkbox field from the database
   - Checkbox checked = unplanned task
3. **Value mode**: Match a specific value in a select/multi_select property
   - Select a property (select, multi_select, or text field)
   - Define a value to match (e.g., "Ungeplant", "Ad-hoc", etc.)
   - Tasks with this value = unplanned

### UI Location
`components/notion/setup/mapping/PropertyMapper.vue` - "Ungeplant" section

## Expected Behavior After Fix

### Ad-hoc Task Creation Flow
1. User creates ad-hoc task via `/tasks/add?mode=adhoc`
2. Task is created with `isUnplanned: true`
3. Task is saved to Notion with unplanned property written ✅
4. Task appears in local store with flag preserved ✅
5. Page reload/sync fetches from Notion → reads unplanned property ✅
6. Flag remains true after reload ✅

### Regular Task Update Flow
1. User updates a task (status, time spent, etc.)
2. Task is synced to Notion
3. Unplanned flag is preserved in Notion ✅
4. Page reload maintains correct unplanned state ✅

## Testing

### Manual Testing Steps
1. **Configure unplanned mapping** in Notion setup:
   - Go to settings → Configure Notion integration
   - In PropertyMapper, set up unplanned mapping (boolean or value mode)
   - Save configuration

2. **Create ad-hoc task**:
   - Navigate to `/tasks/add?mode=adhoc`
   - Create a task
   - Verify `isUnplanned: true` in task details

3. **Verify persistence**:
   - Reload page → flag should remain true
   - Force sync with Notion → flag should remain true
   - Check Notion database → property should be set correctly

4. **Create planned task**:
   - Navigate to `/tasks/add` (without adhoc mode)
   - Create a task
   - Verify `isUnplanned: false` in task details
   - Reload page → flag should remain false

### Expected Results
- ✅ Ad-hoc tasks maintain `isUnplanned: true` across reloads
- ✅ Planned tasks maintain `isUnplanned: false` across reloads
- ✅ Notion database reflects correct unplanned state
- ✅ No data loss during sync operations

## Related Files
- `/integrations/NotionIntegration.ts` - Main integration logic
- `/types/task.ts` - Task type definition with `isUnplanned` property
- `/types/notion.ts` - Notion property mapping configuration
- `/components/notion/setup/mapping/PropertyMapper.vue` - UI for configuring mapping
- `/pages/tasks/add.vue` - Task creation page (sets isUnplanned for ad-hoc mode)

## Build Status
✅ Build successful (npm run build completed without errors)

## Alignment with Architecture Rules
- Follows `05-integrations-and-sync.md`: Proper bidirectional sync with Notion
- Follows `02-code-style-and-language.md`: Added German UI labels, proper TypeScript
- Follows `04-store-and-state.md`: No changes to store structure needed
- Follows `06-error-handling-and-recovery.md`: Existing error handling maintained

## Notes
- The `writeUnplannedFlag` method was already implemented but never called
- This was likely an oversight during initial unplanned feature implementation
- The fix is minimal and non-breaking: only adds two method calls
- Backward compatible: works whether unplanned mapping is configured or not
