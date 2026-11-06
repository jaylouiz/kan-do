<!--
@component StatusMappingStep
@description Maps kan-do status values to Notion select option names
@usage Part of the Notion setup wizard that configures how status values correspond to Notion select options
@responsibility
- Allows mapping of Today, Doing, Done (mandatory) and Waiting (optional) to Notion select options
- Validates mapping configuration
- Provides save functionality for completing setup
-->
<template>
  <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
    <div class="text-sm text-muted md:col-span-2">
      {{ t('notion.statusMap.intro') }}
    </div>

    <!-- Today (required) -->
    <UFormField 
      :label="t('notion.statusMap.today.label')" 
      required 
      :help="t('notion.statusMap.today.help')"
    >
      <USelect
        v-model="mapping.today"
        :items="statusOptions"
        :placeholder="t('notion.statusMap.today.placeholder')"
        class="w-full"
        size="lg"
      />
    </UFormField>

    <!-- Doing (required) -->
    <UFormField 
      :label="t('notion.statusMap.doing.label')" 
      required 
      :help="t('notion.statusMap.doing.help')"
    >
      <USelect
        v-model="mapping.doing"
        :items="statusOptions"
        :placeholder="t('notion.statusMap.doing.placeholder')"
        class="w-full"
        size="lg"
      />
    </UFormField>

    <!-- Done (required) -->
    <UFormField 
      :label="t('notion.statusMap.done.label')" 
      required 
      :help="t('notion.statusMap.done.help')"
    >
      <USelect
        v-model="mapping.done"
        :items="statusOptions"
        :placeholder="t('notion.statusMap.done.placeholder')"
        class="w-full"
        size="lg"
      />
    </UFormField>

    <!-- Waiting (optional) -->
    <UFormField 
      :label="t('notion.statusMap.waiting.label')" 
      :help="t('notion.statusMap.waiting.help')"
    >
      <USelect
        v-model="mapping.waiting"
        :items="[{ label: t('notion.wizard.noneOption'), value: null }, ...statusOptions]"
        :placeholder="t('notion.statusMap.waiting.placeholder')"
        class="w-full"
        size="lg"
      />
    </UFormField>

    <!-- Archive (optional) -->
    <UFormField 
      :label="t('notion.statusMap.archive.label')" 
      :help="t('notion.statusMap.archive.help')"
    >
      <USelect
        v-model="mapping.archive"
        :items="[{ label: t('notion.wizard.noneOption'), value: null }, ...statusOptions]"
        :placeholder="t('notion.statusMap.archive.placeholder')"
        class="w-full"
        size="lg"
      />
    </UFormField>

    <UAlert
      v-if="duplicateStatuses.length > 0"
      color="warning"
      variant="subtle"
      icon="i-ph-warning"
      class="md:col-span-2"
    >
      <template #description>
        <strong>{{ t('notion.wizard.warningLabel') }}</strong> {{ t('notion.statusMap.duplicates', { values: duplicateStatuses.join(', ') }) }}
      </template>
    </UAlert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { NotionDatabaseSchema, NotionStatusMapping } from "~/types/notion";

defineOptions({ name: 'NotionStatusMappingStep' });

/**
 * Props
 * @prop {NotionDatabaseSchema} databaseSchema Database schema containing available Notion properties
 * @prop {string} statusPropertyName Name of the status property to get options from
 * @prop {NotionStatusMapping=} defaultMapping Optional initial status mapping configuration
 */
const props = defineProps<{
  /** Database schema containing available Notion properties */
  databaseSchema: NotionDatabaseSchema;
  /** Name of the status property to get options from */
  statusPropertyName: string;
  /** Optional initial status mapping configuration */
  defaultMapping?: NotionStatusMapping;
}>();

const emit = defineEmits<{
  /** Emitted when mapping is saved and validated */
  (e: "saved", mapping: NotionStatusMapping): void;
}>();

const { t } = useI18n();

const mapping = ref<NotionStatusMapping>(
  props.defaultMapping ? {
    ...props.defaultMapping,
    waiting: props.defaultMapping.waiting || null,
    archive: props.defaultMapping.archive || null,
  } : {
    today: "",
    doing: "",
    done: "",
    waiting: null,
    archive: null,
  },
);

// Get status options from the database schema
/**
 * Builds the list of available status option labels from the database schema.
 */
const computeStatusOptions = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema || !props.statusPropertyName) return [];

  const statusProperty = props.databaseSchema[props.statusPropertyName];
  if (!statusProperty) return [];

  // Handle both select and status property types
  const options = statusProperty.select?.options || statusProperty.status?.options || [];

  return options.map((option: { id: string; name: string; color: string }) => ({
    label: option.name,
    value: option.name,
  }));
};

const statusOptions = computed(computeStatusOptions);

// Check for duplicate status mappings
/**
 * Computes a list of duplicate status values from the current mapping.
 */
const computeDuplicateStatuses = (): string[] => {
  const values = [mapping.value.today, mapping.value.doing, mapping.value.done];
  if (mapping.value.waiting) {
    values.push(mapping.value.waiting);
  }
  if (mapping.value.archive) {
    values.push(mapping.value.archive);
  }

  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (value && seen.has(value)) {
      duplicates.push(value);
    } else if (value) {
      seen.add(value);
    }
  }

  return duplicates;
};

const duplicateStatuses = computed(computeDuplicateStatuses);

// Auto-assign status values based on common naming patterns
/**
 * Attempts to auto-assign common status names if the mapping is currently empty.
 */
const handleStatusOptionsChange = (
  newOptions: Array<{ label: string; value: string }>,
) => {
  if (newOptions.length === 0) return;

  // Auto-assign if not already set
  if (!mapping.value.today) {
    const todayOption = newOptions.find((opt) =>
      opt.label.toLowerCase().includes('today') ||
      opt.label.toLowerCase().includes('heute') ||
      opt.label.toLowerCase().includes('todo') ||
      opt.label.toLowerCase().includes('to do'),
    );
    if (todayOption) mapping.value.today = todayOption.value;
  }

  if (!mapping.value.doing) {
    const doingOption = newOptions.find((opt) =>
      opt.label.toLowerCase().includes('doing') ||
      opt.label.toLowerCase().includes('in progress') ||
      opt.label.toLowerCase().includes('bearbeitung') ||
      opt.label.toLowerCase().includes('progress'),
    );
    if (doingOption) mapping.value.doing = doingOption.value;
  }

  if (!mapping.value.done) {
    const doneOption = newOptions.find((opt) =>
      opt.label.toLowerCase().includes('done') ||
      opt.label.toLowerCase().includes('complete') ||
      opt.label.toLowerCase().includes('erledigt') ||
      opt.label.toLowerCase().includes('fertig'),
    );
    if (doneOption) mapping.value.done = doneOption.value;
  }

  if (!mapping.value.waiting) {
    const waitingOption = newOptions.find((opt) =>
      opt.label.toLowerCase().includes('waiting') ||
      opt.label.toLowerCase().includes('blocked') ||
      opt.label.toLowerCase().includes('wartend') ||
      opt.label.toLowerCase().includes('warten'),
    );
    if (waitingOption) mapping.value.waiting = waitingOption.value;
  }

  if (!mapping.value.archive) {
    const archiveOption = newOptions.find((opt) =>
      opt.label.toLowerCase().includes('archive') ||
      opt.label.toLowerCase().includes('archiv'),
    );
    if (archiveOption) mapping.value.archive = archiveOption.value;
  }
};

watch(statusOptions, handleStatusOptionsChange, { immediate: true });

/**
 * Validates if the mapping contains all required fields
 */
const isMappingValid = (mapping: NotionStatusMapping): boolean => {
  return !!(mapping.today && mapping.doing && mapping.done) && duplicateStatuses.value.length === 0;
};

/**
 * Saves the mapping if valid and emits saved event
 */
const save = () => {
  if (isMappingValid(mapping.value)) {
    // Clean up waiting if it's empty
    const cleanMapping = {
      ...mapping.value,
      waiting: mapping.value.waiting || undefined,
      archive: mapping.value.archive || undefined,
    };
    emit("saved", cleanMapping);
  }
};

/**
 * Reactive indicator whether the current status mapping is valid.
 */
const isMappingValidComputed = computed(() => isMappingValid(mapping.value));

defineExpose({
  save,
  isMappingValid: isMappingValidComputed,
});
</script>
