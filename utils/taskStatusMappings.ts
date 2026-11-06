/**
 * Centralized task status configuration for consistent UI rendering.
 * Single source of truth for status labels, icons, and colors.
 */
import { TaskStatus } from '~/types/taskStatus';
import { translate } from '~/lib/i18n';
import { normalizePriority } from '~/lib/priority';

/** Badge color type matching Nuxt UI conventions */
export type BadgeColor = 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error' | 'neutral';

/** Complete status configuration for UI rendering */
export interface TaskStatusConfig {
  labelKey: string;
  icon: string;
  color: BadgeColor;
}

/**
 * Unified status configuration mapping.
 * Use this instead of defining separate STATUS_LABELS, STATUS_ICONS, STATUS_INFO_MAP.
 */
export const TASK_STATUS_CONFIG: Record<TaskStatus, TaskStatusConfig> = {
  [TaskStatus.Open]: {
    labelKey: 'taskStatus.open',
    icon: 'ph:circle',
    color: 'neutral',
  },
  [TaskStatus.Progress]: {
    labelKey: 'taskStatus.progress',
    icon: 'ph:play-circle',
    color: 'info',
  },
  [TaskStatus.Waiting]: {
    labelKey: 'taskStatus.waiting',
    icon: 'ph:pause-circle',
    color: 'warning',
  },
  [TaskStatus.Done]: {
    labelKey: 'taskStatus.done',
    icon: 'ph:check-circle',
    color: 'success',
  },
  [TaskStatus.Backlog]: {
    labelKey: 'taskStatus.backlog',
    icon: 'ph:archive',
    color: 'secondary',
  },
};

/** Locale keys of the three priority levels (1 low, 2 regular, 3 high, #617); no priority reads as Normal (#653); `priority.none` is the label of an empty group of the other groupings. */
export const PRIORITY_LABEL_KEYS: Record<number, string> = {
  1: 'priority.low',
  2: 'priority.regular',
  3: 'priority.high',
};

/**
 * Get status label for a given TaskStatus, translated in the active locale
 */
export function getStatusLabel(status: TaskStatus): string {
  const config = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG[TaskStatus.Open];
  return translate(config.labelKey);
}

/**
 * Get status icon for a given TaskStatus
 */
export function getStatusIcon(status: TaskStatus): string {
  return TASK_STATUS_CONFIG[status]?.icon ?? TASK_STATUS_CONFIG[TaskStatus.Open].icon;
}

/**
 * Get status color for a given TaskStatus
 */
export function getStatusColor(status: TaskStatus): BadgeColor {
  return TASK_STATUS_CONFIG[status]?.color ?? TASK_STATUS_CONFIG[TaskStatus.Open].color;
}

/**
 * Get priority label for a given priority level (no priority reads as Normal, #653), translated in the active locale.
 * A stored 4 (the former "urgent") reads as high.
 */
export function getPriorityLabel(priority: number): string {
  const key = PRIORITY_LABEL_KEYS[normalizePriority(priority)];
  return key ? translate(key) : translate('priority.level', { n: priority });
}
