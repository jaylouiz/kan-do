import { defineStore, acceptHMRUpdate  } from 'pinia';
import { ref, computed } from 'vue';
import { renameInList, type NameKind } from '~/lib/topicNames';
import type { NotionDatabaseSchema, NotionPropertyMapping } from '~/types/notion';

/**
 * Central store for managing select/multi-select property options.
 * Provides instant access to available values for dropdowns without on-the-fly population.
 * Persisted locally and syncs when connection is restored.
 */
export const usePropertyOptionsStore = defineStore('propertyOptions', () => {
  // State for schema-based options (authoritative source)
  const schemaActivityOptions = ref<string[]>([]);
  const schemaTopicOptions = ref<string[]>([]);
  const schemaCustomPropertyOptions = ref<Record<string, string[]>>({});
  const schemaFetchedAt = ref<number | null>(null);

  // Runtime options (from tasks, user input, etc.)
  const activityOptions = ref<string[]>([]);
  const topicOptions = ref<string[]>([]);
  const customPropertyOptions = ref<Record<string, string[]>>({});
  const lastSyncTimestamp = ref<number | null>(null);

  // Getters
  /**
   * Get all options for a custom property (schema + runtime, merged)
   */
  const getCustomPropertyOptions = computed(() => {
    return (propertyKey: string): string[] => {
      const allOptions = new Set<string>();
      // Add schema options first (authoritative)
      schemaCustomPropertyOptions.value[propertyKey]?.forEach(opt => allOptions.add(opt));
      // Add runtime options (might include user-created values)
      customPropertyOptions.value[propertyKey]?.forEach(opt => allOptions.add(opt));
      return [...allOptions].sort();
    };
  });

  /**
   * Get all topic options (schema + runtime, merged)
   */
  const getTopicOptions = computed((): string[] => {
    const allOptions = new Set<string>();
    // Add schema options first (authoritative)
    schemaTopicOptions.value.forEach(opt => allOptions.add(opt));
    // Add runtime options (might include user-created values)
    topicOptions.value.forEach(opt => allOptions.add(opt));
    return [...allOptions].sort();
  });

  /**
   * Get all activity options (schema + runtime, merged)
   */
  const getActivityOptions = computed((): string[] => {
    const allOptions = new Set<string>();
    // Add schema options first (authoritative)
    schemaActivityOptions.value.forEach(opt => allOptions.add(opt));
    // Add runtime options (might include user-created values)
    activityOptions.value.forEach(opt => allOptions.add(opt));
    return [...allOptions].sort();
  });

  // Actions
  /**
   * Initialize options from Notion database schema
   * This is the authoritative source for available options
   */
  function initializeFromSchema(schema: NotionDatabaseSchema, mapping: NotionPropertyMapping) {
    // Clear previous schema options
    schemaActivityOptions.value = [];
    schemaTopicOptions.value = [];
    schemaCustomPropertyOptions.value = {};

    // Read options from schema
    const readOptions = (propertyName: string | null | undefined): string[] => {
      if (!propertyName) return [];
      const def = schema[propertyName];
      if (!def) return [];
      const options = def.select?.options || def.multi_select?.options || [];
      return options
        .map((opt) => opt?.name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
    };

    // Populate schema options
    for (const topic of readOptions(mapping.topic ?? null)) {
      schemaTopicOptions.value.push(topic);
    }

    for (const activity of readOptions(mapping.activity ?? null)) {
      schemaActivityOptions.value.push(activity);
    }

    // Handle custom properties
    if (mapping.customProperties) {
      for (const cfg of mapping.customProperties.filter(c => c.enabled)) {
        const options = readOptions(cfg.name);
        if (options.length > 0) {
          schemaCustomPropertyOptions.value[cfg.key] = options;
        }
      }
    }

    schemaFetchedAt.value = Date.now();
    console.log('[PropertyOptionsStore] Initialized from schema:', {
      activities: schemaActivityOptions.value.length,
      topics: schemaTopicOptions.value.length,
      customProps: Object.keys(schemaCustomPropertyOptions.value).length
    });
  }

  /**
   * Initialize topic and activity from schema (legacy, for backward compatibility)
   */
  function initializeTopicAndActivityFromSchema(schema: NotionDatabaseSchema, mapping: NotionPropertyMapping) {
    // Use the new comprehensive method
    initializeFromSchema(schema, mapping);
  }

  /**
   * Add a new option to a custom property
   * Note: No need to track for sync - Notion automatically creates options when tasks are synced
   */
  function addCustomPropertyOption(propertyKey: string, optionName: string) {
    if (!customPropertyOptions.value[propertyKey]) {
      customPropertyOptions.value[propertyKey] = [];
    }

    if (!customPropertyOptions.value[propertyKey].includes(optionName)) {
      customPropertyOptions.value[propertyKey].push(optionName);
      customPropertyOptions.value[propertyKey].sort();
    }
  }

  /**
   * Add a new topic option
   * Note: No need to track for sync - Notion automatically creates options when tasks are synced
   */
  function addTopicOption(topic: string) {
    if (!topicOptions.value.includes(topic)) {
      topicOptions.value.push(topic);
      topicOptions.value.sort();
    }
  }

  /**
   * Add a new activity option
   * Note: No need to track for sync - Notion automatically creates options when tasks are synced
   */
  function addActivityOption(activity: string) {
    if (!activityOptions.value.includes(activity)) {
      activityOptions.value.push(activity);
      activityOptions.value.sort();
    }
  }

  /**
   * Renames a topic or activity option in the runtime and the schema lists (#430). A target that is already
   * listed makes it a merge: one entry stays. The name cannot come back through `extractOptionsFromTasks`
   * unless a task still carries it, and a rename moves every task.
   */
  function renameOption(kind: NameKind, from: string, to: string) {
    const runtime = kind === 'topic' ? topicOptions : activityOptions;
    const schema = kind === 'topic' ? schemaTopicOptions : schemaActivityOptions;
    for (const list of [runtime, schema]) {
      const renamed = renameInList(list.value, from, to);
      if (renamed !== list.value) list.value = [...renamed];
    }
  }

  /** Whether the Notion schema lists the option (#430): such a name is owned by Notion and cannot be renamed here. */
  function isSchemaOption(kind: NameKind, name: string): boolean {
    const schema = kind === 'topic' ? schemaTopicOptions.value : schemaActivityOptions.value;
    return schema.some(option => option.trim() === name);
  }

  /**
   * Bulk add options from multiple tasks
   * Used when loading tasks from store or external source
   */
  function extractOptionsFromTasks(tasks: Array<{
    topic?: string | null;
    activity?: string | null;
    custom?: Record<string, {
      key: string;
      propType: string;
      value: {
        type: string;
        value?: unknown;
      };
    }>;
  }>) {
    for (const task of tasks) {
      // Extract topics and activities
      if (task.topic) {
        addTopicOption(task.topic);
      }
      if (task.activity) {
        addActivityOption(task.activity);
      }

      // Extract custom property options
      if (task.custom) {
        for (const [key, entry] of Object.entries(task.custom)) {
          if (entry.propType === 'select' && entry.value.type === 'select' && entry.value.value && typeof entry.value.value === 'object' && 'name' in entry.value.value) {
            addCustomPropertyOption(key, String(entry.value.value.name));
          } else if (entry.propType === 'multi_select' && entry.value.type === 'multi_select' && Array.isArray(entry.value.value)) {
            const values = entry.value.value || [];
            for (const option of values) {
              if (option.name) {
                addCustomPropertyOption(key, option.name);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Clear all options, the Notion schema's included (a disconnect, #320). The caller re-extracts what the
   * remaining tasks use.
   */
  function clearAllOptions() {
    schemaActivityOptions.value = [];
    schemaTopicOptions.value = [];
    schemaCustomPropertyOptions.value = {};
    schemaFetchedAt.value = null;
    customPropertyOptions.value = {};
    topicOptions.value = [];
    activityOptions.value = [];
    lastSyncTimestamp.value = null;
  }

  /**
   * Merge options from external source (e.g., after reconnecting)
   * Simply combines local and external options
   */
  function mergeWithExternalOptions(external: {
    customProperties?: Record<string, string[]>;
    topics?: string[];
    activities?: string[];
  }) {
    // Merge custom properties
    if (external.customProperties) {
      for (const [key, externalOptions] of Object.entries(external.customProperties)) {
        const localOptions = customPropertyOptions.value[key] || [];
        const merged = new Set([...externalOptions, ...localOptions]);
        customPropertyOptions.value[key] = Array.from(merged).sort();
      }
    }

    // Merge topics
    if (external.topics) {
      const merged = new Set([...external.topics, ...topicOptions.value]);
      topicOptions.value = Array.from(merged).sort();
    }

    // Merge activities
    if (external.activities) {
      const merged = new Set([...external.activities, ...activityOptions.value]);
      activityOptions.value = Array.from(merged).sort();
    }

    lastSyncTimestamp.value = Date.now();
  }

  /**
   * Check if schema is fresh (not stale)
   */
  function isSchemaFresh(staleTimeMs: number = 5 * 60 * 1000): boolean {
    if (!schemaFetchedAt.value) return false;
    return Date.now() - schemaFetchedAt.value < staleTimeMs;
  }

  /**
   * Mark schema as stale to force refresh
   */
  function markSchemaStale(): void {
    schemaFetchedAt.value = null;
  }

  /**
   * Check if we have any options at all
   */
  const hasAnyOptions = computed(() => {
    return schemaActivityOptions.value.length > 0 ||
           schemaTopicOptions.value.length > 0 ||
           activityOptions.value.length > 0 ||
           topicOptions.value.length > 0;
  });

  return {
    // State
    activityOptions: computed(() => getActivityOptions.value),
    topicOptions: computed(() => getTopicOptions.value),
    customPropertyOptions: computed(() => customPropertyOptions.value),
    lastSyncTimestamp,

    // Getters (merged options)
    getActivityOptions,
    getTopicOptions,
    getCustomPropertyOptions,

    // Actions
    initializeFromSchema,
    initializeTopicAndActivityFromSchema,
    addCustomPropertyOption,
    addTopicOption,
    addActivityOption,
    renameOption,
    isSchemaOption,
    extractOptionsFromTasks,
    clearAllOptions,
    mergeWithExternalOptions,
    isSchemaFresh,
    markSchemaStale,
    hasAnyOptions,
  };
}, {
  persist: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePropertyOptionsStore, import.meta.hot));
}
