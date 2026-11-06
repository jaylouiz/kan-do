/**
 * @module taskMenuOptions
 * @description Shared option lists for task actions (context menu and command palette).
 */
import { TaskStatus } from '~/types/taskStatus'

/** Timebox presets in minutes (seconds derived) */
export const TIMEBOX_PRESETS = [5, 10, 15, 30, 60].map(minutes => ({ minutes, seconds: minutes * 60 }))

/** Priority options with icons (labels come from `getPriorityLabel`) */
export const PRIORITY_OPTIONS = [
  { priority: 1, icon: 'i-ph-number-circle-one' },
  { priority: 2, icon: 'i-ph-number-circle-two' },
  { priority: 3, icon: 'i-ph-exclamation-mark' },
] as const

/** Status options with icons (labels come from the `task.contextMenu.moveTo.*` keys) */
export const STATUS_OPTIONS = [
  { status: TaskStatus.Open, labelKey: 'task.contextMenu.moveTo.open', icon: 'i-ph-calendar-check' },
  { status: TaskStatus.Progress, labelKey: 'task.contextMenu.moveTo.progress', icon: 'i-ph-play' },
  { status: TaskStatus.Waiting, labelKey: 'task.contextMenu.moveTo.waiting', icon: 'i-ph-pause' },
  { status: TaskStatus.Done, labelKey: 'task.contextMenu.moveTo.done', icon: 'i-ph-check' },
] as const
