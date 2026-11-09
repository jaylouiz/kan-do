/**
 * @composable useCommandPalette
 * @description State and command list for the Cmd/Ctrl+K palette (issue #101, Direction B).
 * `buildCommandGroups` is the single source of commands and their `kbds` hints; it is pure so the
 * focused-card / no-card / Jetzt-full cases are unit-testable. Moves go through
 * `useTaskOperations.moveTaskToStatus` (shared WIP guard and completion undo toast).
 * @responsibility Open/close state, focus capture + restore, command groups. No UI.
 */
import { ICONS } from '~/lib/icons'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { deleteLabelKey } from '~/lib/taskSources'
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import { navigateTo } from 'nuxt/app'
import type { Task } from '~/types/task'
import type { TaskStatus } from '~/types/taskStatus'
import type { SourceId } from '~/types/taskSource'
import type { WipVerdict } from '~/utils/wipGuard'
import { PRIORITY_OPTIONS, STATUS_OPTIONS, TIMEBOX_PRESETS } from '~/utils/taskMenuOptions'
import { getPriorityLabel, getStatusLabel } from '~/utils/taskStatusMappings'
import { normalizePriority } from '~/lib/priority'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import { neighbourCardId } from '~/utils/neighbourCard'
import { useTaskMove } from '~/composables/useTaskMove'
import { buildMoveTargets, type MoveTarget } from '~/composables/useTaskMoveTargets'
import { useDayClose } from '~/composables/useDayClose'
import { useAppUpdater } from '~/composables/useAppUpdater'
import { useFeedback } from '~/composables/useFeedback'
import { useWhatsNew } from '~/composables/useWhatsNew'
import { isTauri } from '~/utils/isTauri'
import { paletteExtensionGroups } from '~/lib/paletteExtensions'

type Translate = (key: string, ...args: unknown[]) => string

export interface PaletteActions {
  addTask: () => void
  openStatistics: () => void
  openSettings: () => void
  openDayClose: () => void
  /** Desktop only: absent on web, where there is no Keychain and no GitHub settings page. */
  openGithubSettings?: () => void
  /** Desktop only: the data folder page (#222). */
  openDataFolder?: () => void
  /** Web only: the export/import section of /settings/data (#238). */
  openDataTransfer?: () => void
  /** Desktop only: runs an update check (#225). */
  checkForUpdates?: () => void
  /** Desktop only: the version and updates page (#225). */
  openUpdates?: () => void
  /** Desktop only: the in-app feedback dialog (#227). */
  sendFeedback?: () => void
  /** Desktop only: re-opens "What's new" (#226). */
  openWhatsNew?: () => void
  openDetails: (taskId: string) => void
  moveTo: (taskId: string, status: TaskStatus) => void
  setTimebox: (taskId: string, seconds: number | null) => void
  setPriority: (taskId: string, priority: number) => void
  deleteTask: (taskId: string) => void
  moveToSource: (taskId: string, source: SourceId) => void
}

export interface BuildCommandGroupsInput {
  t: Translate
  /** The task whose card held keyboard focus when the palette opened, or null. */
  task: Task | null
  canMove: (taskId: string, status: TaskStatus) => WipVerdict
  /** Where the focused task can move to (#322); empty with a single source. Optional: no source group then. */
  moveTargets?: readonly MoveTarget[]
  actions: PaletteActions
}

/** Builds the palette groups. Card groups exist only when a card had focus. */
export function buildCommandGroups({ t, task, canMove, moveTargets = [], actions }: BuildCommandGroupsInput): CommandPaletteGroup<CommandPaletteItem>[] {
  const groups: CommandPaletteGroup<CommandPaletteItem>[] = []
  let cardItems: CommandPaletteItem[] | null = null

  if (task) {
    const id = task.id
    // The current column is not offered (nothing to do). Blocked rows go last, so the first row
    // is always runnable and gets the initial highlight.
    const moveItems: CommandPaletteItem[] = STATUS_OPTIONS
      .filter(opt => opt.status !== task.status)
      .map((opt) => {
        const verdict = canMove(id, opt.status)
        const item: CommandPaletteItem = {
          id: `move-${opt.status}`,
          label: t('commandPalette.moveTo', { column: getStatusLabel(opt.status) }),
          icon: opt.icon,
          disabled: !verdict.allowed,
          onSelect: () => actions.moveTo(id, opt.status),
        }
        if (!verdict.allowed) item.suffix = t('commandPalette.progressFull')
        return item
      })
      .sort((a, b) => Number(a.disabled ?? false) - Number(b.disabled ?? false))

    const taskItems: CommandPaletteItem[] = [
      { id: 'details', label: t('task.contextMenu.openDetails'), icon: ICONS.openDetail, onSelect: () => actions.openDetails(id) },
      ...PRIORITY_OPTIONS.map((opt): CommandPaletteItem => ({
        id: `priority-${opt.priority}`,
        label: t('commandPalette.setPriority', { priority: getPriorityLabel(opt.priority) }),
        icon: normalizePriority(task.priority) === opt.priority ? 'i-ph-check' : opt.icon,
        onSelect: () => actions.setPriority(id, opt.priority),
      })),
      ...TIMEBOX_PRESETS.map((preset): CommandPaletteItem => ({
        id: `timebox-${preset.minutes}`,
        label: t('commandPalette.setTimebox', { minutes: preset.minutes }),
        icon: task.timeBoxSeconds === preset.seconds ? 'i-ph-check' : 'i-ph-timer',
        onSelect: () => actions.setTimebox(id, preset.seconds),
      })),
    ]
    if (task.timeBoxSeconds) {
      taskItems.push({ id: 'timebox-remove', label: t('task.contextMenu.removeTimebox'), icon: ICONS.close, onSelect: () => actions.setTimebox(id, null) })
    }
    taskItems.push({ id: 'delete', label: t(deleteLabelKey(task.source)), icon: ICONS.delete, onSelect: () => actions.deleteTask(id) })

    groups.push({ id: 'card-move', label: t('commandPalette.groupMove', { title: task.title }), items: moveItems })
    // Source moves sit right under the column moves (#322); the palette has no submenus, so one flat row per source
    if (moveTargets.length > 0) {
      groups.push({
        id: 'card-source',
        label: t('commandPalette.groupSource'),
        items: moveTargets.map((target): CommandPaletteItem => ({
          id: `move-source-${target.source}`,
          label: t('commandPalette.moveToSource', { source: target.name }),
          icon: target.icon,
          disabled: target.disabled,
          ...(target.hint ? { suffix: target.hint } : {}),
          onSelect: () => actions.moveToSource(id, target.source),
        })),
      })
    }
    cardItems = taskItems
  }

  const globalItems: CommandPaletteItem[] = [
    { id: 'add', label: t('commandPalette.addTask'), icon: 'i-ph-plus', onSelect: actions.addTask },
    { id: 'statistics', label: t('commandPalette.openStatistics'), icon: 'i-ph-chart-bar', onSelect: actions.openStatistics },
    { id: 'settings', label: t('commandPalette.openSettings'), icon: 'i-ph-gear', onSelect: actions.openSettings },
    { id: 'day-close', label: t('commandPalette.dayClose'), icon: 'i-ph-sun-horizon', onSelect: actions.openDayClose },
  ]
  if (actions.openGithubSettings) {
    globalItems.push({ id: 'github-access', label: t('commandPalette.openGithubAccess'), icon: 'i-ph-key', onSelect: actions.openGithubSettings })
  }
  if (actions.openDataFolder) {
    globalItems.push({ id: 'data-folder', label: t('commandPalette.openDataFolder'), icon: 'i-ph-folder-open', onSelect: actions.openDataFolder })
  }
  if (actions.openDataTransfer) {
    globalItems.push({ id: 'data-transfer', label: t('commandPalette.openDataTransfer'), icon: 'i-ph-download-simple', onSelect: actions.openDataTransfer })
  }
  if (actions.checkForUpdates) {
    globalItems.push({ id: 'check-updates', label: t('commandPalette.checkForUpdates'), icon: 'i-ph-arrow-circle-up', onSelect: actions.checkForUpdates })
  }
  if (actions.openUpdates) {
    globalItems.push({ id: 'updates', label: t('commandPalette.openUpdates'), icon: 'i-ph-info', onSelect: actions.openUpdates })
  }
  if (actions.sendFeedback) {
    globalItems.push({ id: 'send-feedback', label: t('commandPalette.sendFeedback'), icon: 'i-ph-chat-teardrop-text', onSelect: actions.sendFeedback })
  }
  if (actions.openWhatsNew) {
    globalItems.push({ id: 'whats-new', label: t('commandPalette.openWhatsNew'), icon: 'i-ph-sparkle', onSelect: actions.openWhatsNew })
  }
  groups.push({ id: 'global', label: t('commandPalette.groupGlobal'), items: globalItems })

  // Global commands sit right under the move rows so they stay above the fold; the long list comes last
  if (cardItems) groups.push({ id: 'card', label: t('commandPalette.groupCard'), items: cardItems })

  return groups
}

// Module-level: one palette per app, opened from the keyboard shortcut and rendered once.
const isOpen = ref(false)
const focusedTaskId = ref<string | null>(null)
let returnFocusTo: HTMLElement | null = null
let skipFocusRestore = false
/** Runs once the palette has left the DOM (never modal on modal), instead of restoring focus. */
let afterLeave: (() => void) | null = null

/** Task wrapper that holds keyboard focus (hover is not keyboard-accessible, so it never counts). */
function findFocusedCard(): HTMLElement | null {
  if (!import.meta.client) return null
  const active = document.activeElement
  return active instanceof HTMLElement ? active.closest<HTMLElement>('.task-wrapper[data-task-id]') : null
}

/** Opens unless the board is busy (keyboard drag in progress) or another sheet is open. Shared by the shortcut and the ⋯ panel row. */
export function openCommandPalette(): void {
  if (!import.meta.client || isOpen.value) return
  if (document.querySelector('.board.dragging, .kando-dnd-dragged')) return
  if (document.querySelector('[role="dialog"]')) return
  const card = findFocusedCard()
  focusedTaskId.value = card?.dataset.taskId ?? null
  returnFocusTo = (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  skipFocusRestore = false
  afterLeave = null
  isOpen.value = true
}

/** For commands registered through `lib/paletteExtensions.ts`: closes the palette; they start their own UI once it is gone. */
export function closeCommandPalette(): void {
  skipFocusRestore = true
  isOpen.value = false
}

export function useCommandPalette(handlers: Pick<PaletteActions, 'openStatistics' | 'openSettings'>) {
  const { t } = useI18n()
  const tasksStore = useTasksStore()
  const { moveTaskToStatus, canMoveToStatus } = useTaskOperations()
  const { deleteTaskWithUndo } = useTaskDeletion()
  const { moveTaskToSource } = useTaskMove()
  const boardStore = useBoardStore()
  const health = useIntegrationHealthStore()
  const notionConfig = useNotionConfigStore()
  const dayClose = useDayClose()
  const appUpdater = useAppUpdater()
  const feedback = isTauri() ? useFeedback() : null
  const whatsNew = useWhatsNew()

  /** Called after the close animation: returns focus to the card unless a command navigated away. */
  function restoreFocus(): void {
    if (afterLeave) {
      const next = afterLeave
      afterLeave = null
      next()
      return
    }
    if (!import.meta.client || skipFocusRestore) return
    const id = focusedTaskId.value
    // The card may have moved columns (new element) or been deleted: look it up again
    const card = (id ? document.querySelector<HTMLElement>(`.task-wrapper[data-task-id="${CSS.escape(id)}"]`) : null)
      ?? (returnFocusTo?.isConnected ? returnFocusTo : null)
    card?.focus()
    focusedTaskId.value = null
  }

  /** Every command closes the palette; focus returns afterwards unless the command navigates. */
  const run = (fn: () => void, { navigates = false } = {}) => () => {
    skipFocusRestore = navigates
    isOpen.value = false
    fn()
  }

  const actions: PaletteActions = {
    addTask: run(() => { void navigateTo('/tasks/add') }, { navigates: true }),
    openStatistics: run(handlers.openStatistics, { navigates: true }),
    openSettings: run(handlers.openSettings, { navigates: true }),
    // The dialog opens only after the palette has left, so two dialogs never overlap and focus
    // falls back to the board instead of the closed palette.
    openDayClose: run(() => { afterLeave = dayClose.open }, { navigates: true }),
    ...(isTauri()
      ? {
          openGithubSettings: run(() => { void navigateTo('/settings/github') }, { navigates: true }),
          openDataFolder: run(() => { void navigateTo('/settings/data') }, { navigates: true }),
          // The check (and the dialog or page it leads to) starts only after the palette has left.
          checkForUpdates: run(() => { afterLeave = () => { void appUpdater.checkManually() } }, { navigates: true }),
          openUpdates: run(() => { void navigateTo('/settings/updates') }, { navigates: true }),
          // Same after-leave pattern as day-close: the dialog opens once the palette is gone.
          sendFeedback: run(() => { afterLeave = () => feedback?.open() }, { navigates: true }),
          openWhatsNew: run(() => { afterLeave = () => { void whatsNew.openReopen() } }, { navigates: true }),
        }
      : { openDataTransfer: run(() => { void navigateTo('/settings/data') }, { navigates: true }) }),
    openDetails: id => run(() => { void navigateTo(`/tasks/${id}`) }, { navigates: true })(),
    moveTo: (id, status) => run(() => { void moveTaskToStatus(id, status) })(),
    setTimebox: (id, seconds) => run(() => tasksStore.updateTask(id, { timeBoxSeconds: seconds }))(),
    setPriority: (id, priority) => run(() => tasksStore.updateTask(id, { priority }))(),
    moveToSource: (id, source) => run(() => { moveTaskToSource(id, source) })(),
    deleteTask: id => run(() => {
      focusedTaskId.value = neighbourCardId(id)
      deleteTaskWithUndo(id)
    })(),
  }

  const groups = computed(() => {
    const task = focusedTaskId.value ? tasksStore.task(focusedTaskId.value) ?? null : null
    return [...buildCommandGroups({
      t: t as Translate,
      task,
      canMove: canMoveToStatus,
      moveTargets: task
        ? buildMoveTargets({
            t: t as Translate,
            task,
            connected: boardStore.connectedIntegrations,
            notionMapping: notionConfig.config?.propertyMapping,
            needsAttention: source => health.needsAttention(source) || (typeof navigator !== 'undefined' && navigator.onLine === false),
          })
        : [],
      actions,
    }), ...paletteExtensionGroups()]
  })

  const hasCard = computed(() => !!focusedTaskId.value && !!tasksStore.task(focusedTaskId.value))

  return { isOpen, groups, hasCard, open: openCommandPalette, restoreFocus }
}
