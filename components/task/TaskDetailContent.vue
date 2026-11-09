<!--
@component TaskDetailContent
@kind compound
@category form-structure
@description Shared presentational component for task detail views with inline editing
@usage Used by both TaskDetailModal and pages/tasks/[id].vue
@avoid Shared body of the task detail (modal and page); not for the add form, which is TaskForm.
@responsibility
- Display task properties as labelled rows (shared with the add form, #161), notes, and custom fields
- Every property is a row in a stable position; unset Thema/Aktivität show the empty "Auswählen" state (#161)
- Order: property rows (time spent last, with the time left beside it, kd#4), notes, custom properties, metadata (#386). Desktop slideover: the metadata is pinned to the bottom, the rest scrolls
- Provide formatted display of all task metadata
- Render error state when task not found
- Handle inline updates and synchronization
- Topic and activity pickers (TopicPropertyPicker): the topic mark before each option, no control inside an option; an edit mode in the
  picker's footer ("Bearbeiten" / "Fertig") lists one button row per option, and a row closes the picker and opens the shared
  TopicEditorHost under the property row (#430, #431, #443); topics also get a "Themen verwalten" row
- Host the carried-over triage block and line (#99)
- Guard against drift (#161, kd#4): at most six always-visible standard rows (Status, Priorität, Thema, Aktivität, Timebox,
  Aufgewendete Zeit),
  no per-row icons, no dividers; more always-visible rows must revisit the layout. The one hairline is the pin line
  above the desktop metadata footer, a boundary of the scroll region, not a row divider
-->

<template>
  <div v-if="isError" class="px-6 py-8" data-testid="task-not-found">
    <h2 class="section-heading">{{ t('task.notFoundTitle') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('task.notFoundMessage') }}</p>
  </div>

  <div v-else-if="task" class="task-detail-content flex flex-col md:min-h-0 md:flex-1">

    <!-- Everything but the pinned metadata: one scroll region on desktop, plain flow on mobile -->
    <div class="flex flex-col md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain" data-testid="task-detail-scroll">

    <!-- Carried-over triage (#99): only for Offen/Jetzt cards past the threshold -->
    <TaskCarryOverTriage
      v-if="!isPreview"
      :task-id="task.id"
      class="mx-6 mt-4 mb-2"
      @kept="focusTitle"
      @smaller="startSmallerStep"
      @delete="emit('delete')"
    />

    <!-- Title: the sheet's one display line; the utility menu is a ghost button next to it -->
    <div class="px-6 pt-2 pb-4" data-testid="task-detail-header">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <InlineEditable
            ref="titleEditable"
            data-private
            :model-value="task.title"
            :label="t('task.field.title')"
            required
            :required-message="t('task.form.titleRequired')"
            class="text-2xl/tight"
            container-class="-ms-2"
            display-class="font-display font-normal tracking-tight"
            size="xl"
            :aria-describedby="isSmallerStep ? smallerHintId : undefined"
            @save="(val) => handleTitleSave(val as string)"
            @cancel="isSmallerStep = false"
          />
          <p v-if="isSmallerStep" :id="smallerHintId" class="mt-1 text-sm text-muted" data-testid="carry-over-smaller-hint">
            {{ t('task.carryOver.smallerHint') }}
          </p>
          <p
            v-else-if="isCarryOverVisible && !isCarryOverNudgeDue"
            class="mt-1 flex items-center gap-2 text-sm text-muted"
            data-testid="carry-over-line"
          >
            <TaskCarryOverDots :day="carryOverDay" decorative />
            {{ t('task.carryOver.label', { n: carryOverDay }) }}
          </p>
        </div>

        <!-- Single utility menu for all actions -->
        <UDropdownMenu :items="utilityMenuItems" :content="{ sideOffset: 4 }">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-ph-dots-three-vertical"
            class="shrink-0 max-md:size-11"
            :aria-label="t('task.detail.moreActions')"
            data-testid="task-actions-menu"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Groups are separated by space only: properties, time, notes, custom properties, metadata -->
    <div class="flex flex-col gap-6 px-6 pb-6">

      <!-- 1. Property rows (#161): Status, Priorität, Timebox always; Thema/Aktivität once set -->
      <div class="flex flex-col" data-testid="task-property-list">
        <TaskPropertyRow :label="t('task.field.status')">
          <TaskPropertySelect
            :label="t('task.field.status')"
            :model-value="task.status"
            :items="statusItems"
            value-key="value"
            data-testid="task-status-select"
            @update:model-value="(val) => changeStatus(Number(val) as TaskStatus)"
          />
        </TaskPropertyRow>

        <TaskPropertyRow :label="t('task.field.priority')">
          <TaskPropertySelect
            :label="t('task.field.priority')"
            :model-value="priorityValue"
            :items="priorityItems"
            value-key="value"
            :hint="t('task.form.priorityHint')"
            data-testid="task-priority-select"
            @update:model-value="(val) => updatePriority(Number(val))"
          />
        </TaskPropertyRow>

        <TaskPropertyRow :label="t('task.field.topic')" private>
          <TopicMark v-if="task.topic" :topic="task.topic" :task="task" class="-me-2 ms-0.5" />
          <TopicPropertyPicker
            kind="topic"
            :editable="!isPreview"
            :label="t('task.field.topic')"
            :model-value="task.topic"
            :items="propertyOptionsStore.getTopicOptions"
            :placeholder="t('task.form.choose')"
            :search-placeholder="t('task.field.topicSearch')"
            :clear-label="t('task.property.clear', { field: t('task.field.topic') })"
            create-item
            @update:model-value="(val) => updateTopic(val)"
            @clear="updateTopic(null)"
            @create="handleCreateTopic"
            @edit="(name) => openEditor('topic', name)"
          />
        </TaskPropertyRow>
        <div v-if="editing?.kind === 'topic'" class="ms-25 max-md:ms-0" data-testid="topic-editor-slot">
          <TopicEditorHost :key="`topic:${editing.name}`" nested :topic="editing.name" kind="topic" @close="closeEditor" />
        </div>

        <TaskPropertyRow :label="t('task.field.activity')" private>
          <TopicPropertyPicker
            kind="activity"
            :editable="!isPreview"
            :label="t('task.field.activity')"
            :model-value="task.activity"
            :items="propertyOptionsStore.getActivityOptions"
            :placeholder="t('task.form.choose')"
            :search-placeholder="t('task.field.activitySearch')"
            :clear-label="t('task.property.clear', { field: t('task.field.activity') })"
            create-item
            @update:model-value="(val) => updateActivity(val)"
            @clear="updateActivity(null)"
            @create="handleCreateActivity"
            @edit="(name) => openEditor('activity', name)"
          />
        </TaskPropertyRow>
        <div v-if="editing?.kind === 'activity'" class="ms-25 max-md:ms-0" data-testid="activity-editor-slot">
          <TopicEditorHost :key="`activity:${editing.name}`" nested kind="activity" :topic="editing.name" @close="closeEditor" />
        </div>

        <!-- Timebox: the single entry point for the value; the suggestion sits next to it as text -->
        <TaskPropertyRow :label="t('task.timebox')">
          <InlineEditable
            :model-value="timeboxInMinutes"
            :label="t('task.timebox')"
            :value-text="timeboxInMinutes > 0 ? formatTaskDuration(task.timeBoxSeconds) : undefined"
            :placeholder="t('task.property.setValue')"
            affordance="rule"
            @save="updateTimebox"
          >
            <template #display>
              <span v-if="timeboxInMinutes > 0">{{ formatTaskDuration(task.timeBoxSeconds) }}</span>
              <span v-else class="text-muted not-italic">{{ t('task.property.setValue') }}</span>
            </template>
            <template #edit="{ finishEdit, commitEdit, cancelEdit }">
              <div class="flex min-h-8 items-center gap-1.5 max-md:min-h-11">
                <input
                  v-model.number="editTimeboxValue"
                  type="number"
                  min="0"
                  data-testid="timebox-edit-input"
                  :aria-label="t('task.timebox')"
                  :aria-describedby="timeboxHintId"
                  class="min-h-8 w-14 [appearance:textfield] border-0 border-b border-dotted border-muted bg-transparent py-0.5 text-sm focus-ring max-md:min-h-11 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  @focus="(event: FocusEvent) => (event.target as HTMLInputElement).select()"
                  @keydown.enter="() => { saveTimeboxEdit(); commitEdit(); }"
                  @keydown.esc.stop="() => { abandonTimeboxEdit(); cancelEdit(); }"
                  @blur="() => { saveTimeboxEdit(); finishEdit(); }"
                >
                <span class="text-sm text-muted">{{ t('duration.unitMinute') }}</span>
              </div>
            </template>
          </InlineEditable>
          <span :id="timeboxHintId" class="sr-only">{{ t('task.form.durationHint') }}</span>

          <button
            v-if="showSuggestion && timeboxSuggestion"
            type="button"
            class="task-property-value flex min-h-8 cursor-pointer items-center rounded-sm text-sm text-muted hover:text-default max-md:min-h-11"
            :aria-describedby="suggestionHintId"
            data-testid="timebox-suggestion"
            @click="applySuggestion"
          >
            {{ t('task.property.suggest', { n: timeboxSuggestion.suggestedMinutes }) }}
          </button>
          <span v-if="timeboxSuggestion" :id="suggestionHintId" class="sr-only">{{ timeboxSuggestion.matchDescription }}</span>
        </TaskPropertyRow>

        <!-- Time spent (kd#4): the total in minutes, edited like the Timebox; what is left of the Timebox sits beside it as text -->
        <TaskPropertyRow :label="t('task.field.timeSpent')">
          <InlineEditable
            :model-value="timeSpentInMinutes"
            :label="t('task.field.timeSpent')"
            :value-text="(task.timeSpentSeconds ?? 0) > 0 ? timeSpentText : undefined"
            :placeholder="t('task.property.setValue')"
            affordance="rule"
          >
            <template #display>
              <span v-if="(task.timeSpentSeconds ?? 0) > 0" class="tabular-nums" data-testid="time-spent-value">{{ timeSpentText }}</span>
              <span v-else class="text-muted not-italic">{{ t('task.property.setValue') }}</span>
            </template>
            <template #edit="{ finishEdit, commitEdit, cancelEdit }">
              <div class="flex min-h-8 items-center gap-1.5 max-md:min-h-11">
                <input
                  v-model.number="editTimeSpentValue"
                  type="number"
                  min="0"
                  :max="MAX_TIME_SPENT_MINUTES"
                  step="1"
                  inputmode="numeric"
                  data-testid="time-spent-edit-input"
                  :aria-label="t('task.field.timeSpentInMinutes')"
                  class="min-h-8 w-14 [appearance:textfield] border-0 border-b border-dotted border-muted bg-transparent py-0.5 text-sm focus-ring max-md:min-h-11 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  @vue:mounted="beginTimeSpentEdit"
                  @focus="(event: FocusEvent) => (event.target as HTMLInputElement).select()"
                  @keydown.enter="() => { saveTimeSpentEdit(); commitEdit(); }"
                  @keydown.esc.stop="() => { abandonTimeSpentEdit(); cancelEdit(); }"
                  @blur="(event: FocusEvent) => onTimeSpentBlur(event, finishEdit)"
                >
                <span class="text-sm text-muted">{{ t('duration.unitMinute') }}</span>
              </div>
            </template>
          </InlineEditable>
          <span
            v-if="task.timeBoxSeconds"
            class="flex min-h-8 items-center text-sm tabular-nums max-md:min-h-11"
            :class="remainingTimeClass"
            data-testid="time-remaining"
          >{{ t('task.timeStats.remaining', { time: remainingTimeText }) }}</span>
        </TaskPropertyRow>
      </div>

      <!-- 2. Notes: directly after the main fields on every sheet variant (#386) -->
      <TaskDetailNotes :notes="task.notes" @save="updateNotes" />

      <!-- 3. Custom (Notion) properties: one quiet heading, rows in the same grammar -->
      <section v-if="hasCustom" aria-labelledby="custom-heading" class="task-detail-section">
        <SectionHeader id="custom-heading" :text="t('task.field.properties')" tag="h3" class="mb-0" />
        <TaskDetailCustomFields
          :key="task.id"
          :custom-list="customList"
          @update="updateCustomField"
        />
      </section>

      <!-- 4. Metadata (collapsed by default): last in the flow on mobile, pinned as the footer on desktop -->
      <TaskDetailMetadata
        v-if="!pinMetadata"
        v-model:open="isMetadataOpen"
        :source="taskSource"
        :created-at="formatDate(task.createdAt)"
        :task-id="task.id"
      />

    </div>

    </div>

    <!-- Desktop slideover: the metadata is pinned to the bottom edge, the rows and notes above scroll (#386) -->
    <TaskDetailMetadata
      v-if="pinMetadata"
      v-model:open="isMetadataOpen"
      pinned
      :source="taskSource"
      :created-at="formatDate(task.createdAt)"
      :task-id="task.id"
    />

  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { toRef, computed, ref, watch, nextTick, useId, onMounted } from 'vue';
import { useOverlayIsDesktop } from '~/composables/useIsDesktop';
import { useTaskDetail, formatTaskDuration, applyCustomValue } from '~/composables/useTaskDetail';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { useI18n } from 'vue-i18n';
import { TASK_STATUS_CONFIG, getStatusLabel, getPriorityLabel } from '~/utils/taskStatusMappings';
import { useTaskStatusActions } from '~/composables/useTaskStatusActions';
import { TaskStatus } from '~/types/taskStatus';
import SectionHeader from '~/components/ui/SectionHeader.vue';
import InlineEditable from '~/components/ui/inline/InlineEditable.vue';
import { useTasksStore } from '~/store/tasks';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import { useTimeboxSuggestion } from '~/composables/useTimeboxSuggestion';
import { useTaskSync } from '~/composables/useTaskSync';
import { useTaskMoveTargets } from '~/composables/useTaskMoveTargets';
import { usePropertyOptionsSync } from '~/composables/usePropertyOptionsSync';
import TaskDetailCustomFields from '~/components/task/TaskDetailCustomFields.vue';
import TaskPropertyRow from '~/components/task/TaskPropertyRow.vue';
import TaskDetailNotes from '~/components/task/TaskDetailNotes.vue';
import TaskDetailMetadata from '~/components/task/TaskDetailMetadata.vue';
import TaskPropertySelect from '~/components/task/TaskPropertySelect.vue';
import TopicPropertyPicker from '~/components/task/TopicPropertyPicker.vue';
import TopicMark from '~/components/topic/TopicMark.vue';
import TopicEditorHost from '~/components/topic/TopicEditorHost.vue';
import TaskCarryOverTriage from '~/components/task/TaskCarryOverTriage.vue';
import TaskCarryOverDots from '~/components/task/TaskCarryOverDots.vue';
import { useTaskCarryOver } from '~/composables/useCarryOver';
import { deleteLabelKey } from '~/lib/taskSources';
import { normalizePriority } from '~/lib/priority';
import type { Task, TaskCustomValue } from '~/types/task';
import type { NameKind } from '~/lib/topicNames';

defineOptions({ name: 'TaskDetailContent' });

const { t } = useI18n();

const emit = defineEmits<{
  (e: 'delete' | 'close'): void
}>();

/**
 * @property taskId - The ID of the task to display details for. If null, displays error state.
 */
const props = withDefaults(defineProps<{
  /**
   * The ID of the task to display details for.
   * If null, the component will display an error or empty state.
   */
  taskId: string | null;
  /**
   * If true, disables synchronization with external integrations.
   * Useful for styleguides and previews.
   */
  isPreview?: boolean;
  /**
   * Opened through "Make smaller" in the closing step (#98): start the title edit with the
   * first-small-step hint once the sheet is open, as if the triage block's button was pressed.
   */
  startSmaller?: boolean;
}>(), {
  isPreview: false,
  startSmaller: false,
});

const tasksStore = useTasksStore();
const propertyOptionsStore = usePropertyOptionsStore();
const { calculateSuggestion } = useTimeboxSuggestion();
const { syncTaskToIntegration } = useTaskSync();
const { ensureOptionsAvailable } = usePropertyOptionsSync();

const isMetadataOpen = ref(false);
const timeboxHintId = useId();
const suggestionHintId = useId();

// Ensure property options are available when this component is used
// Skip in preview mode to avoid side effects
if (!props.isPreview) {
  ensureOptionsAvailable();
}

// Use the shared composable
const taskIdRef = toRef(props, 'taskId');
const {
  task,
  isError,
  taskSource,
  hasCustom,
  customList,
  timeSpentText,
  remainingTimeText,
} = useTaskDetail(taskIdRef);

const { changeStatus } = useTaskStatusActions(task);
const { targets: moveTargets, move: moveToSource } = useTaskMoveTargets(() => (props.isPreview ? null : task.value));

// Desktop slideover (>=768px): the metadata is pinned to the bottom edge (#386). Below that the sheet is a
// drawer and the metadata stays last in the flow. Follows the sheet's frozen variant, not the live query,
// so a resize while open cannot disagree with the layout the sheet actually shows (#199).
const pinMetadata = useOverlayIsDesktop();

const statusItems = computed(() => Object.entries(TASK_STATUS_CONFIG)
  .filter(([status]) => Number(status) !== TaskStatus.Backlog)
  .map(([status, config]) => ({ label: getStatusLabel(Number(status) as TaskStatus), value: Number(status) as TaskStatus, icon: config.icon })));

const priorityItems = computed(() => [
  { label: getPriorityLabel(1), value: 1, icon: 'i-ph-flag' },
  { label: getPriorityLabel(2), value: 2, icon: 'i-ph-flag' },
  { label: getPriorityLabel(3), value: 3, icon: 'i-ph-exclamation-mark' },
]);

// Priority display computed properties
const priorityValue = computed(() => normalizePriority(task.value?.priority));

// Helper to update and sync
function updateAndSync(updates: Partial<Task>) {
  if (!task.value) return;

  // Increment operation version so stale integration responses can't overwrite newer local edits.
  // This matters especially for Notion bidirectional sync.
  const operationVersion = tasksStore.incrementTaskOperationVersion(task.value.id);

  // 1. Update local store
  tasksStore.updateTask(task.value.id, updates);

  // 2. Trigger sync (unless in preview mode)
  if (!props.isPreview) {
    // Retrieve the updated task object from store to ensure we have latest state
    const updatedTask = tasksStore.task(task.value.id);
    if (updatedTask) {
      syncTaskToIntegration(updatedTask, undefined, operationVersion);
    }
  }
}

/** Sets the task's total time spent (kd#4); like `updateAndSync`, with the store action that queues the total for the source */
function setTimeSpentAndSync(seconds: number) {
  if (!task.value) return;
  const operationVersion = tasksStore.incrementTaskOperationVersion(task.value.id);
  if (!tasksStore.setTimeSpent(task.value.id, seconds)) return;
  if (!props.isPreview) {
    const updatedTask = tasksStore.task(task.value.id);
    if (updatedTask) syncTaskToIntegration(updatedTask, undefined, operationVersion);
  }
}

// Carried-over cue (#99): the line under the title (day 2+) and the triage block's title actions
const {
  displayDay: carryOverDay,
  isVisible: isCarryOverVisible,
  isNudgeDue: isCarryOverNudgeDue,
  keep: keepCarryOver,
} = useTaskCarryOver(task);
const titleEditable = ref<InstanceType<typeof InlineEditable> | null>(null);
const isSmallerStep = ref(false);
const smallerHintId = useId();

// Leaving the title editor without a change (blur, Escape) ends the smaller-step hint as well.
watch(() => titleEditable.value?.isEditing, (editing) => {
  if (editing === false) isSmallerStep.value = false;
});

onMounted(() => {
  if (!props.startSmaller || props.isPreview) return;
  // Wait for the sheet's own focus handling (reka FocusScope) so the edit field keeps focus
  window.setTimeout(() => { if (isCarryOverNudgeDue.value) startSmallerStep(); }, 250);
});

/** After Keep the block disappears: keep focus in the sheet, on the title. */
function focusTitle() {
  nextTick(() => {
    document.querySelector<HTMLElement>('[data-testid="task-detail-header"] [data-inline-editable] [role="button"]')?.focus();
  });
}

/** Make smaller: edit the title in place with the "first small step" hint. */
function startSmallerStep() {
  isSmallerStep.value = true;
  titleEditable.value?.startEdit();
}

/** A title saved as the smaller step is a fresh choice: it also silences the nudge, like Keep. */
function handleTitleSave(newTitle: string) {
  updateTitle(newTitle);
  if (isSmallerStep.value) {
    isSmallerStep.value = false;
    keepCarryOver();
  }
}

// Updates
function updateTitle(newTitle: string) {
  if (newTitle.trim()) {
    updateAndSync({ title: newTitle.trim() });
  }
}

function updateNotes(newNotes: string | number | null) {
  const notesStr = newNotes === null ? null : String(newNotes).trim();
  updateAndSync({ notes: notesStr || null });
}

function updatePriority(newPriority: number) {
  updateAndSync({ priority: newPriority });
}

/**
 * The shared topic editor (#430) opened from a row of the picker's edit mode (#443): the picker has already closed (and
 * its row blurred, so Reka does not hand focus back to the trigger), the editor appears under the property row (inline
 * at >=768px, a nested drawer below) and takes focus itself. A rename rewrites this task too (the store pass), so
 * nothing is left on the old name. Closing returns focus to the row's picker trigger.
 */
const editing = ref<{ kind: NameKind; name: string } | null>(null);
function openEditor(kind: NameKind, name: string) {
  editing.value = { kind, name };
}
function closeEditor() {
  const kind = editing.value?.kind;
  editing.value = null;
  if (!kind) return;
  void nextTick(() => document.querySelector<HTMLElement>(`[data-testid="task-${kind}-select"]`)?.focus());
}

function updateTopic(newTopic: string | null) {
  updateAndSync({ topic: newTopic?.trim() || null });
}

function handleCreateTopic(newTopic: string) {
  propertyOptionsStore.addTopicOption(newTopic);
  updateTopic(newTopic);
}

function updateActivity(newActivity: string | null) {
  updateAndSync({ activity: newActivity?.trim() || null });
}

function handleCreateActivity(newActivity: string) {
  propertyOptionsStore.addActivityOption(newActivity);
  updateActivity(newActivity);
}

function updateCustomField(key: string, value: TaskCustomValue) {
  // A configured property the task has no entry for yet is only a displayed row in customList
  const source = task.value?.custom?.[key] ?? customList.value.find((entry) => entry.key === key);
  if (!source) {
    if (import.meta.dev) {
      console.warn(`[TaskDetailContent] Custom field key "${key}" not found in task.custom or customList`);
    }
    return;
  }

  const newCustom = applyCustomValue(task.value?.custom, source, value);
  if (newCustom) updateAndSync({ custom: newCustom });
}

// Timebox Logic
const timeboxInMinutes = computed(() => {
  return task.value?.timeBoxSeconds ? Math.round(task.value.timeBoxSeconds / 60) : 0;
});
const editTimeboxValue = ref(0);

// Sync edit value when opening edit mode (handled by watching modelValue in InlineEditable, but we need local ref for input)
watch(timeboxInMinutes, (val) => {
  editTimeboxValue.value = val;
}, { immediate: true });

function updateTimebox(_val: string | number | null) {
  // This is called by InlineEditable @save
  // But we prefer saveTimeboxEdit via input events for finer control
  // Actually, we should unify this. InlineEditable emits @save when read mode is restored.
  // So we can use this too.
  saveTimeboxEdit();
}

/** Esc (kd#12): the field goes back to the stored value, so the blur that follows the closing saves nothing */
function abandonTimeboxEdit() {
  editTimeboxValue.value = timeboxInMinutes.value;
}

function saveTimeboxEdit() {
  if (editTimeboxValue.value === timeboxInMinutes.value) return;
  const seconds = editTimeboxValue.value > 0 ? editTimeboxValue.value * 60 : null;
  updateAndSync({ timeBoxSeconds: seconds });
}

// Time spent (kd#4): the total in whole minutes. A running timer changes the displayed minutes while the field is
// open, so the field is synced from the task only while it is closed, and an unchanged field writes nothing
// (a total of "30 min 5 s" must not become "30 min" by opening and leaving the field).
const timeSpentInMinutes = computed(() => {
  const seconds = task.value?.timeSpentSeconds ?? 0;
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
});
/** Upper bound of the field (about 166 h): a typo must not put an absurd total into the statistics */
const MAX_TIME_SPENT_MINUTES = 9999;
const editTimeSpentValue = ref<number | string>(0);
let timeSpentEditStart: number | null = null;

watch(timeSpentInMinutes, (val) => {
  if (timeSpentEditStart === null) editTimeSpentValue.value = val;
}, { immediate: true });

/** The field mounted: every edit starts from the total shown when it opened (not from a focus event, which a busy page may delay) */
function beginTimeSpentEdit() {
  timeSpentEditStart = Number(editTimeSpentValue.value);
}

/** Esc: the field's value goes back to where it started, so the blur that follows saves nothing */
function abandonTimeSpentEdit() {
  if (timeSpentEditStart !== null) editTimeSpentValue.value = timeSpentEditStart;
  timeSpentEditStart = null;
}

/**
 * Leaving the field saves it. The blur that a removed input still fires after Enter or Esc belongs to the
 * closed edit: with a new edit already open it would end that one (the input is no longer in the document).
 */
function onTimeSpentBlur(event: FocusEvent, finishEdit: () => void) {
  if (!(event.target as HTMLElement).isConnected) return;
  saveTimeSpentEdit();
  finishEdit();
}

function saveTimeSpentEdit() {
  if (timeSpentEditStart === null) return;
  const start = timeSpentEditStart;
  timeSpentEditStart = null;
  const raw = editTimeSpentValue.value;
  const minutes = typeof raw === 'number' ? Math.round(raw) : Number.NaN;
  // Blank, negative, non-numeric and absurdly large entries are dropped; the field shows the total again
  if (Number.isFinite(minutes) && minutes >= 0 && minutes <= MAX_TIME_SPENT_MINUTES && minutes !== start) setTimeSpentAndSync(minutes * 60);
  editTimeSpentValue.value = timeSpentInMinutes.value;
}

const remainingTimeClass = computed(() => {
  const box = task.value?.timeBoxSeconds;
  if (!box) return 'text-muted';
  const percentageLeft = ((box - (task.value?.timeSpentSeconds ?? 0)) / box) * 100;
  if (percentageLeft <= 0) return 'text-warning-700 font-semibold';
  if (percentageLeft <= 20) return 'text-warning-700 font-medium';
  return 'text-muted';
});

// Timebox Suggestion
const timeboxSuggestion = ref<{ suggestedMinutes: number; matchDescription: string } | null>(null);
const showSuggestion = computed(() => {
  return !!timeboxSuggestion.value && (!task.value?.timeBoxSeconds || task.value.timeBoxSeconds === 0);
});

// Update suggestion when relevant fields change
watch([() => task.value?.title, () => task.value?.activity, () => task.value?.topic], () => {
  if (task.value) {
    const suggestion = calculateSuggestion(task.value.title, task.value.activity, task.value.topic);
    timeboxSuggestion.value = suggestion;
  }
}, { immediate: true });

function applySuggestion() {
  if (timeboxSuggestion.value) {
    updateAndSync({ timeBoxSeconds: timeboxSuggestion.value.suggestedMinutes * 60 });
  }
}

const { formatDateTime } = useLocaleFormat();

function formatDate(dateString: string | Date | null | undefined) {
  if (!dateString) return '—';
  return formatDateTime(dateString, 'mediumDateShortTime');
}

// Copy ID functionality
const idCopied = ref(false);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

async function copyTaskId() {
  if (!task.value?.id) return;

  try {
    await navigator.clipboard.writeText(task.value.id);
    idCopied.value = true;

    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      idCopied.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy task ID:', err);
  }
}

// Source URL
const sourceUrl = computed(() => {
  const taskData = task.value as { sourceUrl?: string; notionPageId?: string } | null;
  if (!taskData) return null;
  if (taskData.sourceUrl) return taskData.sourceUrl;
  if (taskData.notionPageId) {
    return `https://notion.so/${taskData.notionPageId.replace(/-/g, '')}`;
  }
  return null;
});

// Utility menu items (dropdown for copy ID, open source, move to another source, delete)
interface UtilityMenuEntry {
  label: string;
  icon: string;
  iconClass?: string;
  /** Muted second line, read with the item */
  description?: string;
  disabled?: boolean;
  onSelect?: () => void;
  children?: UtilityMenuEntry[];
}
const utilityMenuItems = computed(() => {
  const items = [] as Array<UtilityMenuEntry | { type: 'separator' }>;

  // Copy ID
  items.push({
    label: idCopied.value ? t('task.detail.copied') : t('task.detail.copyId'),
    icon: idCopied.value ? 'i-ph-check' : 'i-ph-copy',
    iconClass: idCopied.value ? 'text-success' : '',
    onSelect: copyTaskId
  });

  // Open in source (if available)
  if (sourceUrl.value && taskSource.value) {
    items.push({
      label: t('task.detail.openIn', { source: taskSource.value }),
      icon: ICONS.openDetail,
      onSelect: () => window.open(sourceUrl.value!, '_blank')
    });
  }

  // Move to another source (#322): one child per other connected source, none with a single source
  if (moveTargets.value.length > 0) {
    items.push({
      label: t('task.contextMenu.moveToSource'),
      icon: 'i-ph-swap',
      children: moveTargets.value.map((target): UtilityMenuEntry => ({
        label: target.name,
        icon: target.icon,
        ...(target.hint ? { description: target.hint } : {}),
        disabled: target.disabled,
        onSelect: () => { moveToSource(target.source); },
      })),
    });
  }

  // Separator before delete
  items.push({ type: 'separator' as const });

  // Delete
  items.push({
    label: t(deleteLabelKey(task.value?.source ?? 'local')),
    icon: ICONS.delete,
    iconClass: 'text-error',
    onSelect: () => emit('delete')
  });

  return [items];
});
</script>
