<!--
@component DatabaseSelectionStep
@kind component
@category input
@description Step for selecting a Notion database during setup
@usage Used in the Notion setup wizard
@avoid Only a step of the Notion setup wizard.
@responsibility
- Displays available Notion databases for selection
- Manages the selected database state
- Communicates selection changes to parent component
-->
<template>
  <div class="space-y-4">
    <!-- Database Selection Step -->
    <UFormField :label="t('notion.database.selectLabel')">
      <!-- Show databases if available -->
      <div v-if="formattedDatabases.length > 0">
        <USelect
          :key="databasesUpdatedKey"
          v-model="selectedDatabaseId"
          :items="formattedDatabases"
          option-attribute="label"
          value-attribute="value"
          :placeholder="t('notion.database.selectPlaceholder')"
          class="w-full"
        />
      </div>
      
      <!-- Show loading state -->
      <div v-else-if="loading" class="flex items-center space-x-2 text-toned">
        <div class="size-4  animate-spin rounded-full border-b-2 border-primary" />
        <span>{{ t('notion.database.loading') }}</span>
      </div>
      
      <!-- Show error state -->
      <div v-else-if="error" class="text-error-600">
        <p class="text-sm">{{ error }}</p>
        <p class="mt-1 text-xs text-toned">{{ t('notion.database.errorHint') }}</p>
      </div>
      
      <!-- Show empty state -->
      <div v-else class="text-toned">
        <p class="text-sm">{{ t('notion.database.empty') }}</p>
        <p class="mt-1 text-xs text-toned">{{ t('notion.database.emptyHint') }}</p>
      </div>
    </UFormField>

    <UFormField
      v-if="showDataSourceSelection && selectedDatabaseDataSources.length > 0"
      :label="t('notion.database.dataSourceLabel')"
      :description="t('notion.database.dataSourceDescription')"
    >
      <USelect
        :key="dataSourcesUpdatedKey"
        v-model="selectedDataSourceId"
        :items="formattedDataSources"
        option-attribute="label"
        value-attribute="value"
        :placeholder="t('notion.database.dataSourcePlaceholder')"
        class="w-full"
      />
    </UFormField>

    <div
      v-else-if="showDataSourceSelection && selectedDatabaseId"
      class="rounded border border-dashed border-accented p-3 text-sm text-toned"
    >
      {{ t('notion.database.noDataSourcesSelectable') }}
    </div>

    <div
      v-else-if="!showDataSourceSelection && selectedDatabaseId && selectedDatabaseDataSources.length === 0"
      class="rounded border border-dashed border-accented p-3 text-sm text-toned"
    >
      {{ t('notion.database.noDataSources') }}
    </div>
    <p
      v-else-if="!showDataSourceSelection && selectedDatabaseId && selectedDatabaseDataSources.length > 1"
      class="text-xs text-toned"
    >
      {{ t('notion.database.allDataSourcesUsed') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { NotionDatabaseSummary } from "~/types/notion";
import { useFeatureFlags } from "~/utils/featureFlags";

defineOptions({ name: 'NotionDatabaseSelectionStep' });

/**
 * Props
 * @prop {NotionDatabaseSummary[]} databases List of available Notion databases with data sources
 * @prop {string} selectedDatabase Currently selected database ID
 * @prop {string} selectedDataSource Currently selected data source ID
 * @prop {boolean=} loading Whether databases are currently being loaded
 * @prop {string=} error Error message if database loading failed
 */
const props = defineProps<{
  /** List of available Notion databases with their data sources */
  databases: NotionDatabaseSummary[];
  /** Currently selected database ID */
  selectedDatabase: string;
  /** Currently selected data source ID */
  selectedDataSource: string;
  /** Whether databases are currently being loaded */
  loading?: boolean;
  /** Error message if database loading failed */
  error?: string;
}>();

const emit = defineEmits<{
  (e: "update:selectedDatabase" | "update:selectedDataSource", value: string): void;
}>();

const { t } = useI18n();
const featureFlags = useFeatureFlags();

const showDataSourceSelection = computed(() => featureFlags.notionDataSourceSelection);

/**
 * Two-way binding for the selected database
 * Updates parent component when selection changes
 */
const selectedDatabaseId = ref(props.selectedDatabase);
const selectedDataSourceId = ref(props.selectedDataSource);

watch(() => props.selectedDatabase, (newVal) => {
  // Keep local selection in sync if parent changes
  selectedDatabaseId.value = newVal;
});

watch(() => props.selectedDataSource, (newVal) => {
  selectedDataSourceId.value = newVal;
});

// 2. Transform databases to use 'label' and 'value'
const formattedDatabases = computed(() => {
  return props.databases.map(db => ({
    label: db.title,
    value: db.id
  }));
});

const selectedDatabaseDataSources = computed(() => {
  const db = props.databases.find(db => db.id === selectedDatabaseId.value);
  return db?.dataSources ?? [];
});

const formattedDataSources = computed(() => selectedDatabaseDataSources.value.map((ds) => ({
  label: ds.name ?? t('notion.database.unnamedDataSource'),
  value: ds.id,
})));

const databasesUpdatedKey = ref(0);
const dataSourcesUpdatedKey = ref(0);

watch(() => props.databases, (newDatabases, oldDatabases) => {
  if (import.meta.dev) {
    console.log(
      'DatabaseSelectionStep props.databases watcher. New raw:',
      newDatabases ? JSON.stringify(newDatabases) : 'undefined',
      'Old raw:',
      oldDatabases ? JSON.stringify(oldDatabases) : 'undefined'
    );
  }
  if (newDatabases && newDatabases.length > 0) {
    if (!oldDatabases || oldDatabases.length === 0 || JSON.stringify(newDatabases) !== JSON.stringify(oldDatabases)) {
        databasesUpdatedKey.value++;
        if (import.meta.dev) {
          console.log(`Databases prop updated. Incrementing key for USelect to: ${databasesUpdatedKey.value}`);
        }
        nextTick(() => {
          if (import.meta.dev) {
            console.log('Formatted databases for USelect (nextTick):', JSON.stringify(formattedDatabases.value, null, 2));
          }
        });
    }
  }
  // if select input had no selection yet, pre-select first database (if available)
  if (!selectedDatabaseId.value && Array.isArray(newDatabases) && newDatabases.length > 0) {
    selectedDatabaseId.value = newDatabases[0]?.id ?? "";
    emit("update:selectedDatabase", selectedDatabaseId.value);
  }
}, { deep: true, immediate: true }); // immediate: true to run on component mount

watch(selectedDatabaseId, (newVal) => {
  emit("update:selectedDatabase", newVal || "");
  const dataSources = selectedDatabaseDataSources.value;
  if (dataSources.length > 0) {
    const nextDataSource = dataSources.find((ds) => ds.id === selectedDataSourceId.value) ?? dataSources[0] ?? null;
    if (nextDataSource && selectedDataSourceId.value !== nextDataSource.id) {
      selectedDataSourceId.value = nextDataSource.id;
    }
  } else {
    selectedDataSourceId.value = "";
  }
  dataSourcesUpdatedKey.value++;
});

watch(selectedDataSourceId, (newVal) => {
  emit("update:selectedDataSource", newVal || "");
});
</script>
