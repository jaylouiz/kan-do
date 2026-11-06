<!--
@component TaskTimeboxNudge
@description In-card micro dialog (#389) that offers a timebox when a card without one lands in Jetzt
@usage Inside TaskCard (the Jetzt card only); the board store's `timeboxNudgeTaskId` decides which card shows it
@responsibility
- Non-modal layer over the card face: no focus move, no trap; only its controls take pointer events, so the
  card stays draggable and a double click on the face still opens the sheet (on touch the layer swallows the click)
- One-click presets (15, 30 min) and an inline minutes field (1 to 480); Escape steps back, then dismisses
- Auto-dismisses after TIMEBOX_NUDGE_MS; the hairline countdown pauses while the pointer or focus is on the layer or the field is open
- Ends itself when the card leaves Jetzt, is deleted, gets a timebox elsewhere or opens its sheet
- The card dims its own content through the `task--nudged` class (TaskCard); the rules for both live in this file

In-card question pattern (DESIGN.md "Ask in place"; this is its first user, extract a shared layer when a second exists):
- One at a time, keyed by task id in a transient board-store flag (a cross-column move mounts the card fresh), set
  only by user-driven moves: never by page load, sync, undo or closing the day
- Covers the card face, does not rearrange it: a radial wash of the sheet colour (the stack pill's wash), the card's
  content hidden underneath (still in the DOM), answers as soft pills like the stack pill, the question in the Title step
- Copy is the question only ("Timebox hinzufügen?"): no title bar, no Abbrechen/OK pair; the answer is the click
- `role="group"` named by the question, real buttons after the card's content in DOM order, never `role="dialog"` or
  `aria-modal`; no announcement and no focus move. Accepted: a keyboard user reaches it by tabbing and has the
  palette, menu and sheet for the same action
- The countdown is a functional animation and stays under reduced motion; fades and the settle do not
-->
<template>
  <Transition name="nudge" appear>
    <div
      v-if="active"
      ref="rootEl"
      class="nudge"
      role="group"
      :aria-labelledby="questionId"
      @pointerenter="hovered = true"
      @pointerleave="hovered = false"
      @focusin="focused = true"
      @focusout="onFocusOut"
      @click.stop
      @dblclick.stop
      @keydown.esc.stop="onEscape"
    >
      <span class="nudge__wash" aria-hidden="true" />
      <div class="nudge__panel">
        <p :id="questionId" class="nudge__question">{{ t('task.timeboxNudge.question') }}</p>

        <div v-if="!editing" class="nudge__row">
          <button
            v-for="minutes in NUDGE_PRESETS"
            :key="minutes"
            type="button"
            class="nudge__button"
            :class="{ 'is-picked': picked === minutes }"
            @click="pick(minutes)"
          >
            {{ t('task.timeboxNudge.preset', { minutes }) }}
          </button>
          <button
            ref="customButtonEl"
            type="button"
            class="nudge__button nudge__button--icon"
            :aria-label="t('task.timeboxNudge.custom')"
            :title="t('task.timeboxNudge.custom')"
            @click="startEdit"
          >
            <UIcon name="i-ph-dots-three" class="size-4" />
          </button>
        </div>

        <form v-else class="nudge__row nudge__row--edit" novalidate @submit.prevent="applyCustom">
          <label class="nudge__field">
            <input
              ref="inputEl"
              v-model.number="customMinutes"
              type="number"
              inputmode="numeric"
              :min="MIN_MINUTES"
              :max="MAX_MINUTES"
              class="nudge__input"
              :aria-label="t('task.timeboxNudge.minutes')"
            >
            <span class="nudge__unit" aria-hidden="true">{{ t('task.timeboxNudge.unit') }}</span>
          </label>
          <button
            type="submit"
            class="nudge__button nudge__button--icon"
            :disabled="!validCustom"
            :aria-label="t('task.timeboxNudge.apply')"
          >
            <UIcon name="i-ph-check" class="size-4" />
          </button>
        </form>

        <span
          class="nudge__bar"
          :class="{ 'is-paused': paused }"
          :style="{ '--nudge-duration': `${TIMEBOX_NUDGE_MS}ms` }"
          aria-hidden="true"
          @animationend="onBarEnd"
        />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "~/types/task";
import { useBoardStore, TIMEBOX_NUDGE_MS } from "~/store/board";
import { useTasksStore } from "~/store/tasks";
import { useSheetSpotlight } from "~/composables/useSheetSpotlight";

defineOptions({ name: "TaskTimeboxNudge" });

const props = defineProps<{ task: Task }>();

/** The one-click answers (TIMEBOX_PRESETS in utils/taskMenuOptions.ts is the menu's longer list and stays as it is) */
const NUDGE_PRESETS = [15, 30];
const MIN_MINUTES = 1;
const MAX_MINUTES = 480;
const DEFAULT_CUSTOM_MINUTES = 45;
/** How long the picked button shows its pressed state before the layer leaves */
const PICKED_HOLD_MS = 240;

const { t } = useI18n();
const boardStore = useBoardStore();
const tasksStore = useTasksStore();
const { spotlightTaskId } = useSheetSpotlight();
const questionId = useId();

const active = computed(
  () => boardStore.timeboxNudgeTaskId === props.task.id && props.task.status === TaskStatus.Progress && !props.task.timeBoxSeconds,
);

const hovered = ref(false);
const focused = ref(false);
const editing = ref(false);
const picked = ref<number | null>(null);
const customMinutes = ref<number | undefined>(DEFAULT_CUSTOM_MINUTES);
const rootEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const customButtonEl = ref<HTMLButtonElement | null>(null);
let pickTimer: number | undefined;

/** Paused, not reset: the animation keeps its progress while the play state is paused */
const paused = computed(() => hovered.value || focused.value || editing.value || picked.value !== null);
const validCustom = computed(() => {
  const value = customMinutes.value;
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_MINUTES && value <= MAX_MINUTES;
});

const end = () => boardStore.endTimeboxNudge(props.task.id);

/**
 * A new run starts clean. When the layer leaves while focus is inside it, focus goes back to the card
 * (its focusable wrapper) instead of falling to the page: the layer never takes focus, but it must not strand it.
 */
watch(active, (isActive) => {
  if (!isActive) {
    const layer = rootEl.value;
    if (layer?.contains(document.activeElement)) {
      (layer.closest(".task-wrapper") as HTMLElement | null)?.focus({ preventScroll: true });
    }
    return;
  }
  hovered.value = false;
  focused.value = false;
  editing.value = false;
  picked.value = null;
  customMinutes.value = DEFAULT_CUSTOM_MINUTES;
});

/** Anything that settles the question elsewhere ends the nudge: the card left Jetzt, a timebox set through menu/palette/sheet, the sheet opened */
watch(
  () => [props.task.status, props.task.timeBoxSeconds, spotlightTaskId.value === props.task.id] as const,
  ([status, timeBox, sheetOpen]) => {
    if (status !== TaskStatus.Progress || timeBox || sheetOpen) end();
  },
);

/** A card that unmounts for good (deleted, moved away) must not leave the flag behind; a re-render in Jetzt keeps it */
onBeforeUnmount(() => {
  window.clearTimeout(pickTimer);
  const live = tasksStore.task(props.task.id);
  if (!live || live.status !== TaskStatus.Progress || live.timeBoxSeconds) end();
});

const onFocusOut = (event: FocusEvent) => {
  const next = event.relatedTarget as Node | null;
  if (!next || !(event.currentTarget as HTMLElement).contains(next)) focused.value = false;
};

/** The picked button shows its pressed state for one beat, then the timebox is set and the layer leaves, the ring behind it */
const pick = (minutes: number) => {
  if (picked.value !== null) return;
  picked.value = minutes;
  pickTimer = window.setTimeout(() => {
    // A timebox set meanwhile through menu/palette/sheet stays (the watcher above has already ended the nudge)
    if (!props.task.timeBoxSeconds) tasksStore.updateTask(props.task.id, { timeBoxSeconds: minutes * 60 });
    end();
  }, PICKED_HOLD_MS);
};

const startEdit = async () => {
  editing.value = true;
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
};

const applyCustom = () => {
  if (validCustom.value) pick(customMinutes.value as number);
};

/** One level back (field to buttons, focus on the "…" it came from), then dismiss */
const onEscape = async () => {
  if (editing.value) {
    editing.value = false;
    await nextTick();
    customButtonEl.value?.focus();
  } else {
    end();
  }
};

const onBarEnd = (event: AnimationEvent) => {
  if (event.animationName === "nudge-drain") end();
};
</script>

<style>
/* ===========================================================================
   Timebox nudge (#389): the first in-card question (DESIGN.md "Ask in place", pattern notes in the doc block).
   Global, not scoped, so the card can dim its own content. Colours are Nuxt UI tokens only; the card face is
   covered by a radial wash of the sheet colour (the stack pill's pattern, #270/#371).
   =========================================================================== */
.nudge {
  position: absolute;
  inset: 0;
  z-index: 30; /* above the corner glyph (10) and the done layer (20), inside the card's own stacking context */
  border-radius: var(--task-card-radius);
  pointer-events: none; /* only the controls take pointer events: the card stays draggable and its face still double-clicks open */
  --nudge-ease: cubic-bezier(0.4, 0, 0.2, 1);
}

.nudge__wash {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    ellipse 120% 110% at center,
    var(--ui-bg-elevated) 55%,
    color-mix(in oklab, var(--ui-bg-elevated) 82%, transparent) 100%
  );
}

.nudge__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 0 0.75rem;
}

.nudge__panel > :not(.nudge__bar) {
  pointer-events: auto;
}

.nudge__question {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.25rem;
  font-weight: 500;
  color: var(--ui-text-highlighted);
  text-align: center;
  text-wrap: balance; /* wraps at large text sizes instead of running out of the card */
}

.nudge__row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  max-width: 15rem;
}

.nudge__row--edit {
  justify-content: center;
}

.nudge__button {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  min-width: 0;
  padding: 0 0.75rem;
  border-radius: 9999px; /* the stack pill's radius (TaskStackPill) */
  background-color: var(--ui-bg-muted);
  color: var(--ui-text);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 150ms var(--nudge-ease),
    color 150ms var(--nudge-ease),
    transform 150ms var(--nudge-ease);
}

.nudge__button--icon {
  flex: 0 0 2.25rem;
  width: 2.25rem;
  padding: 0;
}

/* Ink hover; the picked button keeps it and presses in (one lamp: only the answered control is dark) */
.nudge__button:hover:not(:disabled),
.nudge__button:active:not(:disabled),
.nudge__button.is-picked {
  background-color: var(--ui-primary);
  color: var(--ui-bg);
}

.nudge__button:active:not(:disabled),
.nudge__button.is-picked {
  transform: scale(0.97);
}

.nudge__button:focus-visible,
.nudge__field:focus-within {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.nudge__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nudge__field {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: 2.25rem;
  min-width: 0;
  padding: 0 0.75rem;
  border-radius: 9999px;
  background-color: var(--ui-bg-muted);
  box-shadow: inset 0 0 0 1px var(--ui-border-accented);
}

.nudge__input {
  width: 3rem;
  height: 100%;
  border: 0;
  background: transparent;
  text-align: right;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--ui-text-highlighted);
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
  appearance: textfield;
}

.nudge__input:focus-visible {
  outline: none; /* the pill around it carries the focus ring */
}

.nudge__input::-webkit-outer-spin-button,
.nudge__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.nudge__unit {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ui-text-toned);
}

/* Countdown hairline: a muted track with a fill that drains over TIMEBOX_NUDGE_MS (CSS animation + animationend;
   functional, so it stays under reduced motion). Paused, not reset, while the pointer or focus is on the layer. */
.nudge__bar {
  position: absolute;
  left: 1.5rem;
  right: 1.5rem;
  bottom: 1.5rem;
  height: 2px;
  background-color: var(--ui-bg-muted);
  overflow: hidden;
}

.nudge__bar::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: color-mix(in oklab, var(--ui-primary) 45%, transparent);
  transform-origin: left center;
  animation: nudge-drain var(--nudge-duration) linear forwards;
}

.nudge__bar.is-paused::after {
  animation-play-state: paused;
}

@keyframes nudge-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

/* The layer fades in (180ms) with a 4px settle and out (220ms) */
.nudge-enter-active {
  transition: opacity 180ms var(--nudge-ease);
}

.nudge-leave-active {
  transition: opacity 220ms var(--nudge-ease);
}

.nudge-enter-active .nudge__panel {
  transition: transform 180ms var(--nudge-ease);
}

.nudge-enter-from,
.nudge-leave-to {
  opacity: 0;
}

.nudge-enter-from .nudge__panel {
  transform: translateY(4px);
}

/* The card's own content steps back while the layer is up: hidden, still in the DOM (opacity only). It fades out with
   the layer's 180ms; when the nudge ends the class goes and the layer's own fade reveals the content. */
.task--nudged > [data-slot="body"] > :not(.nudge),
.task--nudged > [data-slot="footer"] {
  opacity: 0;
  animation: nudge-content-out 180ms var(--nudge-ease);
}

@keyframes nudge-content-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* Touch: the layer takes the pointer, so a tap on the face outside the buttons does nothing (it no longer opens the
   sheet); a drag from the face still starts because pointer events bubble to the card. Buttons are 44px. */
@media (hover: none) and (pointer: coarse) {
  .nudge {
    pointer-events: auto;
  }
}

/* 44px targets on a phone and on any touch screen, a tablet at desktop width included */
@media (max-width: 767px), (hover: none) and (pointer: coarse) {
  .nudge__button,
  .nudge__field {
    height: 2.75rem;
  }

  .nudge__button--icon {
    flex-basis: 2.75rem;
    width: 2.75rem;
  }

  .nudge__panel {
    gap: 0.5rem;
  }

  .nudge__bar {
    bottom: 1.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nudge-enter-active,
  .nudge-leave-active,
  .nudge-enter-active .nudge__panel {
    transition-duration: 0ms;
  }

  .nudge-enter-from .nudge__panel {
    transform: none;
  }

  .task--nudged > [data-slot="body"] > :not(.nudge),
  .task--nudged > [data-slot="footer"] {
    animation: none;
  }

  .nudge__button {
    transition-duration: 0ms;
  }

  .nudge__button:active:not(:disabled),
  .nudge__button.is-picked {
    transform: none;
  }
}
</style>
