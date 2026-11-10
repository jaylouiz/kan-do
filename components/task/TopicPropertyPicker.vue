<!--
@component TopicPropertyPicker
@kind compound
@category input
@description The task sheet's Thema / Aktivität picker: the shared TaskPropertySelect plus an edit mode in its footer (#443)
@usage Value slot of the Thema and Aktivität rows in TaskDetailContent
@avoid Only the Thema / Aktivität rows of the task sheet; other properties use TaskPropertySelect.
@responsibility
- The topic's mark sits inside the select, before the value (`value-leading`, #114); picking mode is the plain picker (topic mark per option); options carry no control, so the open picker has no
  button inside a `role="option"` item (axe `nested-interactive`, #430 D6)
- "Bearbeiten" (footer) switches the same popover to edit mode: heading plus one real button per option (mark, name,
  usage count, pencil) replace search, options, "Themen verwalten" and the clear action; the footer then holds only "Fertig"
- A row hands the name to the parent (`edit`) and closes the picker; the parent opens the shared topic editor (#430).
  The row blurs itself first: Reka refocuses the trigger on close only while focus is still inside the content, so the
  editor keeps the focus it takes itself (no timer)
- "Fertig" keeps focus on the same button: the search field that returns does not autofocus until the next open (the
  Nuxt UI input otherwise takes focus one tick after it mounts)
- Edit mode never survives a reopen (reset when the picker opens, not when it closes: see the watch); "Bearbeiten" is hidden
  for an empty list, and the footer slot is not passed at all when it would hold nothing (empty Aktivität list, #461);
  `editable` false (add dialog preview) renders the plain picker without edit mode and without "Themen verwalten"
- Enter and Space on the rows and the toggle stop at the button: the combobox would otherwise swallow them
- Edit list scrolls at about 8 rows; rows are 32px, 44px at max-md (touch target)
-->
<template>
  <TaskPropertySelect
    v-model:open="isOpen"
    :label="label"
    :model-value="modelValue"
    :items="inEditMode ? [] : items"
    :placeholder="placeholder"
    :search-placeholder="inEditMode ? undefined : searchPlaceholder"
    :search-autofocus="!toggleKeepsFocus"
    :clear-label="inEditMode ? undefined : clearLabel"
    :create-item="createItem && !inEditMode"
    :picker-ui="inEditMode ? { viewport: 'hidden', empty: 'hidden' } : undefined"
    :data-testid="`task-${kind}-select`"
    @update:model-value="(value) => emit('update:modelValue', String(value))"
    @clear="emit('clear')"
    @create="(value) => emit('create', value)"
  >
    <template v-if="kind === 'topic' && modelValue" #value-leading>
      <TopicMark :topic="modelValue" :task="task" />
    </template>
    <template v-if="kind === 'topic'" #item-leading="{ item }">
      <TopicMark :topic="String(item)" />
    </template>
    <template v-if="inEditMode" #content-top>
      <div ref="editRoot" class="p-1" :data-testid="`${kind}-edit-list`">
        <p :id="headingId" class="px-2 pt-1 pb-1 text-xs font-medium text-muted">{{ heading }}</p>
        <ul class="max-h-60 overflow-y-auto" :aria-labelledby="headingId">
          <li v-for="{ name, count } in editRows" :key="name">
            <!-- Raw button on purpose (#72): the row sits in the select menu's content slot, the host reads its click event (a pencil click edits, the row never selects) and stops Enter and Space before the menu sees them; ListRow `action` emits no event and puts attributes on the <li> -->
            <button
              type="button"
              class="picker-edit-row"
              data-picker-edit-row
              @keydown.enter.stop
              @keydown.space.stop
              @click="onRow($event, name)"
            >
              <TopicMark v-if="kind === 'topic'" :topic="name" />
              <span class="flex-1 truncate" data-private>{{ name }}</span>
              <!-- The leading spaces keep the accessible name "<Name> <N Aufgaben> bearbeiten" spaced in every engine; layout drops them -->
              <span class="shrink-0 text-xs text-muted">{{ ` ${t('settings.topics.taskCount', { n: count }, count)}` }}</span>
              <span class="sr-only">{{ ` ${t('topic.picker.rowEdit')}` }}</span>
              <UIcon name="i-ph-pencil-simple" class="size-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </template>
    <template v-if="hasFooterActions" #content-extra>
      <UButton
        v-if="items.length > 0"
        color="neutral"
        variant="ghost"
        block
        class="justify-start"
        :icon="inEditMode ? 'i-ph-check' : 'i-ph-pencil-simple'"
        :label="inEditMode ? t('topic.picker.done') : t('topic.picker.edit')"
        :data-testid="`${kind}-edit-toggle`"
        @keydown.enter.stop
        @keydown.space.stop
        @click="toggleEditMode"
      />
      <UButton
        v-if="kind === 'topic' && !inEditMode"
        to="/settings/topics"
        color="neutral"
        variant="ghost"
        block
        class="justify-start"
        icon="i-ph-sliders-horizontal"
        :label="t('topic.picker.manage')"
        data-testid="topic-manage-link"
      />
    </template>
  </TaskPropertySelect>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import TaskPropertySelect from '~/components/task/TaskPropertySelect.vue';
import TopicMark from '~/components/topic/TopicMark.vue';
import { useTopicManagement } from '~/composables/useTopicManagement';
import type { Task } from '~/types/task';

defineOptions({ name: 'TopicPropertyPicker' });

const props = withDefaults(defineProps<{
  kind: 'topic' | 'activity';
  /** Property name; the trigger is announced as "<label>: <value>" */
  label: string;
  modelValue?: string | null;
  items: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  clearLabel?: string;
  createItem?: boolean;
  /** False in the add dialog preview: the plain picker, no edit mode, no "Themen verwalten" */
  editable?: boolean;
  /** The task the topic belongs to: its source colour marks the value inside the select */
  task?: Pick<Task, 'source' | 'topic' | 'topicColorCode'> | null;
}>(), {
  modelValue: undefined,
  placeholder: undefined,
  searchPlaceholder: undefined,
  clearLabel: undefined,
  createItem: false,
  editable: true,
  task: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  clear: [];
  create: [value: string];
  /** A row was activated: open the editor for `name`; the picker is closed and focus is already out of it */
  edit: [name: string];
}>();

const { t } = useI18n();
const { countOf } = useTopicManagement();

const isOpen = ref(false);
const editMode = ref(false);
const editRoot = ref<HTMLElement | null>(null);
const headingId = useId();
// Set when "Fertig" brings the search field back: its autofocus would take the focus off the toggle the user just pressed
const toggleKeepsFocus = ref(false);

const inEditMode = computed(() => props.editable && editMode.value);
// The footer holds "Bearbeiten" (non-empty list) and, for topics, "Themen verwalten": an empty Aktivität picker has
// neither, so the slot stays unset and no empty band follows "Keine Daten" (#461)
const hasFooterActions = computed(() => props.editable && (props.items.length > 0 || props.kind === 'topic'));
// One count per row per render (#461); only computed while the edit list shows
const editRows = computed(() => (inEditMode.value
  ? props.items.map((name) => ({ name, count: countOf(props.kind, name) }))
  : []));
const heading = computed(() => t(props.kind === 'topic' ? 'topic.editor.titleTopic' : 'topic.editor.titleActivity'));

// A reopen always starts in picking mode. Reset on open, not on close: the closing popover stays mounted for its exit
// animation, and re-rendering the search field (autofocus) in it would pull focus away from the editor a row just opened
watch(isOpen, (open) => {
  if (open) {
    editMode.value = false;
    toggleKeepsFocus.value = false;
  }
});

// The list can empty out under the open mode (last name removed elsewhere): fall back to picking
watch(() => props.items.length, (count) => {
  if (count === 0) editMode.value = false;
});

async function toggleEditMode() {
  editMode.value = !editMode.value;
  if (!editMode.value) {
    toggleKeepsFocus.value = true;
    return;
  }
  await nextTick();
  // The screen reader announces the list name and the first row
  editRoot.value?.querySelector<HTMLElement>('[data-picker-edit-row]')?.focus();
}

function onRow(event: MouseEvent, name: string) {
  // Reka hands focus back to the trigger when the content closes while focus is still inside it; leaving first keeps
  // the focus the editor takes for itself
  (event.currentTarget as HTMLElement | null)?.blur();
  isOpen.value = false;
  emit('edit', name);
}
</script>
