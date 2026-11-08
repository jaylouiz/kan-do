<!--
@component WizardController
@description Controller component for the Notion setup wizard
@usage Used within the Notion setup modal to manage the setup flow
@responsibility
- Manages navigation between wizard steps
- Handles database selection and property mapping
- Communicates with Notion API
- Saves configuration on completion
-->
<template>
  <div class="notion-setup">
    <div ref="animateRef" class="p-4">
      <!-- Token Step -->
      <TokenStep
        v-if="step === 'token'"
        ref="tokenStep"
        v-model="notionToken"
        :info-message="broken ? t('notion.wizard.brokenNotice') : ''"
        @next="handleTokenNext"
      />

      <!-- Database Selection Step -->
      <DatabaseSelectionStep
        v-else-if="step === 'database' && mode !== 'settings'"
        :databases="databases"
        :selected-database="selectedDatabase"
        :selected-data-source="selectedDataSource"
        :loading="isLoadingDatabases"
        :error="databasesError || undefined"
        @update:selected-database="handleSelectedDatabaseChange"
        @update:selected-data-source="handleSelectedDataSourceChange"
      />

      <!-- Property Mapping Step -->
      <MappingStep
        v-else-if="step === 'mapping'"
        ref="mappingStep"
        :database-schema="databaseSchema"
        :default-mapping="notionConfig.config?.propertyMapping"
        @saved="handlePropertyMappingSaved"
      />

      <!-- Custom Properties Step -->
      <CustomPropertiesStep
        v-else-if="step === 'custom-properties'"
        ref="customPropertiesStep"
        :database-schema="databaseSchema"
        :default-mapping="propertyMapping || notionConfig.config?.propertyMapping"
        @saved="handleCustomPropertiesSaved"
      />

      <!-- Priority Mapping Step -->
      <PriorityMappingStep
        v-else-if="step === 'priority-mapping' && propertyMapping?.priority"
        ref="priorityMappingStep"
        :database-schema="databaseSchema"
        :priority-property-name="propertyMapping?.priority || ''"
        :default-mapping="notionConfig.config?.priorityMapping"
        @saved="handlePriorityMappingSaved"
      />

      <!-- Status Mapping Step -->
      <StatusMappingStep
        v-else-if="step === 'status-mapping'"
        ref="statusMappingStep"
        :database-schema="databaseSchema"
        :status-property-name="propertyMapping?.status || ''"
        :default-mapping="notionConfig.config?.statusMapping"
        @saved="finishSetup"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Script setup for NotionWizardController: manages wizard state, fetching databases/schema,
 * transitions between steps, and final save.
 */
import { ref, computed, onMounted, watch } from "vue";
import { useAutoAnimate } from "@formkit/auto-animate/vue";
import { useI18n } from "vue-i18n";
import { useNotionConfigStore } from "~/store/notionConfig";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { useSecrets } from '~/composables/useSecrets';
import { LocalizedError, getDisplayMessage } from '~/lib/errorMessages';
import { translate } from '~/lib/i18n';
import { NotionClientAPI, NotionAPIError } from '~/integrations/NotionClientAPI';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import type {
  NotionDatabaseSchema,
  NotionPropertyMapping,
  NotionStatusMapping,
  NotionPriorityMapping,
  NotionCustomPropertyConfig,
  NotionDatabaseSummary,
} from "~/types/notion";
import TokenStep from "./steps/TokenStep.vue";
import DatabaseSelectionStep from "./steps/DatabaseSelectionStep.vue";
import MappingStep from "./steps/MappingStep.vue";
import StatusMappingStep from "./steps/StatusMappingStep.vue";
import PriorityMappingStep from "./steps/PriorityMappingStep.vue";
import CustomPropertiesStep from "./steps/CustomPropertiesStep.vue";
import { useIntegrationHealthStore } from "~/store/integrationHealth";
import { useFeatureFlags } from "~/utils/featureFlags";
import { normalizePriorityMapping } from "~/lib/priority";

/** Notion API rich text object shape */
interface NotionRichText {
  plain_text?: string;
}

/** Notion API search result item shape */
interface NotionSearchResult {
  id: string;
  object: string;
  name?: string;
  title?: NotionRichText[];
  location?: { database_id?: string };
  parent?: { database_id?: string };
}

defineOptions({ name: 'NotionWizardController' });

/**
 * Props for NotionWizardController component.
 */
/**
 * Props
 * @prop {string=} token Notion API token for authentication (optional for initial setup)
 * @prop {('setup'|'settings')=} mode Mode of operation: setup (new integration) or settings (reconfiguration)
 * @prop {boolean=} broken Whether the integration is currently in a broken state
 */
const props = defineProps<{
  /** Notion API token for authentication (optional for initial setup) */
  token?: string;
  /** Mode of operation: setup (new integration) or settings (reconfiguration) */
  mode?: "setup" | "settings";
  /** Whether the integration is currently in a broken state */
  broken?: boolean;
  /** Animate step content changes (auto-animate); the welcome page animates the whole pane itself (#43) */
  animate?: boolean;
}>();

const [animateRef, setAnimate] = useAutoAnimate();
// The controller only exists after useAutoAnimate's own onMounted, so apply the prop from a later onMounted (registered
// after it, so it runs after it) and on every change; an immediate watch in setup would hit a no-op setEnabled (#43)
onMounted(() => setAnimate(props.animate !== false));
watch(() => props.animate, (on) => setAnimate(on !== false));

const emit = defineEmits<{
  (e: "cancel" | "complete" | "back"): void;
}>();

const { t } = useI18n();
const notionConfig = useNotionConfigStore();
const { handleError } = useErrorHandler();
const secrets = useSecrets();
const propertyOptionsStore = usePropertyOptionsStore();
const step = ref(props.mode === "settings" ? "mapping" : props.token ? "database" : "token");
const notionToken = ref(props.token || "");

// Template refs (typed)
const tokenStep = ref<InstanceType<typeof TokenStep> | null>(null);
const mappingStep = ref<InstanceType<typeof MappingStep> | null>(null);
const customPropertiesStep = ref<InstanceType<typeof CustomPropertiesStep> | null>(null);
const priorityMappingStep = ref<InstanceType<typeof PriorityMappingStep> | null>(null);
const statusMappingStep = ref<InstanceType<typeof StatusMappingStep> | null>(null);
const databases = ref<NotionDatabaseSummary[]>([]);
const selectedDatabase = ref("");
const selectedDataSource = ref("");
const databaseSchema = ref<NotionDatabaseSchema>({});
const propertyMapping = ref<NotionPropertyMapping | null>(null);
const priorityMapping = ref<NotionPriorityMapping | null>(null);
const featureFlags = useFeatureFlags();
const requireDataSourceSelection = computed(() => featureFlags.notionDataSourceSelection);

const handleSelectedDatabaseChange = (value: string) => {
  selectedDatabase.value = value;
};

const handleSelectedDataSourceChange = (value: string) => {
  selectedDataSource.value = value;
};

// Loading and error states
const isLoadingDatabases = ref(false);
const databasesError = ref<string | null>(null);

/**
 * Computes the current step number for progress tracking.
 */
const computeCurrentStepNumber = (): number => {
  switch (step.value) {
    case "token":
      return 1;
    case "database":
      return 2;
    case "mapping":
      return 3;
    case "custom-properties":
      return 4;
    case "priority-mapping":
      return 5;
    case "status-mapping":
      return 6;
    default:
      return 0;
  }
};

const currentStepNumber = computed(computeCurrentStepNumber);

/**
 * Computes the localized title for the current step.
 */
const computeStepTitle = (): string => {
  switch (step.value) {
    case "token":
      return t('notion.wizard.stepTitle.token');
    case "database":
      return t('notion.wizard.stepTitle.database');
    case "mapping":
      return t('notion.wizard.stepTitle.mapping');
    case "custom-properties":
      return t('notion.wizard.stepTitle.customProperties');
    case "priority-mapping":
      return t('notion.wizard.stepTitle.priority');
    case "status-mapping":
      return t('notion.wizard.stepTitle.status');
    default:
      return "";
  }
};

const stepTitle = computed(computeStepTitle);

/**
 * Computes whether the wizard can proceed to the next step.
 */
const computeCanProceed = (): boolean => {
  switch (step.value) {
    case "token":
      return !!tokenStep.value?.token && !tokenStep.value?.isValidating;
    case "database":
      if (!selectedDatabase.value) return false;
      if (requireDataSourceSelection.value) {
        return !!selectedDataSource.value;
      }
      // If feature flag disabled, allow proceeding as long as database selected
      return true;
    case "mapping":
      return mappingStep.value?.isMappingValid || false;
    case "custom-properties":
      return true;
    case "priority-mapping":
      return priorityMappingStep.value?.isMappingValid || false;
    case "status-mapping":
      return statusMappingStep.value?.isMappingValid || false;
    default:
      return false;
  }
};

const canProceed = computed(computeCanProceed);

/**
 * Advances to the next step in the wizard flow
 * Validates token, fetches databases, and fetches database schema as needed
 */
const nextStep = async () => {
  try {
    if (step.value === 'token') {
      // Token validation is handled by the TokenStep component
      if (tokenStep.value) {
        await tokenStep.value.validateAndProceed();
      }
      step.value = 'database';
      await fetchDatabases();
    } else if (step.value === 'database' && selectedDatabase.value) {
      step.value = 'mapping';
      await fetchDatabaseSchema();
    } else if (step.value === 'mapping' && mappingStep.value) {
      // This will be handled by the save event from the mapping step
      mappingStep.value.save();
    } else if (step.value === 'custom-properties' && customPropertiesStep.value) {
      customPropertiesStep.value.save();
    } else if (step.value === 'priority-mapping' && priorityMappingStep.value) {
      priorityMappingStep.value.save();
    }
  } catch (error) {
    handleError(error as Error, 'notion_setup');
  }
};

/**
 * Returns to the previous step in the wizard flow
 */
function back() {
  if (step.value === "status-mapping") {
    // Check if priority property is mapped
    if (propertyMapping.value?.priority) {
      step.value = "priority-mapping";
    } else {
      step.value = "custom-properties";
    }
  } else if (step.value === "priority-mapping") {
    step.value = "custom-properties";
  } else if (step.value === "custom-properties") {
    step.value = "mapping";
  } else if (step.value === "mapping") {
    step.value = "database";
  } else if (step.value === "database") {
    step.value = "token";
  }
  emit("back");
}

/**
 * Cancels the wizard process
 */
function cancel() {
  emit("cancel");
}

/**
 * Handles token validation success and moves to database selection
 */
function handleTokenNext() {
  step.value = "database";
  // Fetch databases after token validation
  fetchDatabases();
}

/**
 * Handles property mapping completion and moves to status mapping
 */
function handlePropertyMappingSaved(mapping: NotionPropertyMapping) {
  // Preserve previously saved customProperties if the emitted mapping does not include them
  const prevCustoms = notionConfig.config?.propertyMapping?.customProperties;
  const nextCustoms = mapping.customProperties;
  propertyMapping.value = {
    ...mapping,
    customProperties: nextCustoms !== undefined ? nextCustoms : (prevCustoms ?? []),
  };
  step.value = "custom-properties";
}

/**
 * Handles saving of custom properties and moves to priority or status mapping
 */
function handleCustomPropertiesSaved(customs: NotionCustomPropertyConfig[]) {
  if (!propertyMapping.value) {
    propertyMapping.value = {
      title: '',
      status: '',
      dueDate: null,
      priority: null,
      timeBox: null,
      timeSpent: null,
      timeSpentUnit: undefined,
      customProperties: []
    };
  }
  propertyMapping.value.customProperties = customs;
  
  // Route to priority mapping if priority property is selected, otherwise go to status mapping
  if (propertyMapping.value.priority) {
    step.value = 'priority-mapping';
  } else {
    step.value = 'status-mapping';
  }
}

/**
 * Handles priority mapping completion and moves to status mapping
 */
function handlePriorityMappingSaved(mapping: NotionPriorityMapping) {
  priorityMapping.value = mapping;
  step.value = 'status-mapping';
}

/**
 * Fetches the list of available Notion databases for the provided token.
 * Handles loading and error states, and resets to the token step on auth errors.
 */
const fetchDatabases = async () => {
  // Reset states
  isLoadingDatabases.value = true;
  databasesError.value = null;
  databases.value = [];
  if (props.mode !== 'settings') {
    selectedDataSource.value = "";
  }
  
  try {
    const api = new NotionClientAPI(notionToken.value);
    
    // Search for databases and data sources
    const [dbResponse, dsResponse] = await Promise.all([
      api.searchDatabases(),
      api.searchDataSources(),
    ]);

    // Check if server proxy already returned pre-processed DatabaseSummary objects
    // (browser mode returns processed data, Tauri mode returns raw Notion API data)
    const firstResult = dbResponse.results[0] as NotionDatabaseSummary | NotionSearchResult | undefined;
    const isPreProcessed = firstResult && 'dataSources' in firstResult && typeof (firstResult as NotionDatabaseSummary).title === 'string';
    
    if (isPreProcessed) {
      // Server proxy already processed the data - use it directly
      databases.value = dbResponse.results as NotionDatabaseSummary[];
    } else {
      // Raw Notion API response (Tauri mode) - process it ourselves
      // Build a map of database_id -> data sources
      const dataSourcesByDb = new Map<string, Array<{ id: string; name: string | null; databaseId: string; databaseTitle: string }>>();
      
      for (const ds of dsResponse.results as NotionSearchResult[]) {
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
      const summaries: NotionDatabaseSummary[] = [];
      
      for (const db of dbResponse.results as NotionSearchResult[]) {
        if (db?.object !== 'database') continue;
        const dbId = db.id;
        const title = db.title?.map((t) => t.plain_text).join('') || 'Untitled Database';
        
        const dataSources = (dataSourcesByDb.get(dbId) || []).map(ds => ({
          ...ds,
          databaseTitle: title,
        }));
        
        summaries.push({ id: dbId, title, dataSources });
      }

      // Add databases that only appeared in data source results
      for (const [dbId, dataSources] of dataSourcesByDb) {
        if (!summaries.find(s => s.id === dbId)) {
          try {
            const dbDetails = await api.getDatabase(dbId);
            const title = (dbDetails.title as NotionRichText[])?.map((t) => t.plain_text).join('') || 'Untitled Database';
            summaries.push({
              id: dbId,
              title,
              dataSources: dataSources.map(ds => ({ ...ds, databaseTitle: title })),
            });
          } catch {
            // Skip databases we can't access
          }
        }
      }

      databases.value = summaries;
    }
    if (!selectedDatabase.value) {
      const initialDatabase = databases.value.find(db => db.id === notionConfig.config?.databaseId) || databases.value[0];
      selectedDatabase.value = initialDatabase ? initialDatabase.id : "";
    }

    // Ensure data source selection aligns with currently selected database
    syncSelectedDataSource();
  } catch (error: unknown) {
    // Set error message
    const errorMessage = error instanceof NotionAPIError 
      ? translate('errors.notionApiError', { message: error.message })
      : getDisplayMessage(error, translate('errors.loadDatabasesFailed'));
    databasesError.value = errorMessage;

    handleError((error as Error), 'notion_setup');

    // Reset to token step on authentication errors
    const isAuthError = error instanceof NotionAPIError && error.statusCode === 401;

    if (isAuthError) {
      step.value = 'token';
      databasesError.value = null; // Clear error when going back to token step
    }
  } finally {
    isLoadingDatabases.value = false;
  }
};

/**
 * Fetches the schema for the selected Notion database to populate mapping steps.
 */
const fetchDatabaseSchema = async () => {
  if (!selectedDatabase.value) {
    return;
  }
  if (requireDataSourceSelection.value && !selectedDataSource.value) {
    return;
  }
  try {
    const api = new NotionClientAPI(notionToken.value);
    const resolvedDataSourceId = selectedDataSource.value && selectedDataSource.value.trim().length > 0
      ? selectedDataSource.value
      : null;

    // Prefer the schema of the selected data source (one database can hold several)
    let schema: NotionDatabaseSchema | null = null;
    if (resolvedDataSourceId) {
      try {
        const dataSource = await api.getDataSource(resolvedDataSourceId);
        if (dataSource.properties && Object.keys(dataSource.properties).length > 0) {
          schema = dataSource.properties;
        }
      } catch {
        // Fall back to database schema
      }
    }

    if (!schema) {
      const database = await api.getDatabase(selectedDatabase.value);
      schema = (database.properties ?? {}) as NotionDatabaseSchema;
    }
    databaseSchema.value = schema;

    if (props.mode === 'settings' && notionConfig.config?.propertyMapping) {
      propertyOptionsStore.initializeTopicAndActivityFromSchema(
        schema,
        notionConfig.config.propertyMapping,
      );
    }
  } catch (error) {
    handleError(error as Error, 'notion_setup');
  }
};

/**
 * Finalizes the setup by persisting token, database selection, property mapping,
 * and status mapping to the Notion config store, then marks integration healthy.
 */
const finishSetup = async (statusMapping: NotionStatusMapping) => {
  try {
    if (!propertyMapping.value) {
      throw new Error('Property mapping is required');
    }

    if (!selectedDatabase.value) {
      throw new LocalizedError('errors.selectDatabase');
    }
    if (requireDataSourceSelection.value && !selectedDataSource.value) {
      throw new LocalizedError('errors.selectDataSource');
    }

    // Desktop: the token goes to the Keychain before the config counts as saved.
    if (secrets.available) {
      try {
        await secrets.set('notion-token', notionToken.value);
      } catch (error) {
        handleError(error as Error, 'secrets');
        return;
      }
    }

    notionConfig.setConfig({
      token: notionToken.value,
      databaseId: selectedDatabase.value,
      dataSourceId: requireDataSourceSelection.value ? selectedDataSource.value : null,
      dataSourceName: requireDataSourceSelection.value ? currentDataSourceName.value : null,
      propertyMapping: propertyMapping.value,
      statusMapping,
      priorityMapping: priorityMapping.value || undefined
    });

    propertyOptionsStore.initializeTopicAndActivityFromSchema(
      databaseSchema.value,
      propertyMapping.value,
    );

    // Mark health back to healthy after successful setup
    const health = useIntegrationHealthStore();
    health.markHealthy('notion');
    emit('complete');
  } catch (error) {
    handleError(error as Error, 'notion_setup');
  }
};

/**
 * Creates an initial database schema from current configuration
 * This allows immediate display of current values while fresh schema loads in background
 */
const createInitialSchemaFromConfig = () => {
  if (!notionConfig.config) return;
  
  const config = notionConfig.config;
  const initialSchema: NotionDatabaseSchema = {};
  
  // Add property mappings to schema
  if (config.propertyMapping) {
    const mapping = config.propertyMapping;
    
    // Add title property
    if (mapping.title) {
      initialSchema[mapping.title] = {
        id: 'title-prop',
        name: mapping.title,
        type: 'title'
      };
    }
    
    // Add status property with current status values
    if (mapping.status && config.statusMapping) {
      const statusOptions = [];
      
      // Create options from current status mapping
      if (config.statusMapping.today) {
        statusOptions.push({ id: 'today', name: config.statusMapping.today, color: 'blue' });
      }
      if (config.statusMapping.doing) {
        statusOptions.push({ id: 'doing', name: config.statusMapping.doing, color: 'yellow' });
      }
      if (config.statusMapping.done) {
        statusOptions.push({ id: 'done', name: config.statusMapping.done, color: 'green' });
      }
      if (config.statusMapping.waiting) {
        statusOptions.push({ id: 'waiting', name: config.statusMapping.waiting, color: 'gray' });
      }
      if (config.statusMapping.archive) {
        statusOptions.push({ id: 'archive', name: config.statusMapping.archive, color: 'gray' });
      }

      initialSchema[mapping.status] = {
        id: 'status-prop',
        name: mapping.status,
        type: 'select',
        select: { options: statusOptions }
      };
    }
    
    // Add other optional properties
    if (mapping.dueDate) {
      initialSchema[mapping.dueDate] = {
        id: 'date-prop',
        name: mapping.dueDate,
        type: 'date'
      };
    }
    if (mapping.priority && config.priorityMapping) {
      // Create options from current priority mapping (a pre-#617 shape is read too)
      const priorityMapping = normalizePriorityMapping(config.priorityMapping);
      const priorityOptions = [
        ...(priorityMapping?.high ?? []).map((name) => ({ id: `high-${name}`, name, color: 'orange' })),
        ...(priorityMapping?.regular ?? []).map((name) => ({ id: `regular-${name}`, name, color: 'yellow' })),
        ...(priorityMapping?.low ?? []).map((name) => ({ id: `low-${name}`, name, color: 'gray' })),
      ];

      initialSchema[mapping.priority] = {
        id: 'priority-prop',
        name: mapping.priority,
        type: 'select',
        select: { options: priorityOptions }
      };
    }
    if (mapping.topic) {
      initialSchema[mapping.topic] = {
        id: 'topic-prop',
        name: mapping.topic,
        type: 'select'
      };
    }
    if (mapping.timeBox) {
      initialSchema[mapping.timeBox] = {
        id: 'timebox-prop',
        name: mapping.timeBox,
        type: 'number'
      };
    }
    if (mapping.timeSpent) {
      initialSchema[mapping.timeSpent] = {
        id: 'timespent-prop',
        name: mapping.timeSpent,
        type: 'number'
      };
    }
  }
  
  // Set the initial schema
  databaseSchema.value = initialSchema;
};

// Initialize data on mount based on mode
/**
 * Initializes the wizard based on mode and current configuration/token.
 * In settings mode, preloads schema from config and refreshes in background.
 */
const initializeWizard = async () => {
  try {
    if (props.mode === "settings" && notionConfig.config) {
      // In settings mode, immediately set the database ID for UI consistency
      selectedDatabase.value = notionConfig.config.databaseId;
      selectedDataSource.value = notionConfig.config.dataSourceId || "";

      // Create initial schema from current config to show current values immediately
      if (notionConfig.config.propertyMapping && notionConfig.config.statusMapping) {
        createInitialSchemaFromConfig();
      }

      // Load databases to populate selectable values and refresh schema afterwards
      await fetchDatabases();
      if (!selectedDataSource.value) {
        syncSelectedDataSource();
      }

      if (selectedDataSource.value) {
        // Then fetch fresh schema in background to update available options
        fetchDatabaseSchema().catch(handleSchemaFetchError);
      }
    } else if (props.mode !== "settings" && notionToken.value) {
      // In setup mode, fetch databases if we have a token
      await fetchDatabases();
    }
  } catch (error) {
    if (import.meta.dev) {
      console.error('Failed to initialize wizard:', error);
    }
  }
};

onMounted(initializeWizard);

/**
 * Handles errors from background schema refresh in settings mode.
 */
function handleSchemaFetchError(error: unknown) {
  if (import.meta.dev) {
    console.warn('Failed to refresh database schema:', error);
  }
  // Continue with cached schema if fresh fetch fails
}

/**
 * Indicates whether the current step is validating (only relevant for the token step).
 */
const isValidating = computed(() => step.value === "token" ? tokenStep.value?.isValidating : false);

const selectedDatabaseDetails = computed(() => {
  return databases.value.find(db => db.id === selectedDatabase.value);
});

const currentDataSourceName = computed(() => {
  const ds = selectedDatabaseDetails.value?.dataSources?.find(ds => ds.id === selectedDataSource.value);
  return ds?.name ?? null;
});

const syncSelectedDataSource = () => {
  const dbDetails = selectedDatabaseDetails.value;
  if (!dbDetails || !Array.isArray(dbDetails.dataSources)) {
    if (props.mode !== 'settings') {
      selectedDataSource.value = "";
    }
    return;
  }

  if (dbDetails.dataSources.length === 0) {
    if (props.mode !== 'settings') {
      selectedDataSource.value = "";
    }
    return;
  }

  if (!selectedDataSource.value) {
    selectedDataSource.value = dbDetails.dataSources[0]?.id ?? "";
    return;
  }

  const exists = dbDetails.dataSources.some(ds => ds.id === selectedDataSource.value);
  if (!exists) {
    selectedDataSource.value = dbDetails.dataSources[0]?.id ?? "";
  }
};

watch(selectedDatabase, () => {
  syncSelectedDataSource();
  if (step.value !== 'database') {
    fetchDatabaseSchema().catch(handleSchemaFetchError);
  }
});

watch(selectedDataSource, () => {
  if (step.value !== 'database') {
    fetchDatabaseSchema().catch(handleSchemaFetchError);
  }
});

// Expose methods and computed properties
defineExpose({
  currentStepNumber,
  stepTitle,
  canProceed,
  nextStep,
  back,
  finishSetup,
  step, // Expose step for button logic
  cancel, // Added from previous defineExpose
  isValidating,
  statusMappingStep, // Expose statusMappingStep ref for external access
  priorityMappingStep, // Expose priorityMappingStep ref for external access
  propertyMapping, // Expose propertyMapping for conditional step rendering
  selectedDatabase,
  selectedDataSource,
  databases,
  currentDataSourceName,
  selectedDatabaseDetails,
});

</script>
