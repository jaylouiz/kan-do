/**
 * @composable useAddTarget
 * @description The source a new task is saved to (#321), shared by the add page and the "Speichern in" switch
 * in the sheet footer.
 * @responsibility
 * - `availableSources`: Local plus every connected source that can create tasks; `defaultSource` is the
 *   board's default among them (Local when the default cannot create)
 * - `targetSource`: the chosen target, reset to the default each time the add sheet opens and whenever
 *   `?mode=adhoc` toggles; never persisted
 * - `isSwitchVisible`: add route, not ad-hoc, 2+ available sources (one source: the form is as before)
 * - Singleton, module-level state like `useTaskDraft` and `useModalFooter`
 */
import { computed, ref } from 'vue'
import { useRoute } from 'nuxt/app'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { sourceCanCreate } from '~/lib/taskSources'
import type { SourceId } from '~/types/taskSource'

const chosen = ref<SourceId | null>(null)

export function useAddTarget() {
  const boardStore = useBoardStore()
  const health = useIntegrationHealthStore()
  const route = useRoute()
  const { draftSaving } = useTaskDraft()

  const availableSources = computed<SourceId[]>(() => [
    'local',
    ...boardStore.connectedIntegrations.filter(sourceCanCreate),
  ])

  const defaultSource = computed<SourceId>(() => {
    const wanted = boardStore.defaultSource
    return wanted && availableSources.value.includes(wanted) ? wanted : 'local'
  })

  /** The chosen target; the default until the user picks one, and again when the chosen source is gone */
  const targetSource = computed<SourceId>(() =>
    chosen.value && availableSources.value.includes(chosen.value) ? chosen.value : defaultSource.value,
  )

  const isAdHoc = computed(() => route.query.mode === 'adhoc')
  const isSwitchVisible = computed(
    () => route.name === 'tasks-add' && !isAdHoc.value && availableSources.value.length > 1,
  )

  /** The picker stays visible but locked while the save runs */
  const isSaving = computed(() => draftSaving.value)

  const setTarget = (source: SourceId) => {
    if (availableSources.value.includes(source)) chosen.value = source
  }
  const resetTarget = () => {
    chosen.value = null
  }

  /** A connected source that cannot sync right now: still selectable, its tasks are saved later */
  const needsAttention = (source: SourceId): boolean => health.needsAttention(source)

  return {
    availableSources,
    defaultSource,
    targetSource,
    isSwitchVisible,
    isSaving,
    setTarget,
    resetTarget,
    needsAttention,
  } as const
}
