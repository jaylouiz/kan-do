<!--
@component AddTaskSlot
@description Card-sized add control that morphs into the draft card of the task being added, in the same box (#125). Its soft surface rests label-wide and grows into the card shape on hover/focus (#466)
@usage Offen: last item of the task list (BoardColumn). Jetzt: overlay of the empty column (BoardColumnProgressContent), opens add-and-start
@responsibility
- Native button named by its visible label, in a regular card's box (width, --task-card-height, card radius); the box never changes size, so layout, hit area and DnD rects stay put
- Inside the button, `.add-task-button-surface` (centred icon + label on --ui-bg-muted, button radius) is the visible shape. Offen: label-wide at rest (2.25rem = 36px on desktop, the height of the day-close `lg` button beside it, #582; 3rem on mobile, where `lg` is 48px), grows to the card box over --add-slot-grow-duration on hover (pointer devices only, so a tap never sticks), focus-visible and while drafting (held grown, so it does not jump back under the fading label); the label stays centred throughout. Growth animates min-width/min-height inside the fixed box (an accepted trade-off: a transform would distort radius and label)
- Offen on mobile: a sticky 48px bar (#33) that swaps for the draft at the end of the list (#110); the surface never grows there
- Jetzt: the `icon` prop (lightning) and the label say it starts a task now; the surface is always the full card shape; on pointer devices surface and label appear only while the Jetzt section is hovered or the slot has focus; touch shows the label at rest
- Drafting (useTaskDraft holds a draft for this column): the draft card fades in over the button, the label fades out; the button stays mounted but inert, so focus can return to it
- In-card adding (#649, `inCard`, Offen): the button opens NewCardFlow in the same box instead of the sheet and the slot is held grown like for a draft. Esc on a typed title also shows a "Rückgängig" toast that reopens the card with it (#665). Esc, a press outside a blank card, the sheet opening or a drag cancel it and send focus back to the button; a save swaps it for the saved card (no fade) and focuses that card. Jetzt and every other entry (palette, nav, menu) keep the sheet
- During a drag (`hidden`) the slot keeps its geometry but is invisible and not interactive
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
      @click="onButtonClick"
    >
      <span class="add-task-button-surface">
        <UIcon :name="props.icon" class="add-task-button-icon" aria-hidden="true" />
        <span class="add-task-button-label">{{ props.label }}</span>
      </span>
    </button>
    <!-- A saved draft is replaced by its card, so only cancel fades it back into the slot -->
    <Transition name="add-task-slot-draft" :css="!draftSaved && !flowSaved">
      <new-card-flow
        v-if="flowOpen"
        class="add-task-slot-draft"
        :initial-title="flowTitle"
        @saved="onFlowSaved"
        @cancel="closeFlow"
      />
      <task-draft-card v-else-if="isSheetDrafting" class="add-task-slot-draft" />
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
import { TaskStatus } from '~/types/taskStatus';
import { focusWhenReady, findSavedCardElement } from '~/utils/focusRecovery';

defineOptions({ name: 'AddTaskSlot' });

interface Props {
  /** Column the slot adds to: Offen, or Jetzt (add and start) */
  status: TaskStatus;
  /** Visible label, also the button's accessible name */
  label: string;
  /** False keeps only the draft (Offen with the feature flag off, a Jetzt that filled up while drafting) */
  showButton?: boolean;
  /** A drag is running: keep the box, hide it and take it out of interaction */
  hidden?: boolean;
  /** Icon in front of the label (Offen: plus, Jetzt: lightning) */
  icon?: string;
  /** Adding happens in the card itself (#649, Offen): the button opens NewCardFlow instead of emitting `open` */
  inCard?: boolean;
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
/** The title the card opens with: only after "Rückgängig" on a dropped title (#665) */
const flowTitle = ref<string | undefined>(undefined);
const { t } = useI18n();
const toast = useToast();
/** True once the flow ended in a save: the saved card replaces it, so it leaves without a fade */
const flowSaved = ref(false);
const isSheetDrafting = computed(() => draftTask.value?.status === props.status);
const isDrafting = computed(() => isSheetDrafting.value || flowOpen.value);

function onButtonClick() {
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
  buttonEl.value?.focus({ preventScroll: true });
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
  focusWhenReady(() => findSavedCardElement(id), [() => buttonEl.value]);
}

// The sheet (palette, nav, menu) and a drag take over: the unsaved card gives way
watch(() => route.path, (path) => {
  if (flowOpen.value && path.startsWith('/tasks/add')) flowOpen.value = false;
});
watch(() => props.hidden, (hidden) => {
  if (hidden) flowOpen.value = false;
});
/** Neither button nor draft: nothing to reserve the card box for */
const isEmpty = computed(() => !props.showButton && !isDrafting.value);
</script>

<style scoped>
/* ========================================
 * SLOT: one card box shared by the button and the draft card
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

.add-task-slot-draft {
  z-index: 1;
}

/* No button and no draft: the box is not reserved (two classes, so it also beats the mobile heights) */
.add-task-slot.is-empty {
  min-height: 0;
}

/* Drag: collision rects must not shift, so the box stays and only disappears */
.add-task-slot.is-hidden {
  visibility: hidden;
}

/* ========================================
 * BUTTON: a fixed card-sized hit area; the soft surface inside it rests label-wide and grows into the card shape on hover/focus (#466)
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
  font-size: 0.875rem;
  line-height: var(--lh-snug);
  text-align: center;
  cursor: pointer;
  transition: opacity var(--add-slot-reveal-duration) cubic-bezier(0.4, 0, 0.2, 1);
}

/* The visible shape. Compact at rest; min-width/min-height interpolate to the exact card box (the button's own box never moves) */
.add-task-button-surface {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  /* 2.25rem = the `lg` button's desktop height (DESIGN.md "Buttons"), so the add-task and day-close buttons match (#582). The hit area is the card-sized button, not this surface */
  min-height: 2.25rem;
  padding: 0.5rem 1rem;
  border-radius: inherit;
  background-color: var(--ui-bg-muted);
  transition:
    min-width var(--add-slot-grow-duration) cubic-bezier(0.4, 0, 0.2, 1),
    min-height var(--add-slot-grow-duration) cubic-bezier(0.4, 0, 0.2, 1);
}

.add-task-button-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
}

.add-task-button-icon,
.add-task-button-label {
  transition: opacity var(--task-transform-duration) cubic-bezier(0.4, 0, 0.2, 1);
}

/* Grown: the card box. Hover only on pointer devices, so a tap never leaves a sticky grown state;
   keyboard focus adds the solid ink ring (DESIGN.md); drafting holds the shape under the fading label */
@media (hover: hover) {
  .add-task-button:hover .add-task-button-surface {
    min-width: 100%;
    min-height: var(--task-card-height);
  }
}

.add-task-button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.add-task-button:focus-visible .add-task-button-surface,
.is-drafting .add-task-button-surface {
  min-width: 100%;
  min-height: var(--task-card-height);
}

/* Morph: the label leaves while the draft card's sheet fades in on top */
.is-drafting .add-task-button-icon,
.is-drafting .add-task-button-label {
  opacity: 0;
}

.add-task-slot-draft-leave-active {
  transition: opacity var(--task-transform-duration) cubic-bezier(0.4, 0, 0.2, 1);
}

.add-task-slot-draft-leave-to {
  opacity: 0;
}

/* ========================================
 * JETZT: revealed by hovering the Jetzt section (heading + slot, not Wartet) or by focus.
 * Touch has no hover, so the label stays visible at rest there (never an invisible tap target).
 * ======================================== */
/* The Jetzt surface is always the full card shape (it marks where the Jetzt card lands) */
.add-task-slot--progress .add-task-button-surface {
  min-width: 100%;
  min-height: var(--task-card-height);
  background-color: transparent;
  transition: none;
}

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
    background-color: var(--ui-bg-muted);
  }
}

/* ========================================
 * MOBILE OFFEN: sticky bar after the last card, pinned above the phone app bar on long lists (#33, #144).
 * Solid fill so cards scrolling underneath never show through; no brand fill (One Lamp).
 * While drafting the bar hides and the draft card takes its place at the end of the list (#110).
 * ======================================== */
@media (max-width: 767px) {
  /* Mobile cards are 8rem tall (TaskCard): the slot keeps a card's box there too */
  .add-task-slot,
  .add-task-button {
    min-height: 8rem;
  }

  .add-task-slot--open {
    position: sticky;
    /* 0: the column's own padding-bottom (--phone-bar-offset + 0.75rem, board.css) already shrinks the sticky view; adding the bar offset again pins the bar too high and over the last card */
    bottom: 0;
    z-index: 1500;
    /* Label-wide and centred (#244): the button fills the slot, so the slot's fit-content sets the width */
    width: fit-content;
    max-width: min(var(--task-card-max-width), 100%);
    min-height: 3rem;
  }

  /* The bar never grows: the surface stays label-wide (its resting shape) */
  .add-task-slot--open .add-task-button {
    min-height: 3rem;
  }

  .add-task-slot--open .add-task-button .add-task-button-surface {
    min-width: 0;
    min-height: 3rem;
  }

  /* Jetzt keeps the full card shape, which is 8rem tall here */
  .add-task-slot--progress .add-task-button .add-task-button-surface {
    min-height: 8rem;
  }

  .add-task-slot--open.is-drafting {
    /* The card takes a regular card's width (the bar above is label-wide) */
    width: min(var(--task-card-max-width), 100%);
    position: static;
    z-index: auto;
    min-height: 8rem;
  }

  .add-task-slot--open.is-drafting .add-task-button {
    visibility: hidden;
  }

  /* The bar and the draft have different boxes here: swap without a crossfade */
  .add-task-slot--open .add-task-slot-draft-leave-active {
    transition: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .add-task-button,
  .add-task-button-surface,
  .add-task-button-icon,
  .add-task-button-label,
  .add-task-slot-draft-leave-active {
    transition: none;
  }
}
</style>
