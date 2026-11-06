<!--
@component PriorityMappingStep
@description Maps kan-do's three priority levels to Notion select options (#617): several options may share a level
@usage Part of the Notion setup wizard and the priority tab of the Notion settings
@responsibility
- High (required), Regular and Low (optional) each take any number of the property's options (multi-select);
  an option listed under two levels is flagged
- Reads a mapping saved before #617 (urgent/high/medium/low) through `normalizePriorityMapping`
- The first option of a level is what kan-do writes back to Notion
- Validates the mapping and emits it on save
- Suggests options by name only when no mapping is stored: a stored mapping is shown exactly as stored, a level stored as empty stays empty (#636)
- Emits `change` for the user's own edits only: the suggestion (also when the schema loads late) never counts as an edit (#627)
- `reset()` restores the form as it was on first open, also when no mapping is stored (#627)
-->
<template>
  <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
    <div class="text-sm text-muted md:col-span-2">
      {{ t('notion.priorityMap.intro') }}
    </div>

    <UFormField
      v-for="level in levels"
      :key="level.key"
      :label="t(`notion.priorityMap.${level.key}.label`)"
      :required="level.required"
      :help="t(`notion.priorityMap.${level.key}.help`)"
    >
      <USelectMenu
        :model-value="mapping[level.key]"
        multiple
        value-key="value"
        :items="priorityOptions"
        :search-input="false"
        :placeholder="t(`notion.priorityMap.${level.key}.placeholder`)"
        class="w-full"
        size="lg"
        :data-testid="`priority-map-${level.key}`"
        @update:model-value="editLevel(level.key, $event)"
      />
    </UFormField>

    <UAlert
      v-if="duplicatePriorities.length > 0"
      color="warning"
      variant="subtle"
      icon="i-ph-warning"
      class="md:col-span-2"
    >
      <template #description>
        <strong>{{ t('notion.wizard.warningLabel') }}</strong> {{ t('notion.priorityMap.duplicates', { values: duplicatePriorities.join(', ') }) }}
      </template>
    </UAlert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { NotionDatabaseSchema, NotionPriorityMapping, LegacyNotionPriorityMapping } from "~/types/notion";
import { normalizePriorityMapping } from "~/lib/priority";

defineOptions({ name: 'NotionPriorityMappingStep' });

/**
 * Props
 * @prop {NotionDatabaseSchema} databaseSchema Database schema containing available Notion properties
 * @prop {string} priorityPropertyName Name of the priority property to get options from
 * @prop {NotionPriorityMapping=} defaultMapping Optional initial priority mapping (a pre-#617 shape is read too)
 */
const props = defineProps<{
  /** Database schema containing available Notion properties */
  databaseSchema: NotionDatabaseSchema;
  /** Name of the priority property to get options from */
  priorityPropertyName: string;
  /** Optional initial priority mapping configuration */
  defaultMapping?: NotionPriorityMapping | LegacyNotionPriorityMapping;
}>();

const emit = defineEmits<{
  /**
   * `saved`: the mapping was saved and validated.
   * `change`: a copy of the mapping each time the user edits a level (never for the suggestion or a reset).
   */
  (e: "saved" | "change", mapping: NotionPriorityMapping): void;
}>();

const { t } = useI18n();

type LevelKey = keyof NotionPriorityMapping;

/** The three levels, highest first; only High is required */
const levels: Array<{ key: LevelKey; required: boolean }> = [
  { key: "high", required: true },
  { key: "regular", required: false },
  { key: "low", required: false },
];

const mapping = ref<NotionPriorityMapping>(
  normalizePriorityMapping(props.defaultMapping) ?? { high: [], regular: [], low: [] },
);

// Get priority options from the database schema
/**
 * Builds the list of available priority option labels from the database schema.
 */
const computePriorityOptions = (): Array<{ label: string; value: string }> => {
  if (!props.databaseSchema || !props.priorityPropertyName) return [];

  const priorityProperty = props.databaseSchema[props.priorityPropertyName];
  if (!priorityProperty) return [];

  // Handle both select and status property types
  const options = priorityProperty.select?.options || priorityProperty.status?.options || [];

  return options.map((option: { id: string; name: string; color: string }) => ({
    label: option.name,
    value: option.name,
  }));
};

const priorityOptions = computed(computePriorityOptions);

/**
 * Option values that more than one level lists (the higher level would win on read).
 */
const computeDuplicatePriorities = (): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { key } of levels) {
    for (const value of mapping.value[key]) {
      if (seen.has(value)) duplicates.add(value);
      else seen.add(value);
    }
  }
  return [...duplicates];
};

const duplicatePriorities = computed(computeDuplicatePriorities);

/**
 * Option-name hints (German and English user data) per level; matched on the lower-cased option label.
 * The order matters: the best-fitting option is listed first and that is the one written back to Notion,
 * so the plain High names come before Urgent ones.
 */
const NAME_HINTS: Record<LevelKey, string[]> = {
  high: ['high', 'hoch', 'wichtig', 'urgent', 'dringend', 'critical', 'kritisch'],
  regular: ['medium', 'mittel', 'normal'],
  low: ['low', 'niedrig', 'gering'],
};

// Auto-assign priority values based on common naming patterns
/**
 * Fills a level that is still empty with the options whose name fits it and that no other level uses.
 * Only without a stored mapping: a stored one is what the user sees, also its empty levels (#636), so open,
 * Cancel and the next save agree.
 */
const handlePriorityOptionsChange = (
  newOptions: Array<{ label: string; value: string }>,
) => {
  if (newOptions.length === 0) return;
  if (normalizePriorityMapping(props.defaultMapping)) return;

  for (const { key } of levels) {
    if (mapping.value[key].length > 0) continue;
    const taken = new Set(levels.flatMap((level) => mapping.value[level.key]));
    const hintRank = (label: string) => NAME_HINTS[key].findIndex((hint) => label.toLowerCase().includes(hint));
    mapping.value[key] = newOptions
      .filter((opt) => !taken.has(opt.value) && hintRank(opt.label) >= 0)
      .sort((a, b) => hintRank(a.label) - hintRank(b.label))
      .map((opt) => opt.value);
  }
};

watch(priorityOptions, handlePriorityOptionsChange, { immediate: true });

/**
 * A level edited by the user: stores it and reports the mapping. Only this path emits `change`, so the
 * suggestion above (which can run late, when the schema arrives after the form opened) never marks the form dirty (#627).
 */
const editLevel = (key: LevelKey, values: string[]) => {
  mapping.value[key] = [...values];
  const value = mapping.value;
  emit("change", { high: [...value.high], regular: [...value.regular], low: [...value.low] });
};

// A new default (a save) replaces what is shown
watch(() => props.defaultMapping, (value) => {
  mapping.value = normalizePriorityMapping(value) ?? { high: [], regular: [], low: [] };
});

/**
 * Restores the form (the settings tab's Cancel). A stored mapping comes back exactly as stored. Without
 * one the default prop does not change, so the watcher above cannot do it: the form starts empty and gets
 * the suggestion again, as on first open.
 */
const reset = () => {
  const stored = normalizePriorityMapping(props.defaultMapping);
  mapping.value = stored ?? { high: [], regular: [], low: [] };
  if (!stored) handlePriorityOptionsChange(priorityOptions.value);
};

/**
 * Validates the mapping: High needs an option and no option sits under two levels
 */
const isMappingValid = (value: NotionPriorityMapping): boolean => {
  return value.high.length > 0 && duplicatePriorities.value.length === 0;
};

/**
 * Saves the mapping if valid and emits saved event
 */
const save = () => {
  if (isMappingValid(mapping.value)) {
    emit("saved", {
      high: [...mapping.value.high],
      regular: [...mapping.value.regular],
      low: [...mapping.value.low],
    });
  }
};

/**
 * Reactive indicator whether the current priority mapping is valid.
 */
const isMappingValidComputed = computed(() => isMappingValid(mapping.value));

defineExpose({
  save,
  reset,
  isMappingValid: isMappingValidComputed,
});
</script>
