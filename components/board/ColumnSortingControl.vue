<!--
@component ColumnSortingControl
@kind component
@category action
@description Per-column sort menu in the column header: sort field and direction for one column
@usage Rendered by BoardColumn; fades out while not hovered or focused (`visible`)
@avoid Sorts one column only; board-wide controls (grouping, day close) live in MorePanel.
@responsibility
- List the sort options for the column's status, mark the active one
- Emit `change` (field, direction) and `open-change` so the header can keep the control visible while the menu is open
-->
<template>
  <div
    data-testid="column-sorting-control"
    class="transition-opacity duration-(--duration-base)"
    :class="visible ? 'opacity-100' : 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100'"
  >
    <UDropdownMenu
      :items="items"
      :content="{ side: 'bottom', align: 'center', collisionPadding: 8 }"
      :ui="{
        content: 'w-max min-w-48 max-w-(--reka-dropdown-menu-content-available-width)',
        itemLabel: 'whitespace-normal',
        itemDescription: 'whitespace-normal'
      }"
      @update:open="emit('open-change', $event)"
    >
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        :icon="currentIcon"
        :label="currentLabel"
        class="text-2xs max-md:text-xs font-medium text-muted hover:text-default"
      />
    </UDropdownMenu>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { TaskStatus } from '~/types/taskStatus';
import type { SortField, SortDirection, ColumnSorting } from '~/types/state';

defineOptions({ name: 'ColumnSortingControl' });

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  status: TaskStatus;
  sorting: ColumnSorting | undefined;
}>();

const emit = defineEmits<{
  (e: 'change', field: SortField, direction: SortDirection): void;
  (e: 'open-change', isOpen: boolean): void;
}>();

interface SortOption {
  field: SortField;
  direction: SortDirection;
  label: string;
  /** Direction hint; shown as the item description and appended in the trigger. */
  hint?: string;
}

const currentSort = computed(() => props.sorting || { field: 'manual', direction: 'asc' });

const options = computed<SortOption[]>(() => {
  const manual: SortOption = { field: 'manual', direction: 'asc', label: t('board.sort.manual') };

  if (props.status === TaskStatus.Done) {
    return [
      manual,
      { field: 'dateCompleted', direction: 'asc', label: t('board.sort.completedFirst'), hint: t('board.sort.oldestOnTop') },
      { field: 'dateCompleted', direction: 'desc', label: t('board.sort.completedLast'), hint: t('board.sort.newestOnTop') }
    ];
  }
  if (props.status === TaskStatus.Waiting) {
    return [
      manual,
      { field: 'dateUpdated', direction: 'asc', label: t('board.sort.longestWait') },
      { field: 'dateUpdated', direction: 'desc', label: t('board.sort.shortestWait') }
    ];
  }
  // Open & Progress
  return [
    manual,
    { field: 'priority', direction: 'desc', label: t('board.sort.priority'), hint: t('board.sort.highestFirst') },
    { field: 'dateCreated', direction: 'desc', label: t('board.sort.created'), hint: t('board.sort.newestFirst') },
    { field: 'dateCreated', direction: 'asc', label: t('board.sort.created'), hint: t('board.sort.oldestFirst') }
  ];
});

const isActive = (option: SortOption) =>
  currentSort.value.field === option.field
  && (option.field === 'manual' || currentSort.value.direction === option.direction);

const activeOption = computed(() => options.value.find(isActive));

const currentLabel = computed(() => {
  const option = activeOption.value;
  if (!option) return t('board.sort.default');
  return option.hint && option.field !== 'manual' ? `${option.label} · ${option.hint}` : option.label;
});

const currentIcon = computed(() => {
  switch (currentSort.value.field) {
    case 'manual': return 'i-ph-list';
    case 'priority': return 'i-ph-warning-circle';
    case 'dateCreated': return 'i-ph-calendar';
    case 'dateUpdated': return 'i-ph-clock';
    case 'dateCompleted': return 'i-ph-check-circle';
    default: return 'i-ph-arrows-down-up';
  }
});

const items = computed(() => [
  [{ type: 'label' as const, label: t('board.sort.groupLabel') }],
  options.value.map((option) => ({
    label: option.label,
    ...(option.hint ? { description: option.hint } : {}),
    type: 'checkbox' as const,
    checked: isActive(option),
    onSelect: () => emit('change', option.field, option.direction)
  }))
]);
</script>
