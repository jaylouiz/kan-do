<!--
@component NotionSettingsPage
@description Dedicated settings page for Notion integration configuration
@usage Accessed via /settings/notion for users with an existing Notion integration
@responsibility
- Provides tabbed navigation (`UTabs`, the shared tab look, #557) to different configuration sections
- Desktop (>= 768px): vertical list beside the panel, sticky below the app bar and its veil. Phone (#625): horizontal
  list above a full-width panel (the vertical list left the panel ~100px); the list scrolls sideways inside itself,
  keeps the active tab in view and is not sticky (a short row; the phone bar is at the bottom, so there is no offset
  to stick at). The `orientation` prop follows the breakpoint, so the arrow keys match what is seen
- Without an integration: one muted sentence and a soft button to the settings (no warning block)
- Allows direct access to specific settings without wizard flow
- Manages save/cancel actions per section
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <template #actions>
        <UButton
          v-if="isDesktop"
          to="/settings/data"
          color="neutral"
          variant="ghost"
          icon="i-ph-folder-open"
          data-testid="notion-data-link"
        >
          {{ t('settings.data.link') }}
        </UButton>
      </template>

      <!-- Main Content -->
      <div v-if="!isConfigured" class="space-y-4" data-testid="notion-not-configured">
        <p class="text-muted">{{ t('notion.settings.notConfigured.message') }}</p>
        <UButton color="neutral" variant="soft" size="lg" to="/settings?tab=sources">
          {{ t('notion.settings.notConfigured.action') }}
        </UButton>
      </div>

      <UTabs
        v-else
        ref="tabsRef"
        v-model="activeTab"
        :items="tabItems"
        :orientation="isDesktopWidth ? 'vertical' : 'horizontal'"
        :ui="tabsUi"
        :class="isDesktopWidth ? 'flex items-start gap-8' : 'gap-0'"
      >
        <!-- Database Tab -->
        <template #connection>
          <NotionSettingsSection
            :title="t('notion.settings.tabs.connection')"
            :description="t('notion.settings.connection.description')"
            :is-saving="isSavingConnection"
            :has-changes="hasConnectionChanges"
            @save="saveConnection"
            @cancel="resetConnection"
          >
            <div class="space-y-6">
              <!-- Token Section -->
              <UFormField
                :label="t('notion.settings.connection.tokenLabel')"
                :state="tokenState"
                :message="tokenMessage"
              >
                <UInput
                  :model-value="tokenDisplay"
                  :type="secrets.available ? 'text' : 'password'"
                  placeholder="ntn_..."
                  class="w-full"
                  autocomplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  disabled
                />
                <template #help>
                  <ExternalLink
                    href="https://www.notion.so/my-integrations"
                    class="text-primary hover:underline"
                  >
                    {{ t('notion.settings.connection.manageToken') }}
                  </ExternalLink>
                </template>
              </UFormField>

              <!-- Database Section -->
              <UFormField :label="t('notion.settings.connection.databaseLabel')">
                <!-- Read-only view -->
                <div v-if="!isEditingDatabase" class="space-y-2">
                  <UInput
                    :model-value="displayDatabaseName"
                    :placeholder="t('notion.settings.connection.noDatabase')"
                    class="w-full"
                    disabled
                  />
                  <UButton
                    variant="link"
                    color="primary"
                    icon="i-ph-pencil-simple"
                    @click="() => { isEditingDatabase = true; }"
                  >
                    {{ t('notion.settings.connection.changeDatabase') }}
                  </UButton>
                </div>
                
                <!-- Edit view -->
                <div v-else class="space-y-2">
                  <div v-if="isLoadingDatabases" class="flex items-center gap-2 py-2 text-muted">
                    <UIcon name="i-ph-arrow-clockwise" class="animate-spin" />
                    <span>{{ t('notion.settings.connection.loadingDatabases') }}</span>
                  </div>
                  <template v-else>
                    <USelect
                      v-model="localDatabaseId"
                      :items="databaseOptions"
                      :placeholder="t('notion.settings.connection.selectDatabase')"
                      class="w-full"
                      size="lg"
                    />
                    <div class="flex gap-2">
                      <UButton
                        variant="soft"
                        color="neutral"
                        @click="cancelEditDatabase"
                      >
                        {{ t('common.cancel') }}
                      </UButton>
                      <UButton
                        variant="link"
                        color="primary"
                        @click="saveDatabase"
                      >
                        {{ t('common.save') }}
                      </UButton>
                    </div>
                  </template>
                </div>
              </UFormField>

              <!-- Data Source Section (if feature enabled) -->
              <UFormField 
                v-if="requireDataSourceSelection && dataSourceOptions.length > 0"
                :label="t('notion.settings.connection.dataSourceLabel')"
              >
                <USelect
                  v-model="localDataSourceId"
                  :items="dataSourceOptions"
                  :placeholder="t('notion.settings.connection.selectDataSource')"
                  class="w-full"
                  size="lg"
                />
              </UFormField>
            </div>
          </NotionSettingsSection>
        </template>

        <!-- Properties Tab -->
        <template #properties>
          <NotionSettingsSection
            :title="t('notion.settings.tabs.properties')"
            :description="t('notion.settings.properties.description')"
            :is-saving="isSavingProperties"
            :has-changes="hasPropertyChanges"
            @save="saveProperties"
            @cancel="resetProperties"
          >
            <PropertyMapper
              ref="propertyMapperRef"
              :database-schema="databaseSchema"
              :default-mapping="localPropertyMapping || undefined"
              @saved="handlePropertyMappingSaved"
            />
          </NotionSettingsSection>
        </template>

        <!-- Custom Properties Tab -->
        <template #custom>
          <NotionSettingsSection
            :title="t('notion.settings.tabs.custom')"
            :description="t('notion.settings.custom.description')"
            :is-saving="isSavingCustom"
            :has-changes="hasCustomChanges"
            @save="saveCustomProperties"
            @cancel="resetCustomProperties"
          >
            <CustomPropertiesStep
              ref="customPropertiesRef"
              :database-schema="databaseSchema"
              :default-mapping="localPropertyMapping || undefined"
              @saved="handleCustomPropertiesSaved"
            />
          </NotionSettingsSection>
        </template>

        <!-- Priority Tab (conditional) -->
        <template v-if="hasPriorityProperty" #priority>
          <NotionSettingsSection
            :title="t('notion.settings.tabs.priority')"
            :description="t('notion.settings.priority.description')"
            :is-saving="isSavingPriority"
            :has-changes="hasPriorityChanges"
            @save="savePriorityMapping"
            @cancel="resetPriorityMapping"
          >
            <PriorityMappingStep
              ref="priorityMappingRef"
              :database-schema="databaseSchema"
              :priority-property-name="localPropertyMapping?.priority || ''"
              :default-mapping="localPriorityMapping || undefined"
              @change="draftPriorityMapping = $event"
              @saved="handlePriorityMappingSaved"
            />
          </NotionSettingsSection>
        </template>

        <!-- Status Tab -->
        <template #status>
          <NotionSettingsSection
            :title="t('notion.settings.status.title')"
            :description="t('notion.settings.status.description')"
            :is-saving="isSavingStatus"
            :has-changes="hasStatusChanges"
            @save="saveStatusMapping"
            @cancel="resetStatusMapping"
          >
            <StatusMappingStep
              ref="statusMappingRef"
              :database-schema="databaseSchema"
              :status-property-name="localPropertyMapping?.status || ''"
              :default-mapping="localStatusMapping || undefined"
              @saved="handleStatusMappingSaved"
            />
          </NotionSettingsSection>
        </template>
      </UTabs>

      <SettingsSubpageLink
        v-if="isDesktop"
        class="mt-10 max-w-2xl"
        to="/settings/github"
        icon="i-ph-key"
        :label="t('settings.subpages.github.label')"
        :description="t('settings.subpages.github.description')"
      />

    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useIsDesktop } from '~/composables/useIsDesktop';
import { useNotionConfigStore } from '~/store/notionConfig';
import { useIntegrationHealthStore } from '~/store/integrationHealth';
import { useErrorHandler } from '~/composables/useErrorHandler';
import { useSecrets } from '~/composables/useSecrets';
import { isTauri } from '~/utils/isTauri';
import { maskToken } from '~/lib/secrets';
import ExternalLink from '~/components/ui/ExternalLink.vue';
import SettingsSubpageLink from '~/components/settings/SettingsSubpageLink.vue';
import { useFeatureFlags } from '~/utils/featureFlags';
import { NotionClientAPI } from '~/integrations/NotionClientAPI';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import PropertyMapper from '~/components/notion/setup/mapping/PropertyMapper.vue';
import CustomPropertiesStep from '~/components/notion/setup/wizard/steps/CustomPropertiesStep.vue';
import PriorityMappingStep from '~/components/notion/setup/wizard/steps/PriorityMappingStep.vue';
import { normalizePriorityMapping, samePriorityMapping } from '~/lib/priority';
import StatusMappingStep from '~/components/notion/setup/wizard/steps/StatusMappingStep.vue';
import NotionSettingsSection from '~/components/notion/settings/NotionSettingsSection.vue';
import type { 
  NotionDatabaseSchema, 
  NotionPropertyMapping, 
  NotionStatusMapping,
  NotionPriorityMapping,
  NotionCustomPropertyConfig,
  NotionDatabaseSummary 
} from '~/types/notion';

defineOptions({ name: 'NotionSettingsPage' });

definePageMeta({
  layout: false,
  titleKey: 'notion.settings.pageTitle',
  descriptionKey: 'notion.settings.pageDescription',
});

const { t } = useI18n();

const notionConfig = useNotionConfigStore();
const integrationHealth = useIntegrationHealthStore();
const { handleError } = useErrorHandler();
const secrets = useSecrets();
const isDesktop = isTauri();
const isDesktopWidth = useIsDesktop();
const featureFlags = useFeatureFlags();
const propertyOptionsStore = usePropertyOptionsStore();

// Refs for child components
const propertyMapperRef = ref<InstanceType<typeof PropertyMapper> | null>(null);
const customPropertiesRef = ref<InstanceType<typeof CustomPropertiesStep> | null>(null);
const priorityMappingRef = ref<InstanceType<typeof PriorityMappingStep> | null>(null);
const statusMappingRef = ref<InstanceType<typeof StatusMappingStep> | null>(null);

// Tab state
const activeTab = ref('connection');
const tabsRef = ref<{ $el?: HTMLElement } | null>(null);

// Desktop: the vertical list sticks below the bar and veil. Phone: a horizontal row that scrolls inside itself, full width
const tabsUi = computed(() => isDesktopWidth.value
  ? { list: 'w-56 shrink-0 sticky sticky-below-page-header', trigger: 'justify-start', content: 'flex-1 min-w-0' }
  : { list: 'w-full overflow-x-auto', trigger: 'grow-0 shrink-0 whitespace-nowrap', content: 'w-full min-w-0 pt-6' });

// Phone: the list scrolls sideways, so keep the chosen tab in view (also after a resize into phone width). Scrolls the
// list itself, never the page.
watch([activeTab, isDesktopWidth], async () => {
  if (!import.meta.client || isDesktopWidth.value) return;
  await nextTick();
  const list = tabsRef.value?.$el?.querySelector<HTMLElement>('[role=tablist]');
  const tab = list?.querySelector<HTMLElement>('[role=tab][data-state=active]');
  if (!list || !tab) return;
  const edge = tab.offsetLeft; // the list is `relative`: its tabs measure from its own edge
  if (edge < list.scrollLeft) list.scrollLeft = edge;
  else if (edge + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = edge + tab.offsetWidth - list.clientWidth;
});

const tabItems = computed(() => {
  const items = [
    { label: t('notion.settings.tabs.connection'), value: 'connection', icon: 'i-ph-database', slot: 'connection' },
    { label: t('notion.settings.tabs.properties'), value: 'properties', icon: 'i-ph-sliders-horizontal', slot: 'properties' },
    { label: t('notion.settings.tabs.custom'), value: 'custom', icon: 'i-ph-plus-square', slot: 'custom' },
  ];
  
  if (hasPriorityProperty.value) {
    items.push({ label: t('notion.settings.tabs.priority'), value: 'priority', icon: 'i-ph-flag', slot: 'priority' });
  }
  
  items.push({ label: t('notion.settings.tabs.status'), value: 'status', icon: 'i-ph-check-circle', slot: 'status' });
  
  return items;
});

// Configuration state
const isConfigured = computed(() => notionConfig.isConfigured);
const requireDataSourceSelection = computed(() => featureFlags.notionDataSourceSelection);

// Local state for editing
const localToken = ref('');
const localDatabaseId = ref('');
const localDataSourceId = ref('');
const localPropertyMapping = ref<NotionPropertyMapping | null>(null);
const localStatusMapping = ref<NotionStatusMapping | null>(null);
const localPriorityMapping = ref<NotionPriorityMapping | null>(null);

// Edit state
const isEditingDatabase = ref(false);
const originalDatabaseId = ref('');

// Database and schema state
const databases = ref<NotionDatabaseSummary[]>([]);
const databaseSchema = ref<NotionDatabaseSchema>({});
const isLoadingDatabases = ref(false);
const isLoadingSchema = ref(false);

// Saving states
const isSavingConnection = ref(false);
const isSavingProperties = ref(false);
const isSavingCustom = ref(false);
const isSavingPriority = ref(false);
const isSavingStatus = ref(false);

// The desktop app never puts the full token into an input: only dots plus the last four characters.
const tokenDisplay = computed(() => (secrets.available ? maskToken(localToken.value) : localToken.value));

// Token validation state
const tokenState = ref<'default' | 'valid' | 'error'>('default');
const tokenMessage = ref('');

// Computed properties
const hasPriorityProperty = computed(() => !!localPropertyMapping.value?.priority);

const displayDatabaseName = computed(() => {
  // 1. Try stored name from config
  const configName = notionConfig.config?.databaseName;
  if (configName && configName !== notionConfig.config?.databaseId) {
    return configName;
  }

  // 2. Try name from loaded databases list
  const dbName = currentDatabaseName.value;
  if (dbName && dbName !== notionConfig.config?.databaseId) {
    return dbName;
  }

  // 3. Show loading state if fetching
  if (isLoadingDatabases.value || isLoadingSchema.value) {
    return t('notion.settings.connection.loadingDatabase');
  }

  // 4. Fallback to ID or placeholder
  return notionConfig.config?.databaseId || t('notion.settings.connection.noDatabase');
});

const currentDatabaseName = computed(() => {
  const db = databases.value.find(d => d.id === notionConfig.config?.databaseId);
  return db?.title || notionConfig.config?.databaseId;
});

const databaseOptions = computed(() => 
  databases.value.map(db => ({ label: db.title, value: db.id }))
);

const dataSourceOptions = computed(() => {
  const selectedDb = databases.value.find(db => db.id === localDatabaseId.value);
  if (!selectedDb?.dataSources) return [];
  return selectedDb.dataSources.map(ds => ({ 
    label: ds.name || ds.id, 
    value: ds.id 
  }));
});

// Change detection
const hasConnectionChanges = computed(() => {
  if (!notionConfig.config) return false;
  return localToken.value !== notionConfig.config.token ||
         localDatabaseId.value !== notionConfig.config.databaseId ||
         localDataSourceId.value !== (notionConfig.config.dataSourceId || '');
});

const hasPropertyChanges = ref(false);
const hasCustomChanges = ref(false);
/** The mapping as currently edited in the priority tab; null until the user edits a level */
const draftPriorityMapping = ref<NotionPriorityMapping | null>(null);
const hasPriorityChanges = computed(() =>
  draftPriorityMapping.value !== null
  && !samePriorityMapping(draftPriorityMapping.value, normalizePriorityMapping(notionConfig.config?.priorityMapping)),
);
const hasStatusChanges = ref(false);

// Initialize local state from config
const initializeFromConfig = () => {
  if (!notionConfig.config) return;
  
  localToken.value = notionConfig.config.token;
  localDatabaseId.value = notionConfig.config.databaseId;
  localDataSourceId.value = notionConfig.config.dataSourceId || '';
  localPropertyMapping.value = notionConfig.config.propertyMapping ? { ...notionConfig.config.propertyMapping } : null;
  localStatusMapping.value = notionConfig.config.statusMapping ? { ...notionConfig.config.statusMapping } : null;
  localPriorityMapping.value = normalizePriorityMapping(notionConfig.config.priorityMapping) ?? null;
};

// Fetch databases
const fetchDatabases = async () => {
  if (!localToken.value) return;
  
  isLoadingDatabases.value = true;
  try {
    const api = new NotionClientAPI(localToken.value);
    const [dbResponse] = await Promise.all([
      api.searchDatabases(),
    ]);
    
    // Process database results
    const summaries: NotionDatabaseSummary[] = [];
    for (const db of dbResponse.results as Array<{ object?: string; id: string; title?: Array<{ plain_text?: string }> }>) {
      if (db?.object !== 'database') continue;
      const dbId = db.id;
      const title = db.title?.map((t) => t.plain_text).join('') || 'Untitled Database';
      summaries.push({ id: dbId, title, dataSources: [] });
    }
    databases.value = summaries;
  } catch (error) {
    handleError(error as Error, 'notion_setup');
  } finally {
    isLoadingDatabases.value = false;
  }
};

// Fetch database schema
const fetchDatabaseSchema = async () => {
  if (!localDatabaseId.value || !localToken.value) return;
  
  isLoadingSchema.value = true;
  try {
    const api = new NotionClientAPI(localToken.value);
    const database = await api.getDatabase(localDatabaseId.value);
    databaseSchema.value = (database.properties ?? {}) as NotionDatabaseSchema;

    if (localPropertyMapping.value) {
      propertyOptionsStore.initializeTopicAndActivityFromSchema(
        databaseSchema.value,
        localPropertyMapping.value,
      );
    }
    
    // Extract title from database details
    if (database.title && Array.isArray(database.title)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const title = database.title.map((t: any) => t.plain_text).join('') || 'Untitled Database';
      
      // Update store if name is missing or differs, but only if we have a config
      // This ensures the read-only view shows the correct name immediately
      if (notionConfig.config && (!notionConfig.config.databaseName || notionConfig.config.databaseName === notionConfig.config.databaseId)) {
        notionConfig.setConfig({
          ...notionConfig.config,
          databaseName: title
        });
      }
      
      // Update local databases list to ensure name is available for display/dropdown
      const existingInList = databases.value.find(d => d.id === localDatabaseId.value);
      if (!existingInList) {
        databases.value.push({
          id: localDatabaseId.value,
          title: title,
          dataSources: []
        });
      } else if (existingInList.title !== title) {
        existingInList.title = title;
      }
    }
  } catch (error) {
    handleError(error as Error, 'notion_setup');
  } finally {
    isLoadingSchema.value = false;
  }
};

// Save handlers
const saveConnection = async () => {
  if (!localToken.value || !localDatabaseId.value) return;
  
  isSavingConnection.value = true;
  try {
    // Validate token first
    const api = new NotionClientAPI(localToken.value);
    await api.searchDatabases(); // Simple validation call
    
    // Get database name
    const selectedDb = databases.value.find(db => db.id === localDatabaseId.value);

    // Desktop: the Keychain write comes first; the config does not count as saved without it.
    if (secrets.available) {
      try {
        await secrets.set('notion-token', localToken.value);
      } catch (error) {
        tokenState.value = 'error';
        tokenMessage.value = t('notion.settings.connection.failed');
        handleError(error as Error, 'secrets');
        return;
      }
    }

    notionConfig.setConfig({
      ...notionConfig.config!,
      token: localToken.value,
      databaseId: localDatabaseId.value,
      databaseName: selectedDb?.title || null,
      dataSourceId: localDataSourceId.value || null,
    });
    
    tokenState.value = 'valid';
    tokenMessage.value = t('notion.settings.connection.saved');
    
    // Refresh schema for new database
    await fetchDatabaseSchema();
  } catch (error) {
    tokenState.value = 'error';
    tokenMessage.value = t('notion.settings.connection.failed');
    handleError(error as Error, 'notion_setup');
  } finally {
    isSavingConnection.value = false;
  }
};

const cancelEditDatabase = () => {
  localDatabaseId.value = originalDatabaseId.value;
  isEditingDatabase.value = false;
};

const saveDatabase = async () => {
  if (!localDatabaseId.value || !localToken.value) return;
  
  isSavingConnection.value = true;
  try {
    // Get database name
    const selectedDb = databases.value.find(db => db.id === localDatabaseId.value);
    
    notionConfig.setConfig({
      ...notionConfig.config!,
      databaseId: localDatabaseId.value,
      databaseName: selectedDb?.title || null,
    });
    
    originalDatabaseId.value = localDatabaseId.value;
    isEditingDatabase.value = false;
    
    // Refresh schema for new database
    await fetchDatabaseSchema();
  } catch (error) {
    handleError(error as Error, 'notion_setup');
  } finally {
    isSavingConnection.value = false;
  }
};

const resetConnection = () => {
  initializeFromConfig();
  tokenState.value = 'default';
  tokenMessage.value = '';
};

const saveProperties = () => {
  propertyMapperRef.value?.save();
};

const resetProperties = () => {
  localPropertyMapping.value = notionConfig.config?.propertyMapping ? { ...notionConfig.config.propertyMapping } : null;
  hasPropertyChanges.value = false;
};

const handlePropertyMappingSaved = (mapping: NotionPropertyMapping) => {
  isSavingProperties.value = true;
  try {
    notionConfig.setConfig({
      ...notionConfig.config!,
      propertyMapping: mapping,
    });
    localPropertyMapping.value = mapping;
    hasPropertyChanges.value = false;
  } finally {
    isSavingProperties.value = false;
  }
};

const saveCustomProperties = () => {
  customPropertiesRef.value?.save();
};

const resetCustomProperties = () => {
  localPropertyMapping.value = notionConfig.config?.propertyMapping ? { ...notionConfig.config.propertyMapping } : null;
  hasCustomChanges.value = false;
};

const handleCustomPropertiesSaved = (customs: NotionCustomPropertyConfig[]) => {
  isSavingCustom.value = true;
  try {
    const updatedMapping = {
      ...localPropertyMapping.value!,
      customProperties: customs,
    };
    notionConfig.setConfig({
      ...notionConfig.config!,
      propertyMapping: updatedMapping,
    });
    localPropertyMapping.value = updatedMapping;
    hasCustomChanges.value = false;
  } finally {
    isSavingCustom.value = false;
  }
};

const savePriorityMapping = () => {
  priorityMappingRef.value?.save();
};

const resetPriorityMapping = () => {
  localPriorityMapping.value = normalizePriorityMapping(notionConfig.config?.priorityMapping) ?? null;
  draftPriorityMapping.value = null;
  // With no stored mapping the default prop does not change, so the step resets itself (#627)
  priorityMappingRef.value?.reset();
};

const handlePriorityMappingSaved = (mapping: NotionPriorityMapping) => {
  isSavingPriority.value = true;
  try {
    notionConfig.setConfig({
      ...notionConfig.config!,
      priorityMapping: mapping,
    });
    localPriorityMapping.value = mapping;
    draftPriorityMapping.value = null;
  } finally {
    isSavingPriority.value = false;
  }
};

const saveStatusMapping = () => {
  statusMappingRef.value?.save();
};

const resetStatusMapping = () => {
  localStatusMapping.value = notionConfig.config?.statusMapping ? { ...notionConfig.config.statusMapping } : null;
  hasStatusChanges.value = false;
};

const handleStatusMappingSaved = (mapping: NotionStatusMapping) => {
  isSavingStatus.value = true;
  try {
    notionConfig.setConfig({
      ...notionConfig.config!,
      statusMapping: mapping,
    });
    localStatusMapping.value = mapping;
    hasStatusChanges.value = false;
    integrationHealth.markHealthy('notion');
  } finally {
    isSavingStatus.value = false;
  }
};

// Watch for database changes to reload schema
watch(localDatabaseId, () => {
  if (localDatabaseId.value) {
    fetchDatabaseSchema();
  }
});

// Initialize on mount
onMounted(async () => {
  initializeFromConfig();
  originalDatabaseId.value = localDatabaseId.value;
  if (isConfigured.value && localToken.value) {
    await fetchDatabases();
    await fetchDatabaseSchema();
  }
});
</script>
