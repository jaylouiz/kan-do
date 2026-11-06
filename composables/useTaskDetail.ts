/**
 * @composable useTaskDetail
 * @description Shared logic for task detail views (page and modal)
 * Provides computed values, formatters, and helpers for displaying task information.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import { useTasksStore } from '~/store/tasks';
import { useNotionConfigStore } from '~/store/notionConfig';
import { TaskStatus } from '~/types/taskStatus';
import { TASK_STATUS_CONFIG, getStatusLabel, getPriorityLabel, type BadgeColor } from '~/utils/taskStatusMappings';
import type { Task, TaskCustomEntry, TaskCustomValue } from '~/types/task';
import type { CustomPropertyType } from '~/types/notion';
import { getActiveLocale, translate } from '~/lib/i18n';
import { normalizePriority } from '~/lib/priority';
import {
  compareText,
  formatDateTime as formatDateTimeFor,
  formatDuration as formatDurationFor,
  formatNumber as formatNumberFor,
} from '~/utils/localeFormat';

/** Extended entry with missing flag for display purposes */
export type CustomDisplayEntry = TaskCustomEntry & { isMissing: boolean };

/** Status display information */
export interface StatusInfo {
  label: string;
  color: BadgeColor;
}

/** Return type for useTaskDetail composable */
export interface UseTaskDetailReturn {
  /** The task object (null if not found) */
  task: ComputedRef<Task | null>;
  /** Whether the task is in error state (not found) */
  isError: ComputedRef<boolean>;
  /** Status display info (label + color) */
  statusInfo: ComputedRef<StatusInfo>;
  /** Status label text */
  statusLabel: ComputedRef<string>;
  /** Status badge color */
  statusBadgeColor: ComputedRef<BadgeColor>;
  /** Priority label text */
  priorityLabel: ComputedRef<string>;
  /** Task source (Notion/Todoist/null) */
  taskSource: ComputedRef<string | null>;
  /** Time spent summary (e.g., "45 min von 1 h") */
  timeSpentSummary: ComputedRef<string>;
  /** Time spent text (e.g., "45 min") */
  timeSpentText: ComputedRef<string>;
  /** Timebox text (e.g., "1 h") */
  timeBoxText: ComputedRef<string>;
  /** Remaining time text (e.g., "15 min") */
  remainingTimeText: ComputedRef<string>;
  /** Whether task has custom properties */
  hasCustom: ComputedRef<boolean>;
  /** List of custom properties for display */
  customList: ComputedRef<CustomDisplayEntry[]>;
}

// Status and priority mappings imported from ~/utils/taskStatusMappings.ts

/** Source to display name mapping */
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  notion: 'Notion',
  todoist: 'Todoist',
};

/** Empty multi-select value constant */
const EMPTY_MULTI_SELECT: TaskCustomValue = { type: 'multi_select', value: [] };

/** True when a value carries nothing to persist (`null`, `''`, `[]`, unchecked checkbox). */
function isEmptyCustomValue(value: TaskCustomValue): boolean {
  switch (value.type) {
    case 'multi_select':
      return value.value.length === 0;
    case 'checkbox':
      return !value.value;
    default:
      return value.value === null || value.value === '';
  }
}

/**
 * Returns a new `custom` record with `value` written for `source.key`, never mutating the input.
 * `source` is the existing entry or the displayed row of a configured-but-missing property; the
 * entry is materialised from it (without `isMissing`). Returns `null` when there is nothing to do:
 * an empty value for a key the task has no entry for.
 */
export function applyCustomValue(
  custom: Record<string, TaskCustomEntry> | undefined,
  source: TaskCustomEntry,
  value: TaskCustomValue,
): Record<string, TaskCustomEntry> | null {
  const existing = custom?.[source.key];
  if (!existing && isEmptyCustomValue(value)) return null;

  const base = existing ?? source;
  return {
    ...custom,
    [source.key]: {
      key: base.key,
      name: base.name,
      propType: base.propType,
      value,
    },
  };
}

/**
 * Creates a fallback custom value based on property type
 */
export function fallbackCustomValue(type: CustomPropertyType): TaskCustomValue {
  switch (type) {
    case 'text':
      return { type: 'text', value: null };
    case 'number':
      return { type: 'number', value: null };
    case 'select':
      return { type: 'select', value: null };
    case 'multi_select':
      return EMPTY_MULTI_SELECT;
    case 'date':
      return { type: 'date', value: null };
    case 'checkbox':
      return { type: 'checkbox', value: false };
    case 'url':
      return { type: 'url', value: null };
    case 'email':
      return { type: 'email', value: null };
    case 'phone_number':
      return { type: 'phone_number', value: null };
    default:
      return { type: 'text', value: null };
  }
}

/**
 * Formats duration in seconds to a human-readable string
 * Uses compound notation (e.g., "4 min 22s" instead of "4.36 min")
 * @param seconds - Time in seconds
 * @returns Formatted string (e.g., "45s", "4 min", "1 h 30 min", "4 min 22s")
 */
export function formatTaskDuration(seconds: number | null | undefined): string {
  return formatDurationFor(seconds, "spaced", translate);
}

/**
 * Formats a number for display in the active locale
 */
export function formatTaskNumber(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return formatNumberFor(value, getActiveLocale());
}

/**
 * Formats a date range for display
 */
export function formatDateRange(value: { start: string; end?: string } | null): string {
  if (!value) return '—';
  
  const formatDate = (iso?: string) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return formatDateTimeFor(date, getActiveLocale(), "longDateUtc");
  };
  
  const start = formatDate(value.start) ?? '—';
  const end = formatDate(value.end);
  return end ? `${start} – ${end}` : start;
}

/**
 * Composable for task detail views
 * @param taskIdRef - Reactive reference to task ID (string or null)
 */
export function useTaskDetail(taskIdRef: Ref<string | null>): UseTaskDetailReturn {
  const tasksStore = useTasksStore();
  const notionConfigStore = useNotionConfigStore();

  // Core task computed
  const task = computed<Task | null>(() => {
    if (!taskIdRef.value) return null;
    return tasksStore.task(taskIdRef.value);
  });

  const isError = computed(() => {
    return !tasksStore.isLoading && !task.value && !!taskIdRef.value;
  });

  // Status info
  const statusInfo = computed<StatusInfo>(() => {
    const status = task.value?.status ?? TaskStatus.Open;
    const config = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG[TaskStatus.Open];
    return { label: getStatusLabel(status), color: config.color };
  });

  const statusLabel = computed(() => statusInfo.value.label);
  const statusBadgeColor = computed(() => statusInfo.value.color);

  // Priority
  const priorityLabel = computed(() => {
    return getPriorityLabel(normalizePriority(task.value?.priority));
  });

  // Source: the display name of an integration, `null` for Local (the view shows its i18n label)
  const taskSource = computed(() => {
    const value = (task.value as { source?: string } | null)?.source;
    if (!value || value === 'local') return null;
    return SOURCE_DISPLAY_MAP[value] ?? value;
  });

  // Time formatting
  const timeSpentSummary = computed(() => {
    if (!task.value) return '—';
    const spent = formatTaskDuration(task.value.timeSpentSeconds ?? 0);
    if (!task.value.timeBoxSeconds) return spent;
    return translate("duration.spentOfTotal", { spent, total: formatTaskDuration(task.value.timeBoxSeconds) });
  });

  const timeSpentText = computed(() => {
    if (!task.value) return '—';
    return formatTaskDuration(task.value.timeSpentSeconds ?? 0);
  });

  const timeBoxText = computed(() => {
    if (!task.value?.timeBoxSeconds) return '—';
    return formatTaskDuration(task.value.timeBoxSeconds);
  });

  const remainingTimeText = computed(() => {
    if (!task.value?.timeBoxSeconds) return '—';
    const remaining = Math.max(0, task.value.timeBoxSeconds - (task.value.timeSpentSeconds ?? 0));
    return formatTaskDuration(remaining);
  });

  // Custom properties: Notion's, so only a Notion task has them (#325); a Local task's sheet has no such section
  const configuredCustoms = computed(() => {
    return (
      notionConfigStore.config?.propertyMapping.customProperties?.filter((c) => c.enabled) ?? []
    );
  });

  const customList = computed<CustomDisplayEntry[]>(() => {
    if (task.value && task.value.source !== 'notion') return [];
    const taskCustoms = task.value?.custom ?? {};
    const configs = configuredCustoms.value;

    if (configs.length > 0) {
      const entries: CustomDisplayEntry[] = configs.map((cfg) => {
        const displayName = cfg.label || cfg.name;
        const existing = taskCustoms[cfg.key];
        if (existing) {
          return {
            ...existing,
            name: displayName,
            isMissing: false,
          };
        }
        return {
          key: cfg.key,
          name: displayName,
          propType: cfg.type,
          value: fallbackCustomValue(cfg.type),
          isMissing: true,
        };
      });

      // Add any task customs not in config
      for (const entry of Object.values(taskCustoms)) {
        if (!configs.some((cfg) => cfg.key === entry.key)) {
          entries.push({ ...entry, isMissing: false });
        }
      }

      return entries.sort((a, b) => compareText(a.name, b.name, getActiveLocale()));
    }

    return Object.values(taskCustoms)
      .map((entry) => ({ ...entry, isMissing: false }))
      .sort((a, b) => compareText(a.name, b.name, getActiveLocale()));
  });

  const hasCustom = computed(() => customList.value.length > 0);

  return {
    task,
    isError,
    statusInfo,
    statusLabel,
    statusBadgeColor,
    priorityLabel,
    taskSource,
    timeSpentSummary,
    timeSpentText,
    timeBoxText,
    remainingTimeText,
    hasCustom,
    customList,
  };
}
