import { useNotionConfigStore } from "~/store/notionConfig";
import type { NotionDatabaseSummary } from "~/types/notion";
import { useErrorHandler } from "~/composables/useErrorHandler";
import { NotionClientAPI } from "~/integrations/NotionClientAPI";
import { translate } from "~/lib/i18n";

/**
 * Provides helpers to ensure a Notion data source is selected for the configured database.
 */
export const useNotionDataSource = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const notionConfig = useNotionConfigStore();
  const { handleError } = useErrorHandler();

  const ensureDataSourceConfigured = async (): Promise<boolean> => {
    if (!notionConfig.config) {
      return false;
    }

    if (notionConfig.config.dataSourceId) {
      return true;
    }

    try {
      const api = new NotionClientAPI(notionConfig.config.token);
      
      // Search for databases
      const dbResponse = await api.searchDatabases();

      // Check if server proxy already returned pre-processed DatabaseSummary objects
      // (browser mode returns processed data, Tauri mode returns raw Notion API data)
      const firstResult = dbResponse.results[0] as NotionDatabaseSummary | { object?: string; title?: unknown[] } | undefined;
      const isPreProcessed = firstResult && 'dataSources' in firstResult && typeof (firstResult as NotionDatabaseSummary).title === 'string';
      
      let databases: NotionDatabaseSummary[];
      
      if (isPreProcessed) {
        // Server proxy already processed the data - use it directly
        databases = dbResponse.results as NotionDatabaseSummary[];
      } else {
        // Raw Notion API response (Tauri mode) - process it ourselves
        const dsResponse = await api.searchDataSources();
        
        // Build a map of database_id -> data sources
        const dataSourcesByDb = new Map<string, Array<{ id: string; name: string | null; databaseId: string; databaseTitle: string }>>();
        
        for (const ds of dsResponse.results as Array<{ id: string; object: string; name?: string; location?: { database_id?: string }; parent?: { database_id?: string } }>) {
          if (ds?.object !== 'data_source') continue;
          const dsId = ds.id;
          const dsName = ds.name ?? null;
          let databaseId = ds.location?.database_id;
          
          if (!databaseId && dsId) {
            try {
              const details = await api.getDataSource(dsId);
              databaseId = details.location?.database_id || details.parent?.database_id;
            } catch {
              // Ignore errors
            }
          }
          
          if (!databaseId) continue;
          
          const existing = dataSourcesByDb.get(databaseId) || [];
          existing.push({ id: dsId, name: dsName, databaseId, databaseTitle: '' });
          dataSourcesByDb.set(databaseId, existing);
        }

        // Build database summaries
        databases = [];
        
        for (const db of dbResponse.results as Array<{ id: string; object: string; title?: Array<{ plain_text?: string }> }>) {
          if (db?.object !== 'database') continue;
          const dbId = db.id;
          const title = db.title?.map((t) => t.plain_text).join('') || 'Untitled Database';
          
          const dataSources = (dataSourcesByDb.get(dbId) || []).map(ds => ({
            ...ds,
            databaseTitle: title,
          }));
          
          databases.push({ id: dbId, title, dataSources });
        }
      }

      const match = databases.find((db) => db.id === notionConfig.config?.databaseId);

      if (!match) {
        handleError(
          translate('notion.dataSource.databaseNotFound'),
          "notion_setup"
        );
        return false;
      }

      if (!match.dataSources || match.dataSources.length === 0) {
        handleError(
          translate('notion.dataSource.noDataSources'),
          "notion_setup"
        );
        return false;
      }

      const selectedDataSource = match.dataSources[0];
      if (!selectedDataSource) {
        handleError(
          translate('notion.dataSource.noneFound'),
          "notion_setup"
        );
        return false;
      }

      notionConfig.updateDataSource(selectedDataSource.id, selectedDataSource.name ?? null);
      return true;
    } catch (error) {
      handleError(error as Error, "notion_setup");
      return false;
    }
  };

  return { ensureDataSourceConfigured };
};
