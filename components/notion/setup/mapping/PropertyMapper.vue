<!--
@component PropertyMapper
@kind component
@category input
@description Maps Notion database properties to kan-do task fields
@usage Part of the Notion setup wizard that configures how database fields correspond to task properties
@avoid Only maps Notion properties to task fields inside the Notion setup; not a generic key-value editor.
@responsibility
- Allows selection of title, status, and optional fields (due date, priority, timebox, time spent)
- Validates mapping configuration
- Provides save functionality for completing setup
-->
<template>
  <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
    <!-- Title (required) -->
    <UFormField 
      :label="t('notion.mapping.title.label')" 
      required 
      :help="t('notion.mapping.title.help')"
    >
      <USelect
        v-model="mapping.title"
        :items="titleProperties"
        :placeholder="t('notion.mapping.title.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Status (required) -->
    <UFormField 
      :label="t('notion.mapping.status.label')" 
      required 
      :help="t('notion.mapping.status.help')"
    >
      <USelect
        v-model="mapping.status"
        :items="statusProperties"
        :placeholder="t('notion.mapping.status.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Due date (optional) -->
    <UFormField 
      :label="t('notion.mapping.dueDate.label')" 
      :help="t('notion.mapping.dueDate.help')"
    >
      <USelect
        v-model="mapping.dueDate"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...dateProperties]"
        :placeholder="t('notion.mapping.dueDate.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Priority (optional) -->
    <UFormField 
      :label="t('notion.mapping.priority.label')" 
      :help="t('notion.mapping.priority.help')"
    >
      <USelect
        v-model="mapping.priority"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...selectProperties]"
        :placeholder="t('notion.mapping.priority.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Topic (optional) -->
    <UFormField 
      :label="t('notion.mapping.topic.label')" 
      :help="t('notion.mapping.topic.help')"
    >
      <USelect
        v-model="mapping.topic"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...topicProperties]"
        :placeholder="t('notion.mapping.topic.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Activity (optional) -->
    <UFormField 
      :label="t('notion.mapping.activity.label')" 
      :help="t('notion.mapping.activity.help')"
    >
      <USelect
        v-model="mapping.activity"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...activityProperties]"
        :placeholder="t('notion.mapping.activity.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Timebox (optional) -->
    <UFormField 
      :label="t('notion.mapping.timeBox.label')" 
      :help="t('notion.mapping.timeBox.help')"
    >
      <USelect
        v-model="mapping.timeBox"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...timeboxProperties]"
        :placeholder="t('notion.mapping.timeBox.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Timebox unit (shown when a timeBox field is selected) -->
    <UFormField 
      v-if="mapping.timeBox"
      :label="t('notion.mapping.timeBoxUnit.label')" 
      :help="t('notion.mapping.timeBoxUnit.help')"
    >
      <USelect
        v-model="mapping.timeBoxUnit"
        :items="timeBoxUnitOptions"
        :placeholder="t('notion.mapping.unitPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Time spent (optional) -->
    <UFormField 
      :label="t('notion.mapping.timeSpent.label')" 
      :help="t('notion.mapping.timeSpent.help')"
    >
      <USelect
        v-model="mapping.timeSpent"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...timeSpentProperties]"
        :placeholder="t('notion.mapping.timeSpent.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Time spent unit (shown when a timeSpent number field is selected) -->
    <UFormField 
      v-if="mapping.timeSpent"
      :label="t('notion.mapping.timeSpentUnit.label')" 
      :help="t('notion.mapping.timeSpentUnit.help')"
    >
      <USelect
        v-model="mapping.timeSpentUnit"
        :items="timeUnitOptions"
        :placeholder="t('notion.mapping.unitPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Completed date (optional) -->
    <UFormField 
      :label="t('notion.mapping.completedDate.label')" 
      :help="t('notion.mapping.completedDate.help')"
    >
      <USelect
        v-model="mapping.completedDate"
        :items="[{ label: t('notion.mapping.noField'), value: null }, ...dateProperties]"
        :placeholder="t('notion.mapping.completedDate.placeholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Unplanned (optional) -->
    <UFormField 
      class="md:col-span-2"
      :label="t('notion.mapping.unplanned.label')" 
      :help="t('notion.mapping.unplanned.help')"
    >
      <div class="space-y-3">
        <!-- Mode selector -->
        <USelect
          v-model="unplannedMode"
          :items="unplannedModeOptions"
          :placeholder="t('notion.mapping.unplanned.modeNone')"
          class="w-full"
        />
        
        <!-- Boolean mode: checkbox property selector -->
        <template v-if="unplannedMode === 'boolean'">
          <USelect
            v-model="unplannedBooleanProperty"
            :items="[{ label: t('notion.mapping.unplanned.selectField'), value: null }, ...checkboxProperties]"
            :placeholder="t('notion.mapping.unplanned.checkboxPlaceholder')"
            class="w-full"
          />
        </template>
        
        <!-- Value mode: property + value selector -->
        <template v-if="unplannedMode === 'value'">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <USelect
              v-model="unplannedValueProperty"
              :items="[{ label: t('notion.mapping.unplanned.selectField'), value: null }, ...valueMatchableProperties]"
              :placeholder="t('notion.mapping.unplanned.selectField')"
              class="w-full"
            />
            
            <!-- Show available values or allow custom input -->
            <template v-if="unplannedValueProperty">
              <USelect
                v-if="availableUnplannedValues.length > 0"
                :model-value="unplannedMatchValue ?? undefined"
                :items="availableUnplannedValues"
                :placeholder="t('notion.mapping.unplanned.valuePlaceholder')"
                class="w-full"
                searchable
                creatable
                @update:model-value="unplannedMatchValue = $event ?? null"
              />
              <UInput
                v-else
                :model-value="unplannedMatchValue ?? undefined"
                :placeholder="t('notion.mapping.unplanned.valueInputPlaceholder')"
                class="w-full"
                @update:model-value="unplannedMatchValue = $event ?? null"
              />
            </template>
          </div>
        </template>
      </div>
    </UFormField>
  </div>
</template>

<script setup lang="ts">
/**
 * Script setup for PropertyMapper: handles local mapping state, schema-derived options,
 * validation, and emits the final mapping.
 */
import { ref, computed, watch, toRef } from "vue";
import { useI18n } from "vue-i18n";
import type { NotionDatabaseSchema, NotionPropertyMapping, CustomPropertyType } from "~/types/notion";
// Import removed as it's currently unused

defineOptions({ name: 'NotionPropertyMapper' });

/**
 * Props for PropertyMapper component.
 */
/**
 * Props
 * @prop {NotionDatabaseSchema} databaseSchema Database schema containing available Notion properties
 * @prop {NotionPropertyMapping=} defaultMapping Optional initial mapping configuration
 */
const props = defineProps<{
  /** Database schema containing available Notion properties */
  databaseSchema: NotionDatabaseSchema;
  /** Optional initial mapping configuration */
  defaultMapping?: NotionPropertyMapping;
}>();

// Store import removed as it's currently unused

const { t } = useI18n();

const emit = defineEmits<{
  /** Emitted when mapping is saved and validated */
  (e: "saved", mapping: NotionPropertyMapping): void;
}>();

const mapping = ref<NotionPropertyMapping>({
  title: "",
  status: "",
  dueDate: null,
  priority: null,
  topic: null,
  activity: null,
  timeBox: null,
  timeBoxUnit: undefined,
  timeSpent: null,
  timeSpentUnit: undefined,
  completedDate: null,
  customProperties: [],
  unplanned: null,
});

/**
 * Initialize local mapping state from the optional defaultMapping prop.
 * Ensures optional fields are normalized to null when absent.
 */
const initializeMapping = () => {
  if (props.defaultMapping) {
    mapping.value = {
      ...props.defaultMapping,
      dueDate: props.defaultMapping.dueDate || null,
      priority: props.defaultMapping.priority || null,
      topic: props.defaultMapping.topic || null,
      activity: props.defaultMapping.activity || null,
      timeBox: props.defaultMapping.timeBox || null,
      // Preserve unit from existing config; remain undefined if not set (back-compat)
      timeBoxUnit: props.defaultMapping.timeBoxUnit,
      timeSpent: props.defaultMapping.timeSpent || null,
      // Preserve unit from existing config; remain undefined if not set (back-compat)
      timeSpentUnit: props.defaultMapping.timeSpentUnit,
      completedDate: props.defaultMapping.completedDate || null,
      customProperties: props.defaultMapping.customProperties || [],
      unplanned: props.defaultMapping.unplanned || null,
    };
  }
};

// Watch for changes in defaultMapping prop and reinitialize
/**
 * Re-initialize local mapping when the optional defaultMapping prop changes.
 */
const handleDefaultMappingChange = () => {
  initializeMapping();
};

const defaultMappingRef = toRef(props, "defaultMapping");

watch(defaultMappingRef, handleDefaultMappingChange, {
  immediate: true,
  deep: true,
});

// Filter and format properties by type
/**
 * Build list of Notion title properties from the provided database schema.
 */
const computeTitleProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => name && prop && prop.type === "title")
    .map(([name]) => ({ label: name, value: name }));
};

const titleProperties = computed(computeTitleProperties);

/**
 * Build list of Notion status/select properties usable for status mapping.
 */
const computeStatusProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(
      ([name, prop]) =>
        name && prop && (prop.type === "select" || prop.type === "status"),
    )
    .map(([name]) => ({ label: name, value: name }));
};

const statusProperties = computed(computeStatusProperties);

/**
 * Build list of Notion date properties usable for due date mapping.
 */
const computeDateProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => name && prop && prop.type === "date")
    .map(([name]) => ({ label: name, value: name }));
};

const dateProperties = computed(computeDateProperties);

/**
 * Build list of Notion properties related to timebox/duration/estimate.
 */
const computeTimeboxProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(
      ([name, prop]) =>
        name &&
        prop &&
        (prop.type === "number" ||
          (prop.type === "select" && name.toLowerCase().includes("time"))),
    )
    .map(([name]) => ({ label: name, value: name }));
};

const timeboxProperties = computed(computeTimeboxProperties);

/**
 * Build list of Notion properties related to time spent/actual/logged.
 */
const computeTimeSpentProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(
      ([name, prop]) =>
        name &&
        prop &&
        (prop.type === "number" ||
          (prop.type === "select" && name.toLowerCase().includes("time"))),
    )
    .map(([name]) => ({ label: name, value: name }));
};

const timeSpentProperties = computed(computeTimeSpentProperties);

// Unit options for time spent mapping
const timeUnitOptions = computed(() => [
  { label: t('notion.mapping.unit.seconds'), value: 'seconds' },
  { label: t('notion.mapping.unit.minutes'), value: 'minutes' },
  { label: t('notion.mapping.unit.hours'), value: 'hours' },
]);

// Unit options for timebox mapping
const timeBoxUnitOptions = computed(() => [
  ...timeUnitOptions.value,
  { label: t('notion.mapping.unit.formatted'), value: 'formatted' },
]);

/**
 * Build list of Notion select properties.
 */
const computeSelectProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => name && prop && prop.type === "select")
    .map(([name]) => ({ label: name, value: name }));
};

const selectProperties = computed(computeSelectProperties);

const computeTopicProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => {
      if (!name || !prop) return false;
      return (
        prop.type === "select" ||
        prop.type === "multi_select" ||
        prop.type === "rich_text" ||
        prop.type === "title"
      );
    })
    .map(([name]) => ({ label: name, value: name }));
};

const topicProperties = computed(computeTopicProperties);

const computeActivityProperties = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => {
      if (!name || !prop) return false;
      return (
        prop.type === "select" ||
        prop.type === "multi_select" ||
        prop.type === "rich_text" ||
        prop.type === "title"
      );
    })
    .map(([name]) => ({ label: name, value: name }));
};

const activityProperties = computed(computeActivityProperties);

// Define mandatory fields for the mapping
const MANDATORY_FIELDS = ["title", "status"] as const;

/**
 * Auto-populate the required title mapping on first schema load if not provided via defaults.
 */
const handleTitlePropertiesChange = (
  newTitles: Array<{ label: string; value: string }>,
) => {
  if (newTitles.length > 0 && !mapping.value.title && !props.defaultMapping) {
    const titleProperty = newTitles.find((prop) =>
      prop.label.toLowerCase().includes("title"),
    );
    const fallback = newTitles[0]?.value;
    if (titleProperty?.value) {
      mapping.value.title = titleProperty.value;
    } else if (fallback) {
      mapping.value.title = fallback;
    }
  }
};

watch(titleProperties, handleTitlePropertiesChange, { immediate: true });

/**
 * Auto-populate the required status mapping on first schema load if not provided via defaults.
 */
const handleStatusPropertiesChange = (
  newStatuses: Array<{ label: string; value: string }>,
) => {
  if (
    newStatuses.length > 0 &&
    !mapping.value.status &&
    !props.defaultMapping
  ) {
    const statusProperty = newStatuses.find((prop) =>
      prop.label.toLowerCase().includes("status"),
    );
    const fallback = newStatuses[0]?.value;
    if (statusProperty?.value) {
      mapping.value.status = statusProperty.value;
    } else if (fallback) {
      mapping.value.status = fallback;
    }
  }
};

watch(statusProperties, handleStatusPropertiesChange, { immediate: true });

/**
 * Auto-select a likely due date property, or leave unset (null) when not obvious.
 */
const handleDatePropertiesChange = (
  newDateProperties: Array<{ label: string; value: string }>,
) => {
  if (!mapping.value.dueDate && !props.defaultMapping) {
    const dueDateProperty = newDateProperties.find((prop) =>
      prop.label.toLowerCase().includes("due date"),
    );
    mapping.value.dueDate = dueDateProperty ? dueDateProperty.value : null;
  }
};

watch(dateProperties, handleDatePropertiesChange, { immediate: true });

/**
 * Auto-select a likely priority property (optional), else leave unset (null).
 */
const handleSelectPropertiesChange = (
  newSelectProperties: Array<{ label: string; value: string }>,
) => {
  if (!mapping.value.priority && !props.defaultMapping) {
    const priorityProperty = newSelectProperties.find((prop) =>
      prop.label.toLowerCase().includes("priority"),
    );
    mapping.value.priority = priorityProperty ? priorityProperty.value : null;
  }
};

watch(selectProperties, handleSelectPropertiesChange, { immediate: true });

/**
 * Auto-select a likely topic property (optional), else leave unset (null).
 */
const handleTopicPropertiesChange = (
  newTopicProperties: Array<{ label: string; value: string }>,
) => {
  if (!mapping.value.topic && !props.defaultMapping) {
    const topicProperty = newTopicProperties.find((prop) => {
      const label = prop.label.toLowerCase();
      return label.includes("topic") || label.includes("thema");
    });
    mapping.value.topic = topicProperty ? topicProperty.value : null;
  }
};

watch(topicProperties, handleTopicPropertiesChange, { immediate: true });

/**
 * Auto-select a likely activity property (optional), else leave unset (null).
 */
const handleActivityPropertiesChange = (
  newActivityProperties: Array<{ label: string; value: string }>,
) => {
  if (!mapping.value.activity && !props.defaultMapping) {
    const activityProperty = newActivityProperties.find((prop) => {
      const label = prop.label.toLowerCase();
      return (
        label.includes("aktivität") ||
        label.includes("aufgabenart") ||
        label.includes("aufgabenkategorie") ||
        label.includes("kategorie")
      );
    });
    mapping.value.activity = activityProperty ? activityProperty.value : null;
  }
};

watch(activityProperties, handleActivityPropertiesChange, { immediate: true });

/**
 * Auto-select a likely timebox/duration/estimate property (optional), else leave unset (null).
 */
const handleTimeboxPropertiesChange = (
  newTimeboxProperties: Array<{ label: string; value: string }>,
) => {
  if (!mapping.value.timeBox && !props.defaultMapping) {
    const timeboxProperty = newTimeboxProperties.find((prop) => {
      const label = prop.label.toLowerCase();
      return (
        label.includes("timebox") ||
        label.includes("duration") ||
        label.includes("estimate")
      );
    });
    mapping.value.timeBox = timeboxProperty ? timeboxProperty.value : null;
  }
};

watch(timeboxProperties, handleTimeboxPropertiesChange, { immediate: true });

/**
 * Auto-select a likely time-spent/actual/logged property (optional), else leave unset (null).
 */
const handleTimeSpentPropertiesChange = (
  newTimeSpentProperties: Array<{ label: string; value: string }>,
) => {
  if (!mapping.value.timeSpent && !props.defaultMapping) {
    const timeSpentProperty = newTimeSpentProperties.find((prop) => {
      const label = prop.label.toLowerCase();
      return (
        label.includes("time spent") ||
        label.includes("actual") ||
        label.includes("logged")
      );
    });
    mapping.value.timeSpent = timeSpentProperty ? timeSpentProperty.value : null;
  }
};

watch(timeSpentProperties, handleTimeSpentPropertiesChange, { immediate: true });

// When timeSpent is selected for the first time, auto-detect unit based on field type
watch(
  () => mapping.value.timeSpent,
  (newVal, oldVal) => {
    if (newVal && !oldVal && !mapping.value.timeSpentUnit) {
      // Auto-detect unit based on the property type in the schema
      const propertyType = props.databaseSchema?.[newVal]?.type;
      
      if (propertyType === 'number') {
        // For number fields, default to minutes (most common for time tracking)
        mapping.value.timeSpentUnit = 'minutes';
      } else {
        // For select or other types, still default to minutes but user can change
        mapping.value.timeSpentUnit = 'minutes';
      }
    }
    if (!newVal) {
      // Clear unit when timeSpent mapping is removed
      mapping.value.timeSpentUnit = undefined;
    }
  }
);

// When timeBox is selected for the first time, auto-detect unit based on field type
watch(
  () => mapping.value.timeBox,
  (newVal, oldVal) => {
    if (newVal && !oldVal && !mapping.value.timeBoxUnit) {
      // Auto-detect unit based on the property type in the schema
      const propertyType = props.databaseSchema?.[newVal]?.type;
      
      if (propertyType === 'number') {
        // For number fields, default to minutes (most common for timeboxing)
        mapping.value.timeBoxUnit = 'minutes';
      } else {
        // For select, rich_text, or other types, use formatted parsing
        mapping.value.timeBoxUnit = 'formatted';
      }
    }
    if (!newVal) {
      // Clear unit when timeBox mapping is removed
      mapping.value.timeBoxUnit = undefined;
    }
  }
);

/**
 * Unplanned mapping state
 */
const unplannedMode = ref<'boolean' | 'value' | null>(null);
const unplannedBooleanProperty = ref<string | null>(null);
const unplannedValueProperty = ref<string | null>(null);
const unplannedMatchValue = ref<string | null>(null);

const unplannedModeOptions = computed(() => [
  { label: t('notion.mapping.unplanned.modeNone'), value: null },
  { label: t('notion.mapping.unplanned.modeBoolean'), value: 'boolean' },
  { label: t('notion.mapping.unplanned.modeValue'), value: 'value' },
]);

/**
 * Build list of checkbox properties for boolean mode
 */
const checkboxProperties = computed(() => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => name && prop && prop.type === 'checkbox')
    .map(([name]) => ({ label: name, value: name }));
});

/**
 * Build list of properties that can be used for value matching
 */
const valueMatchableProperties = computed(() => {
  if (!props.databaseSchema) return [];
  return Object.entries(props.databaseSchema)
    .filter(([name, prop]) => {
      if (!name || !prop) return false;
      return (
        prop.type === 'select' ||
        prop.type === 'multi_select' ||
        prop.type === 'rich_text' ||
        prop.type === 'title'
      );
    })
    .map(([name]) => ({ label: name, value: name }));
});

/**
 * Get available values for the selected property (for select/multi_select)
 */
const availableUnplannedValues = computed(() => {
  if (!unplannedValueProperty.value || !props.databaseSchema) return [];
  
  const prop = props.databaseSchema[unplannedValueProperty.value];
  if (!prop) return [];
  
  const options: Array<{ label: string; value: string }> = [];
  
  // Extract options from select
  if (prop.select?.options) {
    options.push(...prop.select.options.map(opt => ({
      label: opt.name,
      value: opt.name,
    })));
  }
  
  // Extract options from multi_select (if using multi_select type)
  if (prop.multi_select?.options) {
    options.push(...prop.multi_select.options.map(opt => ({
      label: opt.name,
      value: opt.name,
    })));
  }
  
  return options;
});

// Initialize unplanned state from defaultMapping
watch(
  () => props.defaultMapping?.unplanned,
  (unplannedMapping) => {
    if (unplannedMapping) {
      unplannedMode.value = unplannedMapping.mode;
      if (unplannedMapping.mode === 'boolean') {
        unplannedBooleanProperty.value = unplannedMapping.propertyName ?? null;
      } else if (unplannedMapping.mode === 'value') {
        unplannedValueProperty.value = unplannedMapping.valuePropertyName ?? null;
        unplannedMatchValue.value = unplannedMapping.matchValue ?? null;
      }
    }
  },
  { immediate: true }
);

// Sync unplanned UI state back to mapping
watch(
  [unplannedMode, unplannedBooleanProperty, unplannedValueProperty, unplannedMatchValue],
  () => {
    if (!unplannedMode.value) {
      mapping.value.unplanned = null;
    } else if (unplannedMode.value === 'boolean') {
      mapping.value.unplanned = {
        mode: 'boolean',
        propertyName: unplannedBooleanProperty.value ?? undefined,
      };
    } else if (unplannedMode.value === 'value') {
      // Determine property type from schema
      let propertyType: 'select' | 'multi_select' | 'rich_text' | 'title' | undefined;
      if (unplannedValueProperty.value && props.databaseSchema) {
        const prop = props.databaseSchema[unplannedValueProperty.value];
        if (prop) {
          propertyType = prop.type as 'select' | 'multi_select' | 'rich_text' | 'title';
        }
      }
      
      mapping.value.unplanned = {
        mode: 'value',
        valuePropertyName: unplannedValueProperty.value ?? undefined,
        matchValue: unplannedMatchValue.value ?? undefined,
        propertyType,
      };
    }
  },
  { deep: true }
);

// Clear dependent fields when mode changes
watch(unplannedMode, (newMode, oldMode) => {
  if (newMode !== oldMode) {
    if (newMode !== 'boolean') {
      unplannedBooleanProperty.value = null;
    }
    if (newMode !== 'value') {
      unplannedValueProperty.value = null;
      unplannedMatchValue.value = null;
    }
  }
});

/**
 * Validates if the mapping contains all required fields
 */
const isMappingValid = (mapping: NotionPropertyMapping): boolean => {
  return MANDATORY_FIELDS.every((field) => !!mapping[field]);
};

/**
 * Reactive indicator whether the current mapping has all mandatory fields (gates the wizard's "Weiter").
 */
const isMappingValidComputed = computed(() => isMappingValid(mapping.value));

/**
 * Saves the mapping if valid and emits saved event.
 */
const save = () => {
  syncCustomProperties()
  if (isMappingValid(mapping.value)) {
    emit("saved", mapping.value);
  }
};

const supportedCustomTypes: CustomPropertyType[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'phone_number',
]

const eligibleCustomProps = computed(() => {
  if (!props.databaseSchema) return []
  const coreFields = new Set(
    [
      mapping.value.title,
      mapping.value.status,
      mapping.value.dueDate ?? undefined,
      mapping.value.priority ?? undefined,
      mapping.value.topic ?? undefined,
      mapping.value.activity ?? undefined,
      mapping.value.timeBox ?? undefined,
      mapping.value.timeSpent ?? undefined,
      mapping.value.completedDate ?? undefined,
      mapping.value.unplanned?.propertyName ?? undefined,
      mapping.value.unplanned?.valuePropertyName ?? undefined,
    ].filter((field): field is string => typeof field === 'string' && field.length > 0)
  )

  return Object.entries(props.databaseSchema)
    .filter(([name, schemaEntry]) => {
      if (!name || !schemaEntry) return false
      if (coreFields.has(name)) return false
      return supportedCustomTypes.includes(schemaEntry.type as CustomPropertyType)
    })
    .map(([name, schemaEntry]) => ({
      name,
      type: schemaEntry.type as CustomPropertyType,
    }))
})

const customSelections = ref<Record<string, { enabled: boolean; label: string | null }>>({})

const customPropertyDefaults = computed(() => {
  const defaults: Record<string, { key?: string; label?: string | null; type?: CustomPropertyType }> = {}
  for (const prop of props.defaultMapping?.customProperties ?? []) {
    defaults[prop.name] = {
      key: prop.key,
      label: prop.label ?? prop.name,
      type: prop.type,
    }
  }
  return defaults
})

const buildCustomPropertiesPayload = (
  selections: Record<string, { enabled: boolean; label: string | null }>,
) => {
  const previous = mapping.value.customProperties ?? []
  const defaults = customPropertyDefaults.value

  return Object.entries(selections)
    .filter(([, state]) => state.enabled)
    .map(([name, state]) => {
      const schemaEntry = props.databaseSchema?.[name]
      const prev = previous.find((prop) => prop.name === name)
      const base = defaults[name]
      const type = (schemaEntry?.type ?? prev?.type ?? base?.type ?? 'text') as CustomPropertyType
      const label = state.label ?? prev?.label ?? base?.label ?? name
      const key = prev?.key ?? base?.key ?? name

      return {
        name,
        key,
        type,
        enabled: true,
        label,
      }
    })
}

const syncCustomProperties = () => {
  mapping.value.customProperties = buildCustomPropertiesPayload(customSelections.value)
}

watch(
  eligibleCustomProps,
  (latest) => {
    const nextSelections: Record<string, { enabled: boolean; label: string | null }> = {}
    const currentSelections = customSelections.value
    const defaults = customPropertyDefaults.value

    for (const entry of latest) {
      const existing = mapping.value.customProperties?.find((prop) => prop.name === entry.name)
      const previous = currentSelections[entry.name]
      const base = defaults[entry.name]
      nextSelections[entry.name] = {
        enabled: existing?.enabled ?? previous?.enabled ?? false,
        label: existing?.label ?? previous?.label ?? base?.label ?? entry.name,
      }
    }

    customSelections.value = nextSelections
    syncCustomProperties()
  },
  { immediate: true }
)

watch(
  customSelections,
  () => {
    syncCustomProperties()
  },
  { deep: true, flush: 'sync' }
)

watch(
  () => mapping.value.customProperties,
  (propsArray) => {
    if (!Array.isArray(propsArray)) return
    for (const entry of propsArray) {
      if (!entry.key) {
        entry.key = entry.name
      }
    }
  },
  { immediate: true }
)

defineExpose({
  save,
  isMappingValid: isMappingValidComputed,
  eligibleCustomProps,
  customSelections,
})

</script>