<!--
@component TaskForm
@kind block
@category form-structure
@description Form component for creating and editing tasks with integration support
@usage Used in task creation and editing modals, with buttons handled by parent modal
@avoid Only creating and editing a task in the sheet; the in-card flow is NewCardFlow.
@responsibility
- Provides the same labelled property rows as TaskDetailContent (#161): one grammar for add and detail
- Title as a large clean input, properties as label/value rows; Thema/Aktivität are rows with the empty "Auswählen" state
- Notes section always visible (no reveal button)
- Help text lives in the pickers and as accessible descriptions, not in tooltips
- Handles form submission and validation: an empty or whitespace-only title shows an inline error under the title (role="alert", aria-invalid, focus back on the input; clears once the title has text, #662)
- Converts between time formats (minutes/seconds)
- The timebox input starts empty (`null` minutes = no timebox, muted "—" placeholder), never 0; an empty, zero or negative input means no timebox (#663)
- Emits task data for parent to save to integration
- Exposes submitFormExternal method for parent modal footer buttons
-->
<template>
  <UForm :state="formData" @submit="submitForm">

    <!-- Title: one large clean input -->
    <div class="pb-4">
      <UInput
        ref="titleInputRef"
        v-model="formData.title"
        data-private
        name="title"
        :placeholder="t('task.form.titlePlaceholder')"
        size="xl"
        variant="ghost"
        class="w-full"
        required
        :color="titleError ? 'error' : undefined"
        :highlight="titleError"
        :aria-invalid="titleError ? 'true' : undefined"
        :aria-describedby="titleError ? titleErrorId : undefined"
        @keydown.enter.prevent="submitForm"
      />
      <!-- Empty-title submit (#662): the message is inserted on submit, so role="alert" announces it -->
      <p
        v-if="titleError"
        :id="titleErrorId"
        role="alert"
        class="px-2.5 pt-1 text-sm text-error-700"
        data-testid="add-task-title-error"
      >
        {{ t('task.form.titleRequired') }}
      </p>
    </div>

    <!-- Property rows (#161): the same label/value grammar and stable positions as the detail view -->
    <div class="flex flex-col" data-testid="add-task-context-bar">
      <TaskPropertyRow
        v-if="showPriority"
        :label="t('task.field.priority')"
        data-testid="add-task-priority-chip"
      >
        <TaskPropertySelect
          :label="t('task.field.priority')"
          :model-value="formData.priority"
          :items="priorityItems"
          value-key="value"
          :hint="t('task.form.priorityHint')"
          @update:model-value="(val) => formData.priority = Number(val)"
        />
      </TaskPropertyRow>

      <TaskPropertyRow v-if="showTopic" :label="t('task.field.topic')" private>
        <TaskPropertySelect
          :label="t('task.field.topic')"
          :model-value="formData.topic"
          :items="propertyOptionsStore.getTopicOptions"
          :placeholder="t('task.form.choose')"
          :search-placeholder="t('task.field.topicSearch')"
          :clear-label="t('task.property.clear', { field: t('task.field.topic') })"
          create-item
          data-testid="add-task-topic-select"
          @update:model-value="(val) => formData.topic = String(val)"
          @clear="formData.topic = ''"
          @create="handleCreateTopic"
        >
          <template #item-leading="{ item }">
            <TopicMark :topic="String(item)" />
          </template>
        </TaskPropertySelect>
      </TaskPropertyRow>

      <TaskPropertyRow v-if="showActivity" :label="t('task.field.activity')" private>
        <TaskPropertySelect
          :label="t('task.field.activity')"
          :model-value="formData.activity"
          :items="propertyOptionsStore.getActivityOptions"
          :placeholder="t('task.form.choose')"
          :search-placeholder="t('task.field.activitySearch')"
          :clear-label="t('task.property.clear', { field: t('task.field.activity') })"
          create-item
          data-testid="add-task-activity-select"
          @update:model-value="(val) => formData.activity = String(val)"
          @clear="formData.activity = ''"
          @create="handleCreateActivity"
        />
      </TaskPropertyRow>

      <TaskPropertyRow v-if="showTimebox" v-slot="{ labelId }" :label="t('task.timebox')" data-testid="add-task-timebox">
        <div class="flex min-w-0 flex-col">
          <div class="flex min-h-8 items-center gap-1.5 max-md:min-h-11">
            <input
              :value="timeboxInMinutes ?? ''"
              type="number"
              data-testid="add-task-timebox-input"
              min="0"
              step="5"
              placeholder="—"
              :aria-labelledby="labelId"
              :aria-describedby="timeboxHintId"
              class="min-h-8 w-14 [appearance:textfield] border-0 border-b border-dotted border-muted bg-transparent py-0.5 text-sm placeholder:text-muted focus-ring max-md:min-h-11 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              @input="onTimeboxInput"
            >
            <span class="text-sm text-muted">{{ t('duration.unitMinute') }}</span>
            <span :id="timeboxHintId" class="sr-only">{{ t('task.form.durationHint') }}</span>
          </div>

          <!-- Presets and the suggestion are plain text actions (One Lamp: no second filled control) -->
          <div class="-ms-2 flex flex-wrap items-center">
            <button
              v-for="mins in [15, 30, 60]"
              :key="mins"
              type="button"
              class="task-property-value flex min-h-8 cursor-pointer items-center rounded-sm px-2 text-sm max-md:min-h-11"
              :class="timeboxInMinutes === mins ? 'font-semibold text-highlighted underline underline-offset-4' : 'text-muted hover:text-default'"
              :aria-pressed="timeboxInMinutes === mins"
              :aria-label="`${mins} ${t('duration.unitMinute')}`"
              :data-testid="`timebox-preset-${mins}`"
              @click.prevent="() => { timeboxInMinutes = mins; }"
            >
              {{ mins }}
            </button>
            <button
              v-if="showSuggestion && timeboxSuggestion"
              type="button"
              class="task-property-value flex min-h-8 cursor-pointer items-center rounded-sm px-2 text-sm text-muted hover:text-default max-md:min-h-11"
              :aria-describedby="suggestionHintId"
              data-testid="timebox-suggestion"
              @click.prevent="applySuggestion"
            >
              {{ t('task.property.suggest', { n: timeboxSuggestion.suggestedMinutes }) }}
            </button>
            <span v-if="timeboxSuggestion" :id="suggestionHintId" class="sr-only">{{ timeboxSuggestion.matchDescription }}</span>
          </div>
        </div>
      </TaskPropertyRow>
    </div>

    <div class="flex flex-col gap-8 pt-8">

      <!-- Notes: always visible, no reveal button -->
      <section data-testid="add-task-notes-section" aria-labelledby="add-notes-heading">
        <SectionHeader id="add-notes-heading" :text="t('task.field.notes')" tag="h3" />
        <div @keydown="onNotesKeydown">
          <UTextarea
            v-model="formData.notes"
            data-private
            name="notes"
            :placeholder="t('task.form.notesPlaceholder')"
            :rows="3"
            class="w-full"
          />
        </div>
      </section>

      <!-- Custom properties (Notion): every configured property is a row -->
      <section v-if="customProperties.length > 0" aria-labelledby="add-custom-heading">
        <SectionHeader id="add-custom-heading" :text="t('task.field.properties')" tag="h3" class="mb-1" />
        <div class="flex flex-col">
          <TaskPropertyRow
            v-for="prop in customProperties"
            :key="prop.key"
            v-slot="{ labelId }"
            :label="prop.label || prop.name"
            private
          >
            <!-- Text input -->
            <UInput
              v-if="prop.type === 'text'"
              v-model="(customValues[prop.key] as string)"
              size="sm"
              class="w-full"
              :ui="customInputUi"
              :aria-labelledby="labelId"
            />

            <!-- Number input -->
            <UInput
              v-else-if="prop.type === 'number'"
              v-model.number="(customValues[prop.key] as number)"
              type="number"
              size="sm"
              class="w-full"
              :ui="customInputUi"
              :aria-labelledby="labelId"
            />

            <!-- URL input -->
            <UInput
              v-else-if="prop.type === 'url'"
              v-model="(customValues[prop.key] as string)"
              type="url"
              size="sm"
              class="w-full"
              :ui="customInputUi"
              :placeholder="urlPlaceholder"
              :aria-labelledby="labelId"
            />

            <!-- Email input -->
            <UInput
              v-else-if="prop.type === 'email'"
              v-model="(customValues[prop.key] as string)"
              type="email"
              size="sm"
              class="w-full"
              :ui="customInputUi"
              :aria-labelledby="labelId"
            />

            <!-- Phone input -->
            <UInput
              v-else-if="prop.type === 'phone_number'"
              v-model="(customValues[prop.key] as string)"
              type="tel"
              size="sm"
              class="w-full"
              :ui="customInputUi"
              :aria-labelledby="labelId"
            />

            <!-- Checkbox -->
            <label
              v-else-if="prop.type === 'checkbox'"
              class="flex min-h-8 w-full cursor-pointer items-center max-md:min-h-11"
            >
              <UCheckbox
                :model-value="!!customValues[prop.key]"
                :aria-label="prop.label || prop.name"
                @update:model-value="(val) => customValues[prop.key] = val"
              />
            </label>

            <!-- Select (single) -->
            <TaskPropertySelect
              v-else-if="prop.type === 'select'"
              :label="prop.label || prop.name"
              :model-value="(customValues[prop.key] as string)"
              :items="propertyOptionsStore.getCustomPropertyOptions(prop.key)"
              :placeholder="t('task.form.choose')"
              :search-placeholder="t('task.form.choose')"
              :clear-label="t('task.property.clear', { field: prop.label || prop.name })"
              create-item
              @update:model-value="(val) => customValues[prop.key] = String(val)"
              @clear="customValues[prop.key] = ''"
              @create="(item: string) => handleCreateSelectOption(prop.key, item)"
            />

            <!-- Multi-select -->
            <TaskPropertySelect
              v-else-if="prop.type === 'multi_select'"
              :label="prop.label || prop.name"
              :model-value="(customValues[prop.key] as string[])"
              :items="propertyOptionsStore.getCustomPropertyOptions(prop.key)"
              :placeholder="t('task.form.choose')"
              :search-placeholder="t('task.form.choose')"
              :clear-label="t('task.property.clear', { field: prop.label || prop.name })"
              multiple
              create-item
              @update:model-value="(val) => customValues[prop.key] = val as string[]"
              @clear="customValues[prop.key] = []"
              @create="(item: string) => handleCreateSelectOption(prop.key, item)"
            />

            <!-- Date -->
            <UInput
              v-else-if="prop.type === 'date'"
              v-model="(customValues[prop.key] as string)"
              type="date"
              size="sm"
              :ui="customInputUi"
              :aria-labelledby="labelId"
            />
          </TaskPropertyRow>
        </div>
      </section>

    </div>

  </UForm>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, useId } from "vue";
import { useI18n } from "vue-i18n";
import { getPriorityLabel } from "~/utils/taskStatusMappings";
import { DEFAULT_PRIORITY, normalizePriority } from "~/lib/priority";
import { type Task, TaskStatus, type TaskCustomValue, type TaskCustomEntry } from "~/types/task";
import { useNotionConfigStore } from "~/store/notionConfig";
import { useBoardStore } from "~/store/board";
import { usePropertyOptionsStore } from "~/store/propertyOptions";
import type { NotionCustomPropertyConfig, CustomPropertyType } from "~/types/notion";
import { useTimeboxSuggestion } from "~/composables/useTimeboxSuggestion";
import { useTopicColor } from "~/composables/useTopicColor";
import { usePropertyOptionsSync } from "~/composables/usePropertyOptionsSync";
import type { TimeboxSuggestion } from "~/types/timeboxSuggestion";
import SectionHeader from "~/components/ui/SectionHeader.vue";
import TaskPropertyRow from "~/components/task/TaskPropertyRow.vue";
import { isSubmitShortcut } from "~/composables/usePlatformShortcut";
import TaskPropertySelect from "~/components/task/TaskPropertySelect.vue";
import TopicMark from "~/components/topic/TopicMark.vue";
import { fieldsForSource } from "~/utils/sourceFields";
import type { SourceId } from "~/types/taskSource";

export interface Props {
  /** Task to edit, or undefined for creating a new task */
  task?: Task;
  /** Label for submit button */
  submitLabel?: string;
  /** Whether to auto-focus the title input on mount */
  autoFocus?: boolean;
  /** Whether this task is unplanned (ad-hoc) */
  isUnplanned?: boolean;
  /** Whether to run in preview mode (no side effects) */
  isPreview?: boolean;
  /** Source whose fields the form offers: the add form's chosen target (#321); an edit uses the task's own */
  source?: SourceId | null;
}

const props = withDefaults(defineProps<Props>(), {
  task: undefined,
  submitLabel: undefined,
  autoFocus: false,
  isUnplanned: false,
  isPreview: false,
  source: undefined,
});

const emit = defineEmits<{
  success: [task: Partial<Task>];
  cancel: [];
  /** Live card-relevant values, emitted on every change (drives the board's draft card, #110) */
  draft: [values: Partial<Task>];
}>();

/**
 * Reset the submitting state (can be called by parent on error)
 */
function resetSubmitting() {
  isSubmitting.value = false;
}

/**
 * Trigger form submission from external component (e.g., modal footer button)
 */
function submitFormExternal() {
  submitForm();
}

// Expose for parent component access
defineExpose({
  resetSubmitting,
  submitFormExternal,
  isSubmitting: computed(() => isSubmitting.value),
});

defineOptions({ name: 'TaskForm' });

const notionConfig = useNotionConfigStore();
const boardStore = useBoardStore();
const propertyOptionsStore = usePropertyOptionsStore();
const { calculateSuggestion } = useTimeboxSuggestion();
const { ensureOptionsAvailable } = usePropertyOptionsSync();

const isSubmitting = ref(false);
// Empty-title submit (#662): inline error, aria-invalid on the input, focus back on it; clears once the title has text
const titleError = ref(false);
const titleErrorId = useId();
const titleInputRef = ref<{ $el: HTMLInputElement } | null>(null);

// Timebox suggestion state
const timeboxSuggestion = ref<TimeboxSuggestion | null>(null);
const showSuggestion = ref(false);
const suggestionDebounceTimer = ref<NodeJS.Timeout | null>(null);

// Form data
const formData = ref({
  title: props.task?.title || "",
  activity: props.task?.activity || "",
  topic: props.task?.topic || "",
  notes: props.task?.notes || "",
  priority: normalizePriority(props.task?.priority),
  status: props.task?.status ?? TaskStatus.Open,
});

function focusTitle() {
  // Try to find the input element inside the wrapper
  const inputEl = titleInputRef.value?.$el?.querySelector('input');
  if (inputEl) {
    inputEl.focus();
  } else {
    titleInputRef.value?.$el?.focus();
  }
}

watch(() => formData.value.title, (title) => {
  if (title.trim()) titleError.value = false;
});

// Auto-focus title input when requested
onMounted(() => {
  if (props.autoFocus) {
    nextTick(focusTitle);
  }

  // Trigger initial suggestion calculation if form has data
  if (formData.value.title.length >= 3 || formData.value.activity) {
    updateSuggestion();
  }
});

// Timebox in minutes (for display)
// null = no timebox: the input stays empty and shows its muted placeholder (#663); never 0
const timeboxInMinutes = ref<number | null>(
  props.task?.timeBoxSeconds ? Math.round(props.task.timeBoxSeconds / 60) || null : null
);

/** Typing sets the timebox; an empty, zero or negative input means no timebox */
function onTimeboxInput(event: Event) {
  const minutes = (event.target as HTMLInputElement).valueAsNumber;
  timeboxInMinutes.value = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Priority items matching the detail modal chip style
 */
const { t } = useI18n();

const priorityItems = computed(() => [
  { label: getPriorityLabel(1), value: 1, icon: 'ph:flag' },
  { label: getPriorityLabel(2), value: 2, icon: 'ph:flag' },
  { label: getPriorityLabel(3), value: 3, icon: 'ph:exclamation-mark' },
]);

/**
 * Update timebox suggestion with debouncing
 */
function updateSuggestion() {
  // Clear existing timer
  if (suggestionDebounceTimer.value) {
    clearTimeout(suggestionDebounceTimer.value);
  }

  // Debounce suggestion calculation (300ms)
  suggestionDebounceTimer.value = setTimeout(() => {
    const title = formData.value.title;
    const activity = formData.value.activity || null;
    const topic = formData.value.topic || null;

    // Calculate new suggestion with both activity and topic
    const suggestion = calculateSuggestion(title, activity, topic);

    if (import.meta.dev) {
      console.log('[TimeboxSuggestion] Calculation triggered:', {
        title,
        activity,
        topic,
        suggestion,
        hasManualTimebox: timeboxInMinutes.value !== null,
        isEditingWithTimebox: props.task?.timeBoxSeconds && props.task.timeBoxSeconds > 0,
      });
    }

    // Update state
    timeboxSuggestion.value = suggestion;

    // Show suggestion if:
    // 1. Suggestion exists
    // 2. No manual timebox entered yet (or it's 0)
    // 3. Not editing an existing task with timebox
    const hasManualTimebox = timeboxInMinutes.value !== null;
    const isEditingWithTimebox = props.task?.timeBoxSeconds && props.task.timeBoxSeconds > 0;

    showSuggestion.value = !!suggestion && !hasManualTimebox && !isEditingWithTimebox;

    if (import.meta.dev) {
      console.log('[TimeboxSuggestion] Show suggestion?', showSuggestion.value);
    }
  }, 300);
}

/**
 * Apply suggestion to timebox input
 */
function applySuggestion() {
  if (timeboxSuggestion.value) {
    timeboxInMinutes.value = timeboxSuggestion.value.suggestedMinutes;
    showSuggestion.value = false;
  }
}

// Custom property values
const customValues = ref<Record<string, string | number | boolean | null | string[]>>({});

/**
 * The source whose fields the form offers: the edited task's own, else the add form's chosen target, else the
 * board's default source. Switching it hides the rows the source lacks but keeps their typed values, so they
 * come back on switching back; only visible fields are emitted and saved.
 */
const formSource = computed(() => props.task?.source ?? props.source ?? boardStore.defaultSource);
const fields = computed(() => fieldsForSource(formSource.value, notionConfig.config?.propertyMapping));

const showPriority = computed(() => fields.value.priority);
const showTimebox = computed(() => fields.value.timebox);
const showActivity = computed(() => fields.value.activity);
const showTopic = computed(() => fields.value.topic);

/** The colour siblings with the chosen topic show, so the draft card and the saved task carry their mark (#672) */
const { colorCodeFor } = useTopicColor();
const topicColorCode = computed(() => {
  if (!showTopic.value || !formSource.value) return null;
  const topic = formData.value.topic?.trim();
  // An edit that keeps the topic keeps the colour the task has
  if (props.task && props.task.topic?.trim() === topic) return props.task.topicColorCode;
  return colorCodeFor(topic, formSource.value);
});

/** Cmd+Enter (macOS) or Ctrl+Enter in the notes submits the form, like Enter in the title */
function onNotesKeydown(event: KeyboardEvent) {
  if (!isSubmitShortcut(event)) return;
  event.preventDefault();
  submitForm();
}

const timeboxHintId = useId();
const suggestionHintId = useId();

// Mirror card-relevant values to the parent so the board can show a live draft card
watch(
  [formData, timeboxInMinutes, showActivity, showTopic, showPriority, showTimebox],
  () => {
    emit("draft", {
      title: formData.value.title.trim(),
      activity: showActivity.value ? formData.value.activity?.trim() || null : null,
      topic: showTopic.value ? formData.value.topic?.trim() || null : null,
      topicColorCode: topicColorCode.value,
      priority: showPriority.value ? formData.value.priority : DEFAULT_PRIORITY,
      timeBoxSeconds: showTimebox.value && timeboxInMinutes.value !== null ? timeboxInMinutes.value * 60 : null,
    });
  },
  { deep: true, immediate: true },
);


/**
 * Get custom properties to display based on Notion configuration
 */
// Bound via script: a literal `//` in a template attribute breaks vue-tsc scope analysis.
const urlPlaceholder = 'https://';

const customProperties = computed<NotionCustomPropertyConfig[]>(() => fields.value.customProperties);

const customInputUi = { base: 'max-md:min-h-11' };

/**
 * Options are now managed centrally by propertyOptionsStore
 * This function is kept for backward compatibility but does nothing
 * as options are automatically populated when tasks are loaded
 */
function loadSelectOptions() {
  // Options are now centrally managed - no action needed
}

/**
 * Handle creating a new select option
 * Adds to central store and marks for sync
 */
function handleCreateSelectOption(key: string, value: string) {
  // Add to central store (will be persisted)
  propertyOptionsStore.addCustomPropertyOption(key, value);

  // For single select, set the value immediately
  const prop = customProperties.value.find(p => p.key === key);
  if (prop?.type === 'select') {
    customValues.value[key] = value;
  } else if (prop?.type === 'multi_select') {
    // For multi-select, add to array
    const current = customValues.value[key];
    if (Array.isArray(current)) {
      if (!current.includes(value)) {
        customValues.value[key] = [...current, value];
      }
    } else {
      customValues.value[key] = [value];
    }
  }
}

/**
 * Handle creating a new topic option
 * Adds to central store and marks for sync
 */
function handleCreateTopic(value: string) {
  propertyOptionsStore.addTopicOption(value);
  formData.value.topic = value;
}

/**
 * Handle creating a new activity option
 * Adds to central store and marks for sync
 */
function handleCreateActivity(value: string) {
  propertyOptionsStore.addActivityOption(value);
  formData.value.activity = value;
}

// Initialize custom values from existing task
watch(
  () => props.task,
  (task) => {
    if (task?.custom) {
      for (const [key, entry] of Object.entries(task.custom)) {
        customValues.value[key] = extractCustomValue(entry.value);
      }
    }
    loadSelectOptions();
  },
  { immediate: true }
);

// Watch title for suggestion updates
watch(
  () => formData.value.title,
  () => {
    updateSuggestion();
  }
);

// Watch activity for suggestion updates (primary factor)
watch(
  () => formData.value.activity,
  () => {
    updateSuggestion();
  }
);

// Watch topic for suggestion updates (secondary factor)
watch(
  () => formData.value.topic,
  () => {
    updateSuggestion();
  }
);

// Hide suggestion when user manually enters a timebox
watch(
  () => timeboxInMinutes.value,
  (newValue) => {
    if (newValue !== null) {
      showSuggestion.value = false;
    }
  }
);

/**
 * Extract the raw value from a TaskCustomValue
 */
function extractCustomValue(value: TaskCustomValue): string | number | boolean | null | string[] {
  if (!value) return null;

  switch (value.type) {
    case 'text':
    case 'number':
    case 'url':
    case 'email':
    case 'phone_number':
    case 'checkbox':
      return value.value;
    case 'select':
      return value.value?.name || '';
    case 'date':
      return value.value?.start || '';
    case 'multi_select':
      // Return as array for USelectMenu multiple
      return value.value?.map((v) => v.name) || [];
    default:
      return null;
  }
}

/**
 * Build custom property entries for the task
 */
function buildCustomEntries(): Record<string, TaskCustomEntry> {
  const entries: Record<string, TaskCustomEntry> = {};

  for (const prop of customProperties.value) {
    const value = customValues.value[prop.key];
    // Check for empty arrays in multi_select
    const isEmpty = value === undefined ||
                    value === null ||
                    value === '' ||
                    (Array.isArray(value) && value.length === 0);

    if (!isEmpty) {
      entries[prop.key] = {
        key: prop.key,
        name: prop.name,
        propType: prop.type as CustomPropertyType,
        value: buildCustomValue(prop.type, value),
      };
    }
  }

  return entries;
}

/**
 * Build a typed custom value based on property type
 */
function buildCustomValue(type: string, value: string | number | boolean | null | string[]): TaskCustomValue {
  switch (type) {
    case 'text':
      return { type: 'text', value: typeof value === 'string' ? value : String(value || '') };
    case 'url':
      return { type: 'url', value: typeof value === 'string' ? value : null };
    case 'email':
      return { type: 'email', value: typeof value === 'string' ? value : null };
    case 'phone_number':
      return { type: 'phone_number', value: typeof value === 'string' ? value : null };
    case 'number':
      return { type: 'number', value: typeof value === 'number' ? value : null };
    case 'checkbox':
      return { type: 'checkbox', value: !!value };
    case 'select':
      return { type: 'select', value: value && typeof value === 'string' ? { name: value } : null };
    case 'date':
      return { type: 'date', value: value && typeof value === 'string' ? { start: value } : null };
    case 'multi_select':
      // Handle both array (from USelectMenu) and string (legacy)
      if (Array.isArray(value)) {
        return {
          type: 'multi_select',
          value: value.map((v) => ({ name: v }))
        };
      } else if (typeof value === 'string' && value) {
        return {
          type: 'multi_select',
          value: value.split(',').map((v) => ({ name: v.trim() }))
        };
      }
      return { type: 'multi_select', value: [] };
    default:
      return { type: 'text', value: null };
  }
}

/**
 * Handles form submission
 */
async function submitForm() {
  if (!formData.value.title.trim()) {
    titleError.value = true;
    focusTitle();
    return;
  }

  isSubmitting.value = true;

  try {
    const isEditing = !!props.task?.id;

    const taskData: Partial<Task> = {
      title: formData.value.title.trim(),
      activity: showActivity.value ? formData.value.activity?.trim() || null : null,
      topic: showTopic.value && formData.value.topic ? formData.value.topic.trim() : null,
      topicColorCode: topicColorCode.value,
      priority: showPriority.value ? formData.value.priority : DEFAULT_PRIORITY,
      notes: formData.value.notes?.trim() || null,
      timeBoxSeconds: showTimebox.value && timeboxInMinutes.value !== null
        ? timeboxInMinutes.value * 60
        : null,
      isUnplanned: props.isUnplanned,
    };

    // Only set status for new tasks. For edits, we must not overwrite status
    // because this form currently doesn't expose a status input.
    if (!isEditing) {
      taskData.status = formData.value.status;
    }

    // Add custom properties if any
    const custom = buildCustomEntries();
    if (Object.keys(custom).length > 0) {
      taskData.custom = custom;
    }

    // If editing, include the ID
    if (props.task?.id) {
      taskData.id = props.task.id;
    }

    // Emit and keep loading state - parent will handle reset via success/error
    emit("success", taskData);

    // Note: isSubmitting stays true until parent completes operation
    // Parent should emit 'complete' or component unmounts
  } catch (error) {
    // Only reset on local validation errors
    isSubmitting.value = false;
    throw error;
  }
}

// Ensure property options are available when form is used
if (!props.isPreview) {
  ensureOptionsAvailable();
}
</script>
