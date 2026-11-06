/**
 * @composable useTaskSources
 * @description The task source adapter registry (#318): resolves the adapter of a source, wired to the
 * current stores and configs. Adapters are cheap and built per call, so a changed token or Notion config
 * is always picked up. `useTaskSync` and `useIntegrationManager` go through this and never switch on a
 * source name themselves.
 */
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useNotionIntegration } from '~/composables/useNotionIntegration'
import { useNotionDataSource } from '~/composables/useNotionDataSource'
import { LocalSource } from '~/integrations/sources/LocalSource'
import { NotionSource } from '~/integrations/sources/NotionSource'
import { TodoistSource } from '~/integrations/sources/TodoistSource'
import type { TaskSourceAdapter } from '~/integrations/sources/types'
import type { SourceId } from '~/types/taskSource'

export const useTaskSources = () => {
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()
  const notionConfig = useNotionConfigStore()
  const health = useIntegrationHealthStore()

  const adapterFor = (source: SourceId): TaskSourceAdapter => {
    switch (source) {
      case 'local':
        return new LocalSource(() => tasksStore.tasks.filter((task) => task.source === 'local'))
      case 'notion':
        return new NotionSource({
          isConfigured: () => useNotionIntegration().isConfigured.value,
          ensureDataSource: async () => {
            if (notionConfig.hasDataSourceSelected) return true
            return await useNotionDataSource().ensureDataSourceConfigured()
          },
          createInstance: () => useNotionIntegration().createInstance(),
          archiveStatus: () => notionConfig.config?.statusMapping?.archive || null,
          health: () => health.statusOf('notion'),
        })
      case 'todoist':
        return new TodoistSource({
          apiToken: () => boardStore.boardConfig.todoistApiToken,
          health: () => health.statusOf('todoist'),
        })
    }
  }

  return { adapterFor } as const
}
