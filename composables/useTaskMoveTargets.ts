/**
 * @composable useTaskMoveTargets
 * @description The "Verschieben nach …" entries of one task (#322): the other connected sources with their
 * icon, name and hint. The card context menu, the detail dropdown and the command palette only render this
 * list, so the three surfaces never disagree. `buildMoveTargets` is pure (unit-testable); the composable wires
 * it to the stores.
 * @responsibility Which sources are offered, their hint and disabled state; running the move is useTaskMove.
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useTaskMove } from '~/composables/useTaskMove'
import { isIntegrationSourceId, sourceCanCreate } from '~/lib/taskSources'
import { lostFieldsForMove } from '~/utils/moveFields'
import { SOURCE_META } from '~/utils/sourceMeta'
import type { NotionPropertyMapping } from '~/types/notion'
import type { Task } from '~/types/task'
import type { IntegrationSourceId, SourceId } from '~/types/taskSource'

type Translate = (key: string, ...args: unknown[]) => string

export interface MoveTarget {
  source: SourceId
  /** Display name ("Lokal", "Notion") */
  name: string
  icon: string
  /** Muted second line; empty when there is nothing to say */
  hint: string
  /** Set while the task has a move that is not finished */
  disabled: boolean
}

export interface BuildMoveTargetsInput {
  t: Translate
  task: Task
  /** The connected integrations; Local is always a possible target */
  connected: readonly IntegrationSourceId[]
  notionMapping: NotionPropertyMapping | null | undefined
  /** Whether a target is offline or needs attention; the move then waits and the entry says so */
  needsAttention: (source: SourceId) => boolean
}

/**
 * The sources `task` can move to: every other connected source (Local always), none where the source cannot
 * create tasks yet. Empty when only one source is connected, so the surfaces show no entry at all.
 */
export function buildMoveTargets({ t, task, connected, notionMapping, needsAttention }: BuildMoveTargetsInput): MoveTarget[] {
  const candidates: SourceId[] = ['local', ...connected]
  const pending = task.pendingMove !== undefined
  return candidates
    .filter(source => source !== task.source && sourceCanCreate(source))
    .map((source): MoveTarget => {
      const hints: string[] = []
      if (pending) {
        hints.push(t('task.move.hintPending'))
      } else {
        const lost = lostFieldsForMove(task, source, notionMapping)
        if (lost > 0) hints.push(t('task.move.hintLost', lost))
        if (isIntegrationSourceId(source) && needsAttention(source)) hints.push(t('task.move.hintAttention'))
      }
      return { source, name: t(SOURCE_META[source].nameKey), icon: SOURCE_META[source].icon, hint: hints.join(' · '), disabled: pending }
    })
}

export function useTaskMoveTargets(task: MaybeRefOrGetter<Task | null>) {
  const { t } = useI18n()
  const boardStore = useBoardStore()
  const health = useIntegrationHealthStore()
  const notionConfig = useNotionConfigStore()
  const { moveTaskToSource } = useTaskMove()

  const targets = computed((): MoveTarget[] => {
    const current = toValue(task)
    if (!current) return []
    return buildMoveTargets({
      t: t as Translate,
      task: current,
      connected: boardStore.connectedIntegrations,
      notionMapping: notionConfig.config?.propertyMapping,
      needsAttention: source => health.needsAttention(source) || (typeof navigator !== 'undefined' && navigator.onLine === false),
    })
  })

  const move = (source: SourceId): boolean => {
    const current = toValue(task)
    return current ? moveTaskToSource(current.id, source) : false
  }

  return { targets, move }
}
