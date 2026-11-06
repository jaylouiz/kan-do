import { Accessibility, KeyboardSensor, PointerSensor, type DragDropManagerInput } from '@dnd-kit/dom'
import { isSortable } from '@dnd-kit/vue/sortable'
import { useTasksStore } from '~/store/tasks'
import { translate } from '~/lib/i18n'
import { stackAccessibleName } from '~/utils/stackAccessibleName'
import { TaskStatus } from '~/types/taskStatus'

/** Minimal shapes of the dnd-kit entities the announcements read (avoids `any`). */
interface AnnouncedStack { key: string, label: string, taskIds: string[] }
interface AnnouncedEntity { id: string | number, data?: { taskStatus?: TaskStatus, stack?: AnnouncedStack } }
interface AnnouncementEvent {
  operation: { source: AnnouncedEntity | null, target?: AnnouncedEntity | null }
  canceled?: boolean
}

const COLUMN_KEYS: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.Open]: 'board.columns.open',
  [TaskStatus.Progress]: 'board.columns.progress',
  [TaskStatus.Waiting]: 'board.columns.waiting',
  [TaskStatus.Done]: 'board.columns.done',
}

/**
 * Localised dnd-kit screen reader support for the board (issue #32).
 * Returns `plugins` / `sensors` customizers for `DragDropProvider`:
 * - live-region announcements name the task title and column instead of raw ids; a collapsed stack
 *   is named by its accessible name ("<front title>, Hoch, 3 tasks") and says it moves with all its tasks (#150)
 * - keyboard drag starts with Space only, so Enter stays free to open the task details (a stack:
 *   to expand it)
 * - a press on a stack's control needs the delay and distance dnd-kit asks for a drag off a handle
 *   (taken from `PointerSensor.defaults`): the control is a handle, which dnd-kit would start
 *   dragging at once for a mouse, and a plain click must still expand
 * Announcements are pure reads; store updates stay in `useBoardDndKit().onDragEnd`.
 */
export function useBoardAnnouncements() {
  const tasksStore = useTasksStore()

  const title = (entity: AnnouncedEntity) => {
    const stack = entity.data?.stack
    if (stack) {
      const frontTitle = tasksStore.tasks.find(t => t.id === stack.taskIds[0])?.title
      return stackAccessibleName(translate, { frontTitle, group: stack.label, count: stack.taskIds.length })
    }
    return tasksStore.tasks.find(t => t.id === String(entity.id))?.title ?? String(entity.id)
  }

  const columnName = (status: TaskStatus | undefined) => {
    const key = status === undefined ? undefined : COLUMN_KEYS[status]
    return key ? translate(key) : ''
  }

  /** Column + 1-based position of a sortable (or the column of a drop zone). While dragging, `dragover` announces the hovered target because dnd-kit moves the source only afterwards. */
  function where(entity: AnnouncedEntity | null) {
    if (!entity) return { column: '', position: 0 }
    if (isSortable(entity as never)) {
      const s = entity as unknown as { group: TaskStatus, index: number }
      return { column: columnName(s.group), position: s.index + 1 }
    }
    // ColumnDropZone (empty column): only the column is known
    return { column: columnName(entity.data?.taskStatus), position: 1 }
  }

  const announcements = {
    dragstart({ operation: { source } }: AnnouncementEvent) {
      if (!source) return undefined
      const { column, position } = where(source)
      const key = source.data?.stack ? 'board.dnd.pickedUpStack' : 'board.dnd.pickedUp'
      return translate(key, { title: title(source), column, position })
    },
    dragover({ operation: { source, target } }: AnnouncementEvent) {
      if (!source || !target || source.id === target.id) return undefined
      const { column, position } = where(target)
      return translate('board.dnd.movedTo', { title: title(source), column, position })
    },
    dragend({ operation: { source }, canceled }: AnnouncementEvent) {
      if (!source) return undefined
      if (canceled) {
        const initial = isSortable(source as never)
          ? columnName((source as unknown as { initialGroup: TaskStatus }).initialGroup)
          : ''
        return translate('board.dnd.cancelled', { title: title(source), column: initial })
      }
      const { column, position } = where(source)
      return translate('board.dnd.dropped', { title: title(source), column, position })
    },
  }

  type Plugins = Extract<NonNullable<DragDropManagerInput['plugins']>, (...args: never[]) => unknown>
type Sensors = Extract<NonNullable<DragDropManagerInput['sensors']>, (...args: never[]) => unknown>

  const plugins: Plugins = defaults => [
    ...defaults.filter(p => p !== Accessibility),
    Accessibility.configure({
      announcements: announcements as never,
      screenReaderInstructions: { draggable: translate('board.dnd.instructions') },
    }),
  ]

  const sensors: Sensors = defaults =>
    defaults.map((s) => {
      if (s === KeyboardSensor) {
        return KeyboardSensor.configure({
          keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ['Space'] },
        })
      }
      if (s === PointerSensor) {
        return PointerSensor.configure({
          activationConstraints(event, source) {
            const defaultConstraints = PointerSensor.defaults.activationConstraints
            const defaultsFor = (e: PointerEvent) =>
              typeof defaultConstraints === 'function' ? defaultConstraints(e, source) : defaultConstraints
            const constraints = defaultsFor(event)
            // dnd-kit starts a mouse drag on a handle without any constraint: not on a stack's
            // control, where a click expands. The drag then needs what a drag off the handle needs
            // (read from the defaults with an event that is not on the handle, so the values follow
            // dnd-kit), whichever pointer type came without a constraint.
            if (constraints === undefined && (source.data as { stack?: unknown } | undefined)?.stack) {
              return defaultsFor({ pointerType: event.pointerType, target: null, defaultPrevented: false } as PointerEvent)
            }
            return constraints
          },
        })
      }
      return s
    })

  return { plugins, sensors }
}
