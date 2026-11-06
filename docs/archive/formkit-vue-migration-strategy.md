# FormKit Vue Migration Strategy

## Status: VIABLE ✅

After extensive testing, FormKit drag-and-drop has been proven compatible with our architecture using Vue's template ref integration approach.

## Key Findings

### What Didn't Work

- Direct DOM manipulation using `dragAndDrop()` function
- Passing existing DOM elements to FormKit
- Trying to retrofit FormKit onto SortableJS architecture

### What Works

- Vue template refs with `useDragAndDrop` composable
- Reactive data binding with Pinia stores
- Event handling through Vue's emit system
- WIP limits and business logic

## Migration Strategy

### Phase 1: Component Refactoring

1. Refactor `BoardColumn.vue` to use template refs instead of exposing DOM elements
2. Move drag-and-drop initialization from Board.vue into BoardColumn.vue
3. Use FormKit's Vue composable within each column component

### Phase 2: Event System Migration

1. Map FormKit events to existing event handlers
2. Ensure task status updates work correctly
3. Maintain WIP limit enforcement

### Phase 3: Testing & Validation

1. Update E2E tests for FormKit implementation
2. Verify performance metrics
3. Test all drag-and-drop scenarios

## Implementation Example

```vue
<script setup lang="ts">
import { useDragAndDrop } from '@formkit/drag-and-drop/vue'

// Use FormKit's Vue composable with template ref
const [listRef, taskList] = useDragAndDrop<Task>(
  props.tasks,
  {
    group: 'tasks',
    sortable: true,
    accepts: () => canAcceptTask(),
    onSort: (data) => emit('update:tasks', data.values),
    onTransfer: (data) => handleTaskTransfer(data)
  }
)
</script>

<template>
  <div ref="listRef" class="task-list">
    <!-- Tasks rendered by FormKit -->
  </div>
</template>
```

## Benefits

- Modern, lightweight library (smaller than SortableJS)
- Better TypeScript support
- Native Vue 3 integration
- Built-in animations
- Future-proof architecture

## Risks & Mitigations

- **Risk**: Refactoring BoardColumn may introduce bugs
  - **Mitigation**: Keep changes incremental and validate via unit + E2E tests
- **Risk**: Performance differences
  - **Mitigation**: Benchmark both implementations
- **Risk**: E2E test failures
  - **Mitigation**: Update tests incrementally

## Decision
Proceed with migration using Vue template ref approach. The initial "abortion" was premature - FormKit is viable when properly integrated with Vue's reactivity system.
