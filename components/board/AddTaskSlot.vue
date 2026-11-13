<!--
@component AddTaskSlot
@kind component
@category action
@description Draft host of a column: the box the draft card of the task being added appears in (#125). Jetzt: a card-sized add-and-start control that morphs into its draft in the same box. Offen (#248): no button of its own, the header's add button asks it to open; its draft enters at the start of the list
@usage Offen: first item of the task list (BoardColumn), opened by the header button (`open()`) or by the sheet's draft (`/tasks/add`). Jetzt: overlay of the empty column (BoardColumnProgressContent), opens add-and-start
@avoid Not the full add form: the sheet's TaskForm adds with all fields, NewCardFlow asks the guided questions; not for editing an existing task.
@responsibility
- Offen (#248): renders nothing but the draft. While no draft is open it has no box at all (`display: contents` root, no wrapper), so card positions in the list equal a board without any slot and the list's gap never opens above the first card. The draft card enters at the top: its wrapper animates the row height 0fr to 1fr with opacity, and a negative bottom margin cancels the list gap while closed, so the cards below follow in step (--duration-base = 200ms, --ease-emphasized); cancel leaves just as fast and the cards close up; reduced motion is instant
- Exposes `open()` (the header button's entry; the in-card flow for `inCard`, `open` emit otherwise) and `isDrafting` (the header button disables itself while it is true: a second click never opens a second card). Cancel and Esc hand focus to `focusFallback` (the header button); a save focuses the saved card (as before)
- Jetzt: native button named by its visible label, in a regular card's box (width, --task-card-height, card radius); the box never changes size, so layout, hit area and DnD rects stay put. Inside it `.add-task-button-surface` (centred icon + label) is always the full card shape; on pointer devices surface and label appear only while the Jetzt section is hovered or the slot has focus; touch shows the label at rest
- In-card adding (#649, `inCard`, Offen): `open()` shows NewCardFlow in the slot instead of the sheet. Esc on a typed title also shows a "Rückgängig" toast that reopens the card with it (#665). Esc, a press outside a blank card, the sheet opening cancel it and send focus back (a press on a card cancels a blank one on release; a drag keeps the card, hidden in its place with what was typed, and it takes the focus back after the drop, #248); a save swaps it for the saved card (no fade) and focuses that card. Jetzt and every other entry (palette, nav, menu) keep the sheet
- While the in-card form is open the Jetzt focus overlay steps aside (useInCardAdding, kd#56)
- Drafting (useTaskDraft holds a draft for this column): the draft card fades in over the Jetzt button, whose label fades out; the button stays mounted but inert, so focus can return to it
- The Jetzt slot is a raw `<button>` on purpose (#71, audit): a card-shaped target whose box is reserved and held while a draft or a drag runs (`add-task-button`, `data-add-slot`, `inert`), which `UButton ghost block` cannot reproduce
- During a drag (`hidden`) a draft keeps its geometry but is invisible and not interactive; it is never cancelled by the drag, so no card moves while dnd-kit measures (#248)
- Reserves the card box only for the button or the draft: with neither (`showButton` off, no draft) it takes no space
-->
<template>
  <div
    class="add-task-slot"
    :class="[`add-task-slot--${variant}`, { 'is-drafting': isDrafting, 'is-hidden': props.hidden, 'is-empty': isEmpty }]"
  >
    <button
      v-if="props.showButton"
      ref="buttonEl"
      type="button"
      class="add-task-button"
      :data-add-slot="variant"
      :inert="isDrafting"
      @click="open"
    >
      <span class="add-task-button-surface">
        <UIcon :name="props.icon" class="add-task-button-icon" aria-hidden="true" />
        <span class="add-task-button-label">{{ props.label }}</span>
      </span>
    </button>
    <!-- A saved draft is replaced by its card, so only cancel fades it back out -->
    <Transition name="add-task-slot-draft" :css="!draftSaved && !flowSaved">
      <div v-if="isDrafting" class="add-task-slot-draft-wrap">
        <new-card-flow
          v-if="flowOpen"
          class="add-task-slot-draft"
          :initial-title="flowTitle"
          :suspended="props.hidden"
          @saved="onFlowSaved"
          @cancel="closeFlow"
        />
        <task-draft-card v-else class="add-task-slot-draft" />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from '#imports';
import NewCardFlow from '~/components/board/NewCardFlow.vue';
import TaskDraftCard from '~/components/board/TaskDraftCard.vue';
import { useTaskDraft } from '~/composables/useTaskDraft';
import { trackInCardAdding } from '~/composables/useInCardAdding';
import { TaskStatus } from '~/types/taskStatus';
import { focusWhenReady, findSavedCardElement } from '~/utils/focusRecovery';

defineOptions({ name: 'AddTaskSlot' });

interface Props {
  /** Column the slot adds to: Offen, or Jetzt (add and start) */
  status: TaskStatus;
  /** Visible label, also the button's accessible name */
  label: string;
  /** False keeps only the draft (Offen, which the header button opens; a Jetzt that filled up while drafting) */
  showButton?: boolean;
  /** A drag is running: keep the box, hide it and take it out of interaction */
  hidden?: boolean;
  /** Icon in front of the label (Offen: plus, Jetzt: lightning) */
  icon?: string;
  /** Adding happens in the card itself (#649, Offen): `open()` shows NewCardFlow instead of emitting `open` */
  inCard?: boolean;
  /** Where focus goes after a cancel or a save that finds no card, when the slot has no button of its own (Offen: the header's add button) */
  focusFallback?: () => HTMLElement | null;
}

const props = withDefaults(defineProps<Props>(), { showButton: true, hidden: false, icon: 'i-ph-plus', inCard: false });

const emit = defineEmits<{
  open: [];
}>();

const { draftTask, draftSaved } = useTaskDraft();

const variant = computed(() => (props.status === TaskStatus.Progress ? 'progress' : 'open'));
const route = useRoute();
const buttonEl = ref<HTMLButtonElement | null>(null);
const flowOpen = ref(false);
trackInCardAdding(flowOpen); // the focus overlay steps aside while the form is up (kd#56)
/** The title the card opens with: only after "Rückgängig" on a dropped title (#665) */
const flowTitle = ref<string | undefined>(undefined);
const { t } = useI18n();
const toast = useToast();
/** True once the flow ended in a save: the saved card replaces it, so it leaves without a fade */
const flowSaved = ref(false);
const isSheetDrafting = computed(() => draftTask.value?.status === props.status);
const isDrafting = computed(() => isSheetDrafting.value || flowOpen.value);

/** The header button's entry (Offen) and the Jetzt button's click. A second call while a draft is up does nothing */
function open() {
  if (isDrafting.value) return;
  if (!props.inCard) {
    emit('open');
    return;
  }
  flowSaved.value = false;
  flowTitle.value = undefined;
  flowOpen.value = true;
}

/** Cancel: the button is inert while the card is up, so focus comes back once it is live again.
 *  A typed title is not lost silently (#665): the toast takes it back (undo instead of confirm) */
async function closeFlow(draft?: { title: string }) {
  flowOpen.value = false;
  if (draft?.title) {
    toast.add({
      title: t('board.quickAdd.draftDeleted'),
      duration: 5000,
      actions: [{ label: t('common.undo'), color: 'neutral', variant: 'soft', onClick: () => reopenFlow(draft.title) }],
    });
  }
  await nextTick();
  returnFocus();
}

function returnFocus() {
  (buttonEl.value ?? props.focusFallback?.() ?? null)?.focus({ preventScroll: true });
}

function reopenFlow(title: string) {
  if (flowOpen.value || isSheetDrafting.value) return;
  flowSaved.value = false;
  flowTitle.value = title;
  flowOpen.value = true;
}

function onFlowSaved(id: string) {
  flowSaved.value = true;
  flowOpen.value = false;
  focusWhenReady(() => findSavedCardElement(id), [() => buttonEl.value ?? props.focusFallback?.() ?? null]);
}

// The sheet (palette, nav, menu) takes over: the unsaved card gives way. A drag does not: the card keeps its box, hidden, and comes back after the drop (#248)
watch(() => route.path, (path) => {
  if (flowOpen.value && path.startsWith('/tasks/add')) flowOpen.value = false;
});
/** Neither button nor draft: nothing to reserve the card box for */
const isEmpty = computed(() => !props.showButton && !isDrafting.value);

defineExpose({ open, isDrafting });
</script>

<style scoped>
/* ========================================
 * SLOT: one card box shared by the Jetzt button and the draft card
 * ======================================== */
.add-task-slot {
  display: grid;
  flex-shrink: 0;
  width: min(var(--task-card-width), 100%);
  max-width: var(--task-card-max-width);
  min-height: var(--task-card-height);
  margin-inline: auto;
  border-radius: var(--task-card-radius);
}

/* Button and draft share the cell, so the morph never changes size or position */
.add-task-slot > * {
  grid-area: 1 / 1;
}

.add-task-slot-draft-wrap {
  z-index: 1;
}

/* No button and no draft: the box is not reserved (two classes, so it also beats the mobile heights) */
.add-task-slot.is-empty {
  min-height: 0;
}

/* Drag: collision rects must not shift, so a draft stays and only disappears */
.add-task-slot.is-hidden {
  visibility: hidden;
}

/* ========================================
 * OFFEN (#248): the draft host at the start of the list, without a box of its own.
 * Idle, the root is `display: contents` and the wrapper is not rendered: the list holds no slot, no gap opens above the
 * first card and every card sits where it would on a board without one. The wrapper is the flex item of the list while
 * a draft is up. It enters by opening its row (0fr to 1fr) with opacity; a negative bottom margin cancels the list's
 * gap while it is closed, so the cards below follow in step with no jump. Cancel plays the same in reverse.
 * ======================================== */
.add-task-slot--open {
  display: contents;
}

.add-task-slot--open .add-task-slot-draft-wrap {
  display: grid;
  grid-template-rows: 1fr;
  flex-shrink: 0;
  width: min(var(--task-card-width), 100%);
  max-width: var(--task-card-max-width);
  margin-inline: auto;
}

/* min-height: 0 lets the card's row collapse to nothing */
.add-task-slot--open .add-task-slot-draft-wrap > * {
  min-height: 0;
}

.add-task-slot--open .add-task-slot-draft-enter-active,
.add-task-slot--open .add-task-slot-draft-leave-active {
  transition:
    grid-template-rows var(--duration-base) var(--ease-emphasized),
    margin-bottom var(--duration-base) var(--ease-emphasized),
    opacity var(--duration-base) var(--ease-emphasized);
}

/* Clipped only while it moves: the card's shadow and focus ring stay whole at rest */
.add-task-slot--open .add-task-slot-draft-enter-active > *,
.add-task-slot--open .add-task-slot-draft-leave-active > * {
  overflow: hidden;
}

.add-task-slot--open .add-task-slot-draft-enter-from,
.add-task-slot--open .add-task-slot-draft-leave-to {
  grid-template-rows: 0fr;
  margin-bottom: calc(-1 * var(--task-list-gap));
  opacity: 0;
}

/* ========================================
 * JETZT BUTTON: a fixed card-sized hit area; the surface is always the full card shape
 * ======================================== */
.add-task-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: var(--task-card-height);
  padding: 0;
  border: 0;
  border-radius: inherit;
  background-color: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
  text-align: center;
  cursor: pointer;
  transition: opacity var(--add-slot-reveal-duration) var(--ease-standard);
}

/* The visible shape: the Jetzt surface is always the full card shape (it marks where the Jetzt card lands) */
.add-task-button-surface {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-sizing: border-box;
  min-width: 100%;
  max-width: 100%;
  min-height: var(--task-card-height);
  padding: 0.5rem 1rem;
  border-radius: inherit;
  background-color: transparent;
}

.add-task-button-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
}

.add-task-button-icon,
.add-task-button-label {
  transition: opacity var(--task-transform-duration) var(--ease-standard);
}

.add-task-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

/* Morph: the label leaves while the draft card's sheet fades in on top */
.is-drafting .add-task-button-icon,
.is-drafting .add-task-button-label {
  opacity: 0;
}

.add-task-slot--progress .add-task-slot-draft-leave-active {
  transition: opacity var(--task-transform-duration) var(--ease-standard);
}

.add-task-slot--progress .add-task-slot-draft-leave-to {
  opacity: 0;
}

/* ========================================
 * JETZT: revealed by hovering the Jetzt section (heading + slot, not Wartet) or by focus.
 * Touch has no hover, so the label stays visible at rest there (never an invisible tap target).
 * ======================================== */
@media (hover: hover) {
  .add-task-slot--progress .add-task-button {
    opacity: 0;
  }

  #column-progress:hover .add-task-slot--progress .add-task-button,
  .add-task-slot--progress .add-task-button:focus {
    opacity: 1;
  }

  #column-progress:hover .add-task-slot--progress .add-task-button-surface,
  .add-task-slot--progress .add-task-button:focus .add-task-button-surface {
    background-color: var(--fill-on-canvas);
  }
}

@media (--phone) {
  /* Mobile cards are 8rem tall (TaskCard): the Jetzt slot keeps a card's box there too */
  .add-task-slot--progress,
  .add-task-slot--progress .add-task-button,
  .add-task-slot--progress .add-task-button .add-task-button-surface {
    min-height: 8rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .add-task-button,
  .add-task-button-icon,
  .add-task-button-label,
  .add-task-slot-draft-enter-active,
  .add-task-slot-draft-leave-active {
    transition: none !important;
  }
}
</style>
