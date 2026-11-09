<!--
@component TaskDetailCustomFields
@kind component
@category form-structure
@description Custom (Notion) properties of a task as flat label/value rows with inline editing
@usage Used in TaskDetailContent under the "Eigenschaften" heading
@avoid Only the Notion custom properties in the task detail; core properties use TaskPropertyRow.
@responsibility
- Renders every custom property type (text, number, url, email, phone, checkbox, select, multi-select, date)
- Every configured property is a row in a stable position; an empty one shows its empty state ("Auswählen…", "+ hinzufügen") instead of hiding behind a "+ n weitere" action (#161)
- Integrates with the property options store for select/multi-select
- Emits update events for the parent to handle persistence
-->
<template>
  <div class="flex flex-col">
    <TaskPropertyRow
      v-for="entry in customList"
      :key="entry.key"
      :label="entry.name"
      private
    >
      <!-- Checkbox (direct toggle) -->
      <label
        v-if="entry.value.type === 'checkbox'"
        class="flex min-h-8 w-full cursor-pointer items-center max-md:min-h-11"
      >
        <UCheckbox
          :model-value="entry.value.value"
          color="primary"
          :aria-label="entry.name"
          @update:model-value="(val) => emitUpdate(entry.key, { type: 'checkbox', value: val as boolean })"
        />
      </label>

      <!-- Date: DatePickerField manages its own open/close state -->
      <DatePickerField
        v-else-if="entry.value.type === 'date'"
        :model-value="getDateValue(entry)"
        :label="entry.name"
        @update:model-value="(val) => handleDateSave(entry, val ? val.start : null)"
      />

      <!-- Select / multi-select: the value is its own picker -->
      <TaskPropertySelect
        v-else-if="entry.value.type === 'select'"
        :label="entry.name"
        :model-value="entry.value.value?.name ?? null"
        :items="propertyOptionsStore.getCustomPropertyOptions(entry.key)"
        :placeholder="t('task.form.choose')"
        :search-placeholder="t('task.form.choose')"
        :clear-label="t('task.property.clear', { field: entry.name })"
        create-item
        @update:model-value="(val) => handleSave(entry, val)"
        @create="(name) => handleSave(entry, name)"
        @clear="handleSave(entry, '')"
      />
      <TaskPropertySelect
        v-else-if="entry.value.type === 'multi_select'"
        :label="entry.name"
        :model-value="entry.value.value.map((v) => v.name)"
        :items="propertyOptionsStore.getCustomPropertyOptions(entry.key)"
        :placeholder="t('task.form.choose')"
        :search-placeholder="t('task.form.choose')"
        :clear-label="t('task.property.clear', { field: entry.name })"
        multiple
        create-item
        @update:model-value="(val) => handleSave(entry, val)"
        @create="(name) => handleSave(entry, [...selectedNames(entry), name])"
        @clear="handleSave(entry, [])"
      />

      <!-- Text / URL / Email / Phone / Number: inline editable plain text -->
      <InlineEditable
        v-else
        :model-value="getPrimitiveValue(entry.value)"
        :label="entry.name"
        :placeholder="t('task.property.setValue')"
        affordance="rule"
        class="min-w-0"
        @save="(val) => handleSave(entry, val)"
      >
        <template #display>
          <span v-if="hasValue(entry)" class="truncate">
            {{ entry.value.type === 'number' ? formatTaskNumber(entry.value.value as number) : entry.value.value }}
          </span>
          <span v-else class="text-muted not-italic">{{ t('task.property.setValue') }}</span>
        </template>

        <template #edit="{ finishEdit, commitEdit, cancelEdit, value, setValue }">
          <UInput
            :model-value="entry.value.type === 'number' ? (value ?? undefined) : ((value as string) || '')"
            :type="inputType(entry.value.type)"
            :aria-label="entry.name"
            autofocus
            size="sm"
            @keydown.enter="commitEdit"
            @keydown.esc.stop="cancelEdit"
            @update:model-value="(val) => setValue(val)"
            @blur="finishEdit"
          />
        </template>
      </InlineEditable>
    </TaskPropertyRow>
  </div>
</template>

<script setup lang="ts">
import { formatTaskNumber, type CustomDisplayEntry } from '~/composables/useTaskDetail';
import { useI18n } from 'vue-i18n';
import type { TaskCustomValue } from '~/types/task';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import InlineEditable from '~/components/ui/inline/InlineEditable.vue';
import DatePickerField from '~/components/task/DatePickerField.vue';
import TaskPropertyRow from '~/components/task/TaskPropertyRow.vue';
import TaskPropertySelect from '~/components/task/TaskPropertySelect.vue';

defineOptions({ name: 'TaskDetailCustomFields' });

const { t } = useI18n();

/**
 * @property customList - List of custom property entries to display
 */
defineProps<{
  /**
   * List of custom property entries to display.
   * Each entry contains the property key, name, type, and value.
   */
  customList: CustomDisplayEntry[];
}>();

const emit = defineEmits<{
  (e: 'update', key: string, value: TaskCustomValue): void;
}>();

const propertyOptionsStore = usePropertyOptionsStore();

/** A checkbox always counts as set (unchecked is a value); everything else is empty without content. */
function hasValue(entry: CustomDisplayEntry): boolean {
  const value = entry.value;
  switch (value.type) {
    case 'checkbox': return true;
    case 'multi_select': return !!value.value && value.value.length > 0;
    case 'number': return value.value !== null && value.value !== undefined;
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number': return !!value.value;
    case 'select':
    case 'date': return !!value.value;
    default: return false;
  }
}

function getDateValue(entry: CustomDisplayEntry): { start: string; end?: string } | null {
  if (entry.value.type !== 'date') return null;
  return entry.value.value as { start: string; end?: string } | null;
}

// Primitive value for the InlineEditable model (select, multi-select and date handle their own saves)
function getPrimitiveValue(value: TaskCustomValue): string | number | null {
  if (value.type === 'text' || value.type === 'url' || value.type === 'email' || value.type === 'phone_number') return value.value;
  if (value.type === 'number') return value.value;
  return null;
}

function inputType(type: string): string {
  switch (type) {
    case 'number': return 'number';
    case 'email': return 'email';
    case 'phone_number': return 'tel';
    case 'url': return 'url';
    default: return 'text';
  }
}

function selectedNames(entry: CustomDisplayEntry): string[] {
  return entry.value.type === 'multi_select' ? entry.value.value.map((v) => v.name) : [];
}

function emitUpdate(key: string, value: TaskCustomValue) {
  emit('update', key, value);
}

function handleSave(entry: CustomDisplayEntry, val: unknown) {
  // Map the raw input value to the correct TaskCustomValue structure
  if (entry.value.type === 'text') {
    emitUpdate(entry.key, { type: 'text', value: val as string });
  }
  else if (entry.value.type === 'number') {
    const num = val === '' || val === null ? null : Number(val);
    emitUpdate(entry.key, { type: 'number', value: num });
  }
  else if (entry.value.type === 'url' || entry.value.type === 'email' || entry.value.type === 'phone_number') {
    emitUpdate(entry.key, { type: entry.value.type, value: val as string });
  }
  else if (entry.value.type === 'select') {
    // val is the selected string name ('' clears)
    const name = String(val ?? '');
    emitUpdate(entry.key, {
      type: 'select',
      value: name ? { name, color: 'default' } : null,
    });
    if (name) propertyOptionsStore.addCustomPropertyOption(entry.key, name);
  }
  else if (entry.value.type === 'multi_select') {
    // val is Array<string>
    const names = val as string[];
    emitUpdate(entry.key, {
      type: 'multi_select',
      value: names.map((n) => ({ name: n, color: 'default' })),
    });
    names.forEach((n) => propertyOptionsStore.addCustomPropertyOption(entry.key, n));
  }
}

function handleDateSave(entry: CustomDisplayEntry, dateStr: string | null) {
  if (!dateStr) {
    emitUpdate(entry.key, { type: 'date', value: null });
    return;
  }
  emitUpdate(entry.key, {
    type: 'date',
    value: { start: dateStr },
  });
}
</script>
