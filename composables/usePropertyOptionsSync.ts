/**
 * @composable usePropertyOptionsSync
 * @description Manages property options synchronization with Notion schema
 * Handles background fetching, caching, and merging of property options
 */
import { computed } from 'vue';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import { useNotionConfigStore } from '~/store/notionConfig';
import { useNotionIntegration } from '~/composables/useNotionIntegration';
import { useIntegrationHealthStore } from '~/store/integrationHealth';
import { classifySyncFailure } from '~/lib/integrationHealth';

export const usePropertyOptionsSync = () => {
  const propertyOptionsStore = usePropertyOptionsStore();
  const notionConfigStore = useNotionConfigStore();
  const health = useIntegrationHealthStore();
  
  // Time in milliseconds after which schema is considered stale
  const SCHEMA_STALE_TIME = 5 * 60 * 1000; // 5 minutes
  
  /**
   * Fetches property options from Notion schema in the background
   * Non-blocking - doesn't throw errors, records them in the source's health
   */
  const fetchSchemaOptions = async () => {
    // Only fetch if Notion is configured
    if (!notionConfigStore.isConfigured || !notionConfigStore.config) {
      return;
    }
    
    // Don't refetch if schema is fresh
    if (propertyOptionsStore.isSchemaFresh(SCHEMA_STALE_TIME)) {
      return;
    }
    
    try {
      const { createInstance } = useNotionIntegration();
      const notion = createInstance();
      
      // Fetch database schema
      const databaseId = notionConfigStore.config.databaseId;
      const schema = await notion.getDatabaseSchema(databaseId, { report: false });
      
      // Initialize options from schema
      propertyOptionsStore.initializeFromSchema(
        schema,
        notionConfigStore.config.propertyMapping
      );
      
      console.log('[PropertyOptionsSync] Schema options fetched and cached');
    } catch (error) {
      // Silent fail - task-based options will still work. The failure is Notion's state, shown by the sync
      // button (a rejected token is "broken" there): no toast and no setup dialog from a background read (#341).
      // A rejected token or no connection is the source's state; any other failure of this one read is not.
      if (classifySyncFailure(error) !== 'degraded') health.recordFailure('notion', error);
      console.warn('[PropertyOptionsSync] Failed to fetch schema options:', error);
    }
  };
  
  /**
   * Ensures options are available when needed
   * Triggers background refresh if stale
   */
  const ensureOptionsAvailable = () => {
    // Always have task-based options as fallback
    if (propertyOptionsStore.hasAnyOptions) {
      // Options exist, but check if we should refresh in background
      if (!propertyOptionsStore.isSchemaFresh(SCHEMA_STALE_TIME)) {
        // Fire and forget background refresh
        fetchSchemaOptions();
      }
    } else {
      // No options at all, try to fetch from schema immediately
      // but still don't block UI
      fetchSchemaOptions();
    }
  };
  
  /**
   * Force refresh schema options
   * Used when user explicitly updates settings or if options seem outdated
   */
  const refreshSchemaOptions = async () => {
    propertyOptionsStore.markSchemaStale();
    await fetchSchemaOptions();
  };
  
  return {
    fetchSchemaOptions,
    ensureOptionsAvailable,
    refreshSchemaOptions,
    isSchemaStale: computed(() => 
      !propertyOptionsStore.isSchemaFresh(SCHEMA_STALE_TIME)
    ),
  };
};
