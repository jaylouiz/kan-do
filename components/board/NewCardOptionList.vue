<!--
@component NewCardOptionList
@description The list behind "Mehr" (Thema, Aktivität, #16) and "···" (Timebox) of the guided new-card flow: the values that are not pills, with a search field and a "Neu: „text“" row on Thema and Aktivität
@usage Inside NewCardFlow's popover (desktop) and drawer (phone); the parent owns open/close, the picks and the focus hand-back
@responsibility
- Search (Thema, Aktivität): the text filters every value of the step, pills included; a "Neu" row shows when no value has that name (any case) and the source allows free values (`newValues`, the source's rules clean the text: Notion turns commas into spaces and cuts at 100 characters, so the row shows what would be created); without free values the field only searches
- Enter in the field: a value named exactly as typed (any case) is picked, else the first match, else the text is created (a partial match never creates by accident: the "Neu" row is the first stop of ArrowDown, or a tap); no match shows "Keine Treffer gefunden." (a status line)
- Keys: ↑/↓ (wrapping) walk field, "Neu" row and options; Home/End jump between options only while focus is not in the field (there they move the caret); handled keys stop here so no surrounding handler sees them (#15). Digits typed in the field never reach the step's 1-4 keys (the parent ignores keys while the list is open)
- Options are plain buttons with one shared handler (not UDropdownMenu: the drawer has no menu primitive, #15)
-->
<template>
  <div
    class="flex flex-col gap-0.5"
    :class="large ? 'p-3 pb-6' : ''"
    role="group"
    :aria-label="label"
    data-testid="new-card-more-list"
    @keydown="onKeydown"
  >
    <UInput
      v-if="searchable"
      ref="searchEl"
      v-model="query"
      class="mb-1 w-full"
      :size="large ? 'lg' : 'md'"
      icon="i-ph-magnifying-glass"
      type="text"
      autocomplete="off"
      data-private
      data-testid="new-card-search"
      :placeholder="newValues ? t('board.quickAdd.searchOrNew') : t('board.quickAdd.search')"
      :aria-label="newValues ? t('board.quickAdd.searchOrNew') : t('board.quickAdd.search')"
      @keydown.enter.prevent.stop="onEnter"
    />
    <button
      v-if="creatable"
      type="button"
      data-testid="new-card-new"
      :class="[optionClass, 'font-medium']"
      @click="emit('create', creatable)"
    >
      <UIcon name="i-ph-plus-bold" class="size-4 shrink-0" aria-hidden="true" />
      <span class="truncate" data-private>{{ t('board.quickAdd.newValue', { value: creatable }) }}</span>
    </button>
    <button
      v-for="value in shown"
      :key="value"
      type="button"
      :aria-current="value === current ? 'true' : undefined"
      :class="[optionClass, 'aria-current:font-semibold aria-current:text-highlighted']"
      @click="emit('pick', value)"
    >
      <TopicMark v-if="showMark" :topic="value" />
      <span class="truncate" :data-private="searchable ? '' : undefined">{{ optionLabel(value) }}</span>
    </button>
    <p v-if="searchable && query.trim() && !creatable && !shown.length && !existing" class="px-3 py-2 text-sm text-muted" role="status" data-testid="new-card-no-match">
      {{ t('board.quickAdd.noMatch') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import TopicMark from '~/components/topic/TopicMark.vue';
import { existingValueFor, filterRest, newValueFor, type NewValueRules } from '~/lib/quickAddSuggestions';

defineOptions({ name: 'NewCardOptionList' });

const props = defineProps<{
  /** The values behind the pills (Thema, Aktivität) or the whole list (Timebox) */
  values: readonly string[];
  /** Every value of the step, pills included: what "Neu" and an exact match are checked against */
  all: readonly string[];
  /** The step's current value, marked `aria-current` */
  current: string | null;
  /** Shows the search field (Thema, Aktivität) */
  searchable: boolean;
  /** The source's rules for a new value; `null` = no free values, no "Neu" row */
  newValues: NewValueRules | null;
  /** The topic mark before a value (Thema) */
  showMark: boolean;
  /** The step's question, the group's name */
  label: string;
  /** What a value reads as (Timebox: "30 min") */
  optionLabel: (value: string) => string;
  /** The drawer's bigger targets and padding */
  large?: boolean;
}>();

const emit = defineEmits<{
  pick: [value: string];
  create: [value: string];
}>();

const { t } = useI18n();
const query = ref('');
const searchEl = ref<{ inputRef: HTMLInputElement | null } | null>(null);

// A typed text searches every value of the step, pills included ("des" finds the pill "Design"); blank shows only the values behind the pills
const shown = computed(() => (props.searchable && query.value.trim() ? filterRest(props.all, query.value) : [...props.values]));
const creatable = computed(() => (props.searchable ? newValueFor(query.value, props.all, props.newValues) : null));
const existing = computed(() => (props.searchable ? existingValueFor(query.value, props.all, props.newValues) : null));

const optionClass = computed(() =>
  `flex w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-default hover:bg-elevated focus-visible:bg-elevated ${props.large ? 'min-h-11 text-base' : 'min-h-8 text-sm'}`,
);

function onEnter() {
  // A value that exists wins over a new one: "kun" with "Kunde A" in the list must not make a topic "kun" by accident; the "Neu" row is one arrow key away (or a tap)
  if (existing.value) emit('pick', existing.value);
  else if (shown.value[0]) emit('pick', shown.value[0]);
  else if (creatable.value) emit('create', creatable.value);
}

/** ↑/↓ walk the field and the buttons (wrapping); Home/End jump between the buttons, never from the field (there they are caret keys) */
function onKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const list = event.currentTarget as HTMLElement;
  const field = searchEl.value?.inputRef ?? null;
  const inField = field !== null && document.activeElement === field;
  if (inField && (event.key === 'Home' || event.key === 'End')) return;
  const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const stops: HTMLElement[] = field ? [field, ...buttons] : buttons;
  if (!stops.length) return;
  event.preventDefault();
  event.stopPropagation();
  const at = stops.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (event.key === 'Home') next = field ? 1 : 0;
  else if (event.key === 'End') next = stops.length - 1;
  else if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % stops.length;
  else next = at < 0 ? stops.length - 1 : (at - 1 + stops.length) % stops.length;
  stops[Math.min(next, stops.length - 1)]!.focus();
}
</script>
