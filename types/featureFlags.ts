/**
 * Global feature flag definitions.
 */
export interface FeatureFlags {
  /** 
   * Enables the data source seleciton in addtion to database selection in the Notion setup 
   */
  notionDataSourceSelection: boolean;
  /**
   * Enables the add task shortcut in the open column.
   */
  openColumnAddButton: boolean;
}
