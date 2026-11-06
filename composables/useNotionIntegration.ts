/**
 * @composable useNotionIntegration
 * @description Factory composable for creating NotionIntegration instances.
 * Centralizes the 6-parameter construction pattern used across the codebase.
 */
import { computed } from 'vue';
import { NotionIntegration } from '~/integrations/NotionIntegration';
import { useNotionConfigStore } from '~/store/notionConfig';
import { LocalizedError } from '~/lib/errorMessages';

/**
 * Factory composable for NotionIntegration instances.
 * Provides a single point of instantiation to avoid parameter duplication.
 */
export function useNotionIntegration() {
  const notionConfig = useNotionConfigStore();

  /**
   * Creates a new NotionIntegration instance using the current store configuration.
   * @throws Error if Notion is not configured
   * @returns NotionIntegration instance
   */
  const createInstance = (): NotionIntegration => {
    if (!notionConfig.isConfigured || !notionConfig.config) {
      throw new LocalizedError('errors.notionNotConfiguredShort');
    }

    return new NotionIntegration(
      notionConfig.config.token,
      notionConfig.config.databaseId,
      notionConfig.config.propertyMapping,
      notionConfig.config.statusMapping,
      notionConfig.config.priorityMapping,
      notionConfig.config.dataSourceId ?? null,
    );
  };

  /**
   * Checks if Notion integration is properly configured
   */
  const isConfigured = computed(() => notionConfig.isConfigured);

  /**
   * Access to the raw config for conditional checks
   */
  const config = computed(() => notionConfig.config);

  return {
    createInstance,
    isConfigured,
    config,
  };
}
