# Code Audit Report – December 2025

## Executive Summary

This audit identifies maintainability and performance improvements across stores, composables, components, and types. Findings are prioritized by impact and effort.

**Legend**: 🔴 High Priority | 🟡 Medium | 🟢 Low

---

## A. State Management

### 🔴 A1. NotionIntegration Instantiation Duplication

**Location**: `useTaskSync.ts`, `useIntegrationManager.ts`

**Issue**: `NotionIntegration` is instantiated repeatedly with identical parameters in multiple composables:

```typescript
// useTaskSync.ts:148-155
const notion = new NotionIntegration(
  notionConfig.config.token,
  notionConfig.config.databaseId,
  notionConfig.config.propertyMapping,
  notionConfig.config.statusMapping,
  notionConfig.config.priorityMapping,
  notionConfig.config.dataSourceId ?? null,
);
```

This 6-parameter construction appears **5+ times** across the codebase.

**Recommendation**: Extract a factory composable:

```typescript
// composables/useNotionIntegration.ts
export function useNotionIntegration() {
  const notionConfig = useNotionConfigStore();
  
  const getInstance = () => {
    if (!notionConfig.isConfigured || !notionConfig.config) {
      throw new Error('Notion not configured');
    }
    return new NotionIntegration(
      notionConfig.config.token,
      notionConfig.config.databaseId,
      notionConfig.config.propertyMapping,
      notionConfig.config.statusMapping,
      notionConfig.config.priorityMapping,
      notionConfig.config.dataSourceId ?? null,
    );
  };
  
  return { getInstance, isConfigured: notionConfig.isConfigured };
}
```

**Effort**: Low | **Impact**: High (DRY, single point of change)

---

### 🟡 A2. Tasks Store Size

**Location**: `store/tasks.ts` (583 lines)

**Issue**: Single store handles tasks, pending updates, archives, custom property indexes, and time tracking. This violates single-responsibility.

**Recommendation**: Consider splitting into:

- `store/tasks.ts` – Core task CRUD
- `store/pendingSync.ts` – Pending time updates, sync status
- `store/taskIndexes.ts` – Custom property indexes

**Effort**: Medium | **Impact**: Medium (maintainability)

---

### 🟡 A3. Repeated `useBoardStore()` in Computed Getters

**Location**: `store/tasks.ts:48-54, 79-80, 104-106`

**Issue**: `useBoardStore()` is called inside computed getters, which works but creates implicit coupling.

```typescript
const createTasksByStatusGetter = (status: TaskStatus, tasks: Ref<Task[]>) => computed(() => {
  const boardStore = useBoardStore(); // Called on every recompute
  // ...
});
```

**Recommendation**: Pass `boardStore` as parameter or memoize reference at store setup.

**Effort**: Low | **Impact**: Low (minor performance)

---

### 🟢 A4. Dynamic Import in `updateTask`

**Location**: `store/tasks.ts:179-185`

**Issue**: `updateTask` uses dynamic import for statistics store to avoid circular deps:

```typescript
import('~/store/taskStatistics').then(({ useTaskStatisticsStore }) => {
```

**Recommendation**: Accept as necessary pattern OR restructure statistics to subscribe to task changes via event bus.

**Effort**: Medium | **Impact**: Low

---

## B. Composables

### 🔴 B1. `useTaskDetail` Returns Function References

**Location**: `composables/useTaskDetail.ts:317-336`

**Issue**: Returns both computed values and standalone utility functions (`badgeColor`, `formatNumber`, `formatDateRange`, `formatDuration`). These utilities are also exported as standalone functions but returned again from the composable.

**Recommendation**: Export utilities separately; composable returns only reactive values:

```typescript
// Export utilities at module level (already done)
export { formatDuration, badgeColor, formatNumber, formatDateRange };

// Composable returns only computed values
export function useTaskDetail(taskIdRef: Ref<string | null>): UseTaskDetailReturn {
  // ...
  return { task, isError, statusInfo, ... }; // No utility functions
}
```

**Effort**: Low | **Impact**: Medium (cleaner API, tree-shaking)

---

### 🟡 B2. Status/Icon/Label Maps Duplicated

**Location**:

- `composables/useTaskDetail.ts:79-100` – `STATUS_INFO_MAP`, `PRIORITY_LABEL_MAP`
- `components/task/TaskDetailContent.vue:282-296` – `STATUS_ICONS`, `STATUS_LABELS`

**Issue**: Status-related mappings are defined in multiple places.

**Recommendation**: Create `utils/taskStatusMappings.ts`:

```typescript
export const TASK_STATUS_CONFIG: Record<TaskStatus, { 
  label: string; 
  icon: string; 
  color: BadgeColor 
}> = { ... };
```

**Effort**: Low | **Impact**: Medium (single source of truth)

---

### 🟡 B3. `useBoardDnd` Event Listeners Not Cleaned on SSR

**Location**: `composables/useBoardDnd.ts:332-335`

**Issue**: Window event listeners are added at module evaluation time:

```typescript
if (typeof window !== 'undefined') {
  window.addEventListener('kando:stack-expanded', handleStackExpandOrCollapse);
  window.addEventListener('kando:stack-collapsed', handleStackExpandOrCollapse);
}
```

**Recommendation**: Move listener registration inside `init()` and ensure cleanup in `cleanup()`.

**Effort**: Low | **Impact**: Medium (memory leak prevention)

---

### 🟢 B4. Composable Count Growing

**Observation**: 17 composables in `/composables/`. While not problematic yet, some overlap exists.

**Recommendation**: Document composable purposes in a README; consider consolidation during future refactors.

---

## C. Components

### 🔴 C1. `BoardColumn.vue` Size (713 lines)

**Location**: `components/board/BoardColumn.vue`

**Issue**: Single component handles:

- Regular task rendering
- Grouped/stacked task rendering
- Progress column special behavior
- Done column celebration
- Archive section
- Ad-hoc task creation

**Recommendation**: Extract sub-components:

- `BoardColumnProgressContent.vue` – Progress-specific wrapper and progress bar
- `BoardColumnGroupedContent.vue` – Stack/group rendering logic

**Effort**: Medium | **Impact**: High (testability, maintainability)

---

### 🟡 C2. `TaskCard` Timer Logic

**Location**: `components/task/TaskCard.vue:118-155`

**Issue**: TaskCard manages its own `setInterval` timer for time tracking:

```typescript
const startTaskTimer = () => {
  const timerId = window.setInterval(() => {
    tasksStore.updateTaskTimespent({ ... });
  }, 1000);
};
```

**Recommendation**: Extract timer management to a composable `useTaskTimer` that can be shared and tested independently. This also enables future optimization (single global timer for multiple tasks).

**Effort**: Medium | **Impact**: Medium (testability, potential perf win)

---

### 🟡 C3. Inline Status Menu Items in `TaskDetailContent`

**Location**: `components/task/TaskDetailContent.vue:349-381`

**Issue**: Menu items computed inline with handlers:

```typescript
const statusMenuItems = computed(() => {
  return [[
    { label: ..., icon: ..., onSelect: () => changeStatus(TaskStatus.Open) },
    // ...
  ]];
});
```

**Recommendation**: Extract to composable or constant factory for reuse across task views.

**Effort**: Low | **Impact**: Low

---

### 🟢 C4. Component Extraction Opportunities

| Candidate | Current Location | Benefit |
|-----------|-----------------|---------|
| `TaskMetaBadges` | `TaskDetailContent.vue:23-51` | Reuse in list views |
| `TaskTimeStats` | `TaskDetailContent.vue:197-222` | Standalone time display |
| `TaskCustomFieldGrid` | `TaskDetailContent.vue:113-191` | Reuse in modal/page |

**Effort**: Low each | **Impact**: Incremental maintainability

---

## D. Types & Interfaces

### 🟡 D1. `TaskClass` Rarely Used

**Location**: `types/task.ts:48-82`

**Issue**: `TaskClass` constructor exists but most code uses object literals. The class doesn't add behavior beyond defaults.

**Recommendation**: Replace with a factory function:

```typescript
export function createTask(title: string): Task {
  return {
    id: crypto.randomUUID(),
    title,
    status: TaskStatus.Open,
    // ... defaults
  };
}
```

**Effort**: Low | **Impact**: Low (cleaner API)

---

### 🟡 D2. `timeSpentSeconds` Type Inconsistency

**Location**: `types/task.ts:36`

```typescript
timeSpentSeconds: number | 0;  // Unusual type annotation
```

**Recommendation**: Change to `timeSpentSeconds: number;` with default `0` in factory.

**Effort**: Trivial | **Impact**: Low (type clarity)

---

### 🟢 D3. Consider Zod for Runtime Validation

**Observation**: Task objects from Notion API are cast but not validated:

```typescript
const updatedPage = await this.api.getPage(task.id) as unknown as NotionPage;
```

**Recommendation**: Add Zod schemas for API responses to catch malformed data early.

**Effort**: Medium | **Impact**: Medium (robustness)

---

## E. Performance

### 🔴 E1. Deep Watcher on `tasksProgress`

**Location**: `components/board/Board.vue:373-379`

```typescript
watch(
  () => tasksStore.tasksProgress,
  () => { void updateGradientPosition(); },
  { deep: true }
);
```

**Issue**: Deep watching an array of complex objects triggers on any nested change. `tasksProgress` is already computed, so changes are detected at the array level.

**Recommendation**: Remove `{ deep: true }` – array reference changes are sufficient.

**Effort**: Trivial | **Impact**: Medium (prevents unnecessary re-renders)

---

### 🟡 E2. `sortByTaskIdOrder` Linear Search

**Location**: `store/tasks.ts:32-43`

```typescript
const aIndex = taskIdOrder.findIndex((el) => el === a.id);
const bIndex = taskIdOrder.findIndex((el) => el === b.id);
```

**Issue**: O(n) lookup per comparison in sort → O(n² log n) total.

**Recommendation**: Build index map once:

```typescript
const orderMap = new Map(taskIdOrder.map((id, i) => [id, i]));
return tasks.sort((a, b) => {
  const aIdx = orderMap.get(a.id) ?? Infinity;
  const bIdx = orderMap.get(b.id) ?? Infinity;
  return aIdx - bIdx;
});
```

**Effort**: Low | **Impact**: Medium (scales better with task count)

---

### 🟡 E3. No Debounce on `updateGradientPosition`

**Location**: `components/board/Board.vue:183-217`

**Issue**: Called on every progress task change via watcher. Multiple rapid changes (e.g., drag-drop) trigger multiple DOM reads.

**Recommendation**: Add `useDebounceFn` from VueUse or simple RAF debounce.

**Effort**: Low | **Impact**: Low-Medium

---

### 🟢 E4. `NotionIntegration` Fetches Page Twice on Update

**Location**: `integrations/NotionIntegration.ts:651-675`

**Issue**: When merging multi-select properties, page is fetched once for merge, then again after update for sync:

```typescript
const currentPage = await this.api.getPage(task.id); // First fetch
// ... update ...
const updatedPage = await this.api.getPage(task.id); // Second fetch
```

**Recommendation**: Reuse first fetch if no merge needed, or combine operations.

**Effort**: Medium | **Impact**: Low (reduces API calls)

---

## F. Code Quality

### 🟢 F1. Backup Files in Repo

**Location**: `store/board.ts.backup`, `store/tasks.ts.backup`, etc.

**Recommendation**: Remove `.backup` files; use git history instead.

---

### 🟢 F2. Empty `components/error/` Directory

**Recommendation**: Add error boundary component or remove directory.

---

### 🟢 F3. Unused `TaskClass` Export

**Location**: `types/task.ts:85`

The class is exported but grep shows minimal usage. Consider deprecation.

---

## Prioritized Action Plan

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | A1: NotionIntegration factory | Low | High |
| 2 | C1: Split BoardColumn | Medium | High |
| 3 | E1: Remove deep watcher | Trivial | Medium |
| 4 | E2: Optimize sortByTaskIdOrder | Low | Medium |
| 5 | B1: Clean useTaskDetail API | Low | Medium |
| 6 | B2: Centralize status mappings | Low | Medium |
| 7 | B3: Fix DnD event listener cleanup | Low | Medium |
| 8 | C2: Extract timer to composable | Medium | Medium |
| 9 | A2: Split tasks store | Medium | Medium |
| 10 | D1: Replace TaskClass with factory | Low | Low |

---

## Summary

The codebase is well-structured with clear separation between stores, composables, and components. Main opportunities lie in:

1. **DRY improvements**: NotionIntegration factory, status mappings centralization
2. **Component splitting**: BoardColumn is handling too many responsibilities
3. **Performance quick wins**: Remove unnecessary deep watchers, optimize sort algorithm
4. **API cleanup**: Separate utility functions from composable returns

Most recommendations are low-to-medium effort with meaningful maintainability gains.
