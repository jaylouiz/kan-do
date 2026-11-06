import { ref, computed } from "vue";
import { useNotionConfigStore } from "~/store/notionConfig";
import { useNotionIntegration } from '~/composables/useNotionIntegration';
import { useNotionDataSource } from "~/composables/useNotionDataSource";
import type { NotionIntegration } from "~/integrations/NotionIntegration";

export function useTaskService() {
  // Move store calls inside function to prevent module-level circular dependencies
  const notionConfig = useNotionConfigStore();
  const taskService = ref<NotionIntegration | null>(null);
  const { ensureDataSourceConfigured } = useNotionDataSource();

  const isConfigured = computed(() => {
    return notionConfig.isConfigured;
  });

  const initializeTaskService = async () => {
    if (!notionConfig.config) {
      return;
    }

    if (!notionConfig.hasDataSourceSelected) {
      // Attempt to auto-migrate legacy configs that lack a data source selection
      const success = await ensureDataSourceConfigured();
      if (!success || !notionConfig.hasDataSourceSelected) {
        return;
      }
    }

    const { createInstance } = useNotionIntegration();
    taskService.value = createInstance();
  };

  // Initialize on creation if config exists
  if (notionConfig.isConfigured) {
    void initializeTaskService();
  }

  return {
    taskService,
    isConfigured,
    initializeTaskService,
  };
}
