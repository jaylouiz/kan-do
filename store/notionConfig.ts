import { defineStore, acceptHMRUpdate  } from "pinia";
import { ref, computed, nextTick  } from "vue";
import type { NotionConfig } from "@/types/notion";
import { useStatisticsBackfill } from '@/composables/useStatisticsBackfill';
import { persistOmitFor } from '~/lib/secrets';
import { useSecrets } from '~/composables/useSecrets';
import { useErrorHandler } from '~/composables/useErrorHandler';

export const useNotionConfigStore = defineStore("notionConfig", () => {
  // State
  const config = ref<NotionConfig | null>(null);

  // Getters
  const isConfigured = computed(() => {
    return (
      config.value !== null &&
      !!config.value.token &&
      !!config.value.databaseId &&
      !!config.value.propertyMapping
    );
  });

  const hasDataSourceSelected = computed(() => {
    return !!config.value?.dataSourceId;
  });

  const needsDataSourceMigration = computed(() => {
    return !!config.value && !config.value.dataSourceId;
  });

  // Actions
  function setConfig(configValue: NotionConfig) {
    const hadConfig = !!config.value;
    const hadArchiveStatus = !!config.value?.statusMapping?.archive;
    const hasArchiveStatus = !!configValue?.statusMapping?.archive;
    
    config.value = configValue;
    
    // Trigger backfill if archive status was newly configured or config changed
    // Only run if we have a dataSourceId (required for fetching archived tasks)
    if (import.meta.client && hasArchiveStatus && configValue.dataSourceId && (!hadConfig || hadArchiveStatus !== hasArchiveStatus)) {
      // Use nextTick to ensure store is updated before triggering backfill
      nextTick(() => {
        const { runConfigChangeBackfill } = useStatisticsBackfill();
        runConfigChangeBackfill().catch(error => {
          console.warn('Failed to trigger statistics backfill after config change:', error);
        });
      });
    }
  }

  function updateDataSource(dataSourceId: string, dataSourceName?: string | null) {
    if (!config.value) {
      throw new Error("Cannot update data source without existing Notion config");
    }
    
    const hadDataSource = !!config.value.dataSourceId;
    const hasArchiveStatus = !!config.value.statusMapping?.archive;
    
    config.value = {
      ...config.value,
      dataSourceId,
      dataSourceName: dataSourceName ?? config.value.dataSourceName ?? null,
    };
    
    // Trigger backfill if we just set the dataSourceId and archive status is configured
    if (import.meta.client && !hadDataSource && hasArchiveStatus && dataSourceId) {
      nextTick(() => {
        const { runConfigChangeBackfill } = useStatisticsBackfill();
        runConfigChangeBackfill().catch(error => {
          console.warn('Failed to trigger statistics backfill after data source update:', error);
        });
      });
    }
  }

  /**
   * Drops the config and, on desktop, the Keychain entry. The delete is awaited first: if it fails the
   * config stays as it was (reported via useErrorHandler, returns false), so the app never shows
   * "reset" while the token is still stored, and a slow delete cannot finish after a new token was saved.
   */
  async function clearConfig(): Promise<boolean> {
    const secrets = useSecrets();
    if (secrets.available) {
      try {
        await secrets.remove('notion-token');
      } catch (error) {
        useErrorHandler().handleError(error as Error, 'secrets_reset');
        return false;
      }
    }
    config.value = null;
    return true;
  }

  /**
   * Helper for legacy persisted configs that might be missing the new dataSource fields.
   * Returns true if a migration is required before the integration can operate.
   */
  function checkNeedsDataSourceMigration(): boolean {
    return !!config.value && !config.value.dataSourceId;
  }

  /**
   * Fix missing propertyType in unplanned mapping.
   * Call this if you get "Tags is expected to be multi_select" errors.
   */
  function fixUnplannedPropertyType(propertyType: 'select' | 'multi_select' | 'rich_text' | 'title') {
    if (!config.value?.propertyMapping.unplanned) {
      console.warn('[NotionConfig] No unplanned mapping to fix');
      return;
    }

    config.value.propertyMapping.unplanned.propertyType = propertyType;
    console.log(`[NotionConfig] Updated unplanned mapping propertyType to: ${propertyType}`);
  }

  return {
    // State
    config,
    
    // Getters
    isConfigured,
    hasDataSourceSelected,
    needsDataSourceMigration,
    
    // Actions
    setConfig,
    updateDataSource,
    clearConfig,
    checkNeedsDataSourceMigration,
    fixUnplannedPropertyType,
  };
}, {
  // The token lives in the Keychain on desktop (ADR 007), so it is omitted from the persisted blob there.
  persist: { omit: persistOmitFor('notionConfig') },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useNotionConfigStore, import.meta.hot));
}
