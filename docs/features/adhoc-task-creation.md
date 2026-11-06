# Ad-hoc Task Creation Feature

> **Updated 2026-10-23 (#125).** The flow (local timer, `isUnplanned`, status Progress, elapsed time kept) still applies, but the UI described under "Technical Implementation" and "Ghost-like Styling" is superseded: the entry point is now the Jetzt add slot (`components/board/AddTaskSlot.vue`, "Neue Aufgabe sofort starten"), which morphs into a draft card showing the running time. The word "Ad-hoc" no longer appears in the UI; "ad-hoc" stays the internal name (`?mode=adhoc`). The current design is DESIGN.md → Components → "Add task".

## Overview
Quick task creation feature for handling unplanned work that emerges during the day. Allows users to immediately start tracking time on reactive tasks without losing seconds during form filling.

## User Flow

### 1. Discovery
- Jetzt is empty (WIP 1: an occupied Jetzt has no add control)
- Pointer: hovering the Jetzt section (heading and slot) or focusing the slot reveals a card-sized slot with `i-ph-lightning` and "Neue Aufgabe sofort starten"
- Touch (`hover: none`): the label is visible at rest

### 2. Creation
- User clicks the slot → navigates to `/tasks/add?mode=adhoc`
- The slot morphs into a regular-size draft card in Jetzt that shows the running time (never stored or synced)
- Sheet opens with:
  - Title: "Neue Aufgabe sofort starten"
  - Submit button: "Starten" (instead of "Aufgabe erstellen")
  - Title input auto-focused
  - **Local timer starts immediately** (no waiting for save)

### 3. Form Filling
- User types title (required)
- Optionally adds other fields (notes, priority, timebox, etc.)
- Timer continues running in background
- Elapsed time tracked in component state

### 4. Task Start
- User submits form
- Task created with:
  - `status: Progress`
  - `isUnplanned: true`
  - `timeSpentSeconds: <elapsed time from form opening>`
- The task is created in Jetzt, so the app-level timer driver starts its timer at once (`useTaskTimerDriver`, #352)
- Toast shows: "Aufgabe gestartet"
- The draft becomes the Jetzt card, a regular card (#394); focus moves to it
- If Jetzt filled up while the form was open (e.g. a sync), the shared WIP rule (`checkWipMove`) refuses the start: the task is saved to Offen with its elapsed time and the WIP refusal toast shows. The rule is asked again after the (possibly slow) save: if Jetzt filled meanwhile, the new task moves to Offen with its time, without a timer
- Cancel (Abbrechen, Escape, overlay click, swipe down) fades the draft back into the slot and discards the elapsed time

### 5. Validation
- Tasks can be dropped to Done column only if they have a title
- If validation fails:
  - Toast shows: "Aufgabe nicht vollständig" with reason
  - Drag operation reverts
  - Task returns to original column

## Technical Implementation

### Components Created
- **`AdHocTaskButton.vue`**: Hover-triggered button with ghost styling
  - Props: `show` (boolean)
  - Emits: `click` event
  - Styling matches drag ghost (darker neutral, semi-transparent)

### Components Modified
- **`BoardColumn.vue`**:
  - Added `showAdHocButton` state (hover-triggered)
  - Added `openAdHocTaskCreation()` handler
  - Renders `<ad-hoc-task-button>` when Progress column is empty
  - Mouse enter/leave handlers on task list

- **`TaskForm.vue`**:
  - New props: `autoFocus`, `isUnplanned`
  - `titleInputRef` for programmatic focus
  - `onMounted` hook focuses input when `autoFocus=true`
  - Includes `isUnplanned` in submitted task data
  - Imports: Added `nextTick` for focus delay

- **`pages/tasks/add.vue`**:
  - Detects ad-hoc mode via `route.query.mode === 'adhoc'`
  - Local timer: `elapsedSeconds` increments every second
  - `onMounted`: Starts interval timer in ad-hoc mode
  - `onUnmounted`: Cleans up timer
  - `handleSave`: 
    - Stops local timer
    - Sets `status: Progress` and `timeSpentSeconds: elapsedSeconds`
    - Returns task ID from save functions
    - Starts no timer itself: the driver times every task in Jetzt (#352)
  - Updated save functions to return task ID

- **`Board.vue`**:
  - New function: `validateTaskForCompletion(taskId)`
  - Modified `handleOnAdd()`: Validates before allowing drop to Done
  - Reverts drag if validation fails (moves element back to origin)
  - Shows error toast with reason

### Data Flow
```
1. Hover Jetzt section → reveal slot
2. Click → Navigate /tasks/add?mode=adhoc, start a Progress draft (useTaskDraft)
3. Mount → Start local timer (setInterval)
4. Type → elapsedSeconds++ (mirrored into the draft's timeSpentSeconds)
5. Submit → Stop local timer
6. Create task with timeSpentSeconds = elapsedSeconds
7. Start actual timer on task
8. Navigate back → Task visible in Progress with running timer
```

### Timer Strategy
**Why two timers?**
- **Local timer** (page state): Tracks time before task exists in store
- **Task timer** (useTaskOperations): Tracks time after task creation

This ensures:
- No time loss between opening form and creating task
- User can start working immediately while typing title
- Seamless transition from form to board
- Time tracking is continuous and accurate

## Design Decisions

### Minimum Required Data
- **Only title required** for task creation
- Validation only checks title exists before allowing Done drop
- Philosophy: Don't block user from starting work
- User can add details later via task edit modal

### Auto-focus
- Title input auto-focuses in ad-hoc mode
- Uses `nextTick()` to ensure DOM is ready
- Allows immediate typing without mouse click

### Ghost-like Styling
- Matches existing drag ghost appearance
- Variables: `--ui-ghost-surface`, `--ui-radius`
- Darker neutral tone, semi-transparent
- No shadow (consistent with ghost aesthetic)
- Hover increases opacity and slight scale

### Status Forcing
- Ad-hoc tasks always created with `status: Progress`
- Overrides form default (`TaskStatus.Open`)
- User intent is clear: jump on task immediately

### Validation UX
- Toast notification instead of preventing drag
- Clear error message with reason
- Drag reverts visually (element moves back)
- No destructive action (task data unchanged)

## Integration Points

### Stores
- `tasksStore.addTask()`: Adds created task
- `boardStore.updateTaskPosition()`: Updates column order
- `tasksStore.task(id)`: Retrieves task for validation

### Composables
- `useTaskTimerDriver`: times every task in Jetzt (#352)
- `useTaskSync.updateTaskStatus()`: Syncs status changes
- `useErrorHandler.handleError()`: Error handling

### Type Definitions
- `Task.isUnplanned`: Optional boolean flag
- `Task.activity`: Added null in local save (existing field)
- Task interface already supports all required fields

## Testing Considerations

### Manual Testing Steps
1. Empty Progress column → Hover → Button appears
2. Click button → Modal opens with focused title input
3. Wait 5 seconds → Type title → Submit
4. Verify task appears in Progress with ≥5s on timer
5. Verify timer continues incrementing
6. Drag to Done → Should work (has title)
7. Create ad-hoc task with no title → Submit → Should fail (form validation)

### Edge Cases
- Multiple rapid ad-hoc creations: Timer cleanup prevents memory leaks
- Cancel during creation: Timer cleanup on unmount
- Network error during save: Toast shows error, the draft and form stay open and the local timer keeps running
- Drag validation with stacks: Validates all task IDs in stack

## Future Enhancements
- Optional: Show elapsed time in form UI
- Optional: Keyboard shortcut to trigger ad-hoc creation
- Optional: Pre-fill common ad-hoc categories/tags
- Optional: Statistics tracking for unplanned vs. planned work
- Optional: Warning if too many ad-hoc tasks (focus drift)

## Files Modified
```
components/board/AdHocTaskButton.vue          [NEW]
components/board/BoardColumn.vue              [MODIFIED]
components/task/TaskForm.vue                  [MODIFIED]
pages/tasks/add.vue                           [MODIFIED]
components/board/Board.vue                    [MODIFIED]
```

## Alignment with Rules
- **Focus principle**: Enables quick jump to reactive work
- **Timeboxing**: Immediate timer start improves tracking accuracy
- **WIP limits**: Validation ensures task quality before completion
- **Minimal distraction**: Ghost styling, auto-focus, streamlined flow
- **German UI**: All user-facing strings in German
- **Composition API**: All new code uses `<script setup>`
- **Nuxt UI**: Uses existing components (UIcon, toast)
- **Type safety**: All functions properly typed with TypeScript
