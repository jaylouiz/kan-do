<!--
@component BoardColumnYesterdayNote
@description One-line "Gestern erledigt" note on a soft Done-Teal surface at the top of the Done column
@usage Rendered by BoardColumn above today's done list while tasks finished before today are not acknowledged
@responsibility
- Show an honest day label (yesterday / weekday / recently) and the count on one line; the label button opens the titles in place (aria-expanded, local view state, never persisted)
- Opened: at most five titles as quiet rows (time spent on the right, hidden at zero) that open the task sheet, then "+ n weitere"
- Offer exactly one action ("Gesehen") on the line; the parent archives all tasks of the note
- Keep today's wins on top: 42px collapsed on desktop (46px at 390px so both controls reach 44px), card width, centred
- Surface (#605, D2): `success-50` fill (`--done-confirm-wash`, the in-card confirmation wash; deliberately not the `success-100` Erledigt drop wash, so it never reads as a drop target), 1px `success-200` hairline, card radius. Tick and "Gesehen" in `success-800`; title row neutral, rows `toned`
- Collapse over 180ms when it leaves (instant under prefers-reduced-motion); the caret rotates 180ms
-->
<template>
  <section
    class="yesterday-note"
    :aria-labelledby="headingId"
  >
    <div class="yesterday-note__inner">
      <div class="yesterday-note__surface">
        <div class="yesterday-note__line">
          <h3
            :id="headingId"
            class="yesterday-note__heading"
          >
            <button
              type="button"
              class="yesterday-note__toggle focus-ring"
              data-testid="yesterday-toggle"
              :aria-expanded="open"
              @click="open = !open"
            >
              <UIcon
                name="i-ph-check"
                class="yesterday-note__tick"
                aria-hidden="true"
              />
              <span class="min-w-0 truncate">
                {{ headline }}<span class="text-muted"><span aria-hidden="true"> · </span>{{ tasks.length }}</span>
              </span>
              <UIcon
                name="i-ph-caret-down"
                class="yesterday-note__caret text-muted"
                :class="{ 'yesterday-note__caret--open': open }"
                aria-hidden="true"
              />
            </button>
          </h3>
          <button
            type="button"
            class="yesterday-note__ack focus-ring"
            data-testid="yesterday-ack"
            :aria-label="t('board.yesterday.ackLabel', { n: tasks.length }, tasks.length)"
            @click="emit('acknowledge')"
          >
            {{ t('board.yesterday.ack') }}
          </button>
        </div>

        <ul
          v-if="open"
          class="yesterday-note__list"
        >
          <li
            v-for="task in visibleTasks"
            :key="task.id"
          >
            <button
              type="button"
              class="yesterday-note__title focus-ring text-toned"
              @click="openTask(task.id)"
            >
              <span class="yesterday-note__name min-w-0 flex-1 truncate" data-private>{{ task.title }}</span>
              <span
                v-if="timeSpent(task)"
                class="yesterday-note__time text-xs text-muted tabular-nums"
              >{{ timeSpent(task) }}</span>
            </button>
          </li>
          <li
            v-if="hiddenCount > 0"
            class="yesterday-note__more text-muted"
          >
            {{ t('board.yesterday.more', { n: hiddenCount }) }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '~/types/task'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { useToday } from '~/composables/useToday'
import { doneDayLabel, newestCompletedAt, weekdayName } from '~/utils/doneDayLabel'

defineOptions({ name: 'BoardColumnYesterdayNote' })

/** Titles shown when opened before the rest collapses into "+ n weitere". */
const MAX_VISIBLE = 5

interface Props {
  /** All tasks done before today and not archived (one group, one action) */
  tasks: Task[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** Emitted when the user clicks "Gesehen"; the parent archives every task of the note */
  acknowledge: []
}>()

const { t } = useI18n()
const { locale, formatDuration } = useLocaleFormat()
const { today } = useToday()
const headingId = `yesterday-note-${useId()}`

/** Open/closed is local view state: not persisted, closed again when the note returns. */
const open = ref(false)

const visibleTasks = computed(() => props.tasks.slice(0, MAX_VISIBLE))
const hiddenCount = computed(() => Math.max(0, props.tasks.length - MAX_VISIBLE))

const headline = computed(() => {
  const label = doneDayLabel(newestCompletedAt(props.tasks), today.value)
  if (label.kind === 'yesterday') return t('board.yesterday.headingYesterday')
  if (label.kind === 'weekday') {
    return t('board.yesterday.headingWeekday', { weekday: weekdayName(label.date, locale.value) })
  }
  return t('board.yesterday.headingRecent')
})

/** Time spent on the task, empty when none was tracked. */
function timeSpent(task: Task): string {
  return task.timeSpentSeconds > 0 ? formatDuration(task.timeSpentSeconds, 'spaced') : ''
}

/** Opens the task in the sheet (same route as a card). */
function openTask(taskId: string) {
  navigateTo({ path: `/tasks/${taskId}` })
}
</script>

<style scoped>
/* The note collapses by animating its own grid row; nothing else (never .board) transitions. */
.yesterday-note {
  display: grid;
  grid-template-rows: 1fr;
  /* minmax(0, 1fr): a long title must truncate, not widen the note past the column */
  grid-template-columns: minmax(0, 1fr);
  margin-inline: auto;
  /* The box of a card: its width token, capped like the card, centred. The inset is the task list's own
     padding (px-3, md:px-10), so the edges line up with the cards at every column width. */
  width: min(var(--task-card-width, 100%), calc(100% - 1.5rem));
  max-width: var(--task-card-max-width, 20rem);
}

@media (min-width: 768px) {
  .yesterday-note {
    width: min(var(--task-card-width, 100%), calc(100% - 5rem));
  }
}

.yesterday-note__inner {
  min-height: 0;
  min-width: 0;
  /* 1.25rem breathing room to today's list; part of the inner so it collapses with the note */
  padding-bottom: 1.25rem;
  text-align: left;
}

.yesterday-note__surface {
  padding: 0.25rem 0.5rem 0.25rem 0.75rem;
  background-color: var(--done-confirm-wash);
  border: 1px solid var(--ui-color-success-200);
  border-radius: var(--task-card-radius);
}

.yesterday-note__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 2rem;
}

.yesterday-note__heading {
  min-width: 0;
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.yesterday-note__toggle {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  max-width: 100%;
  min-height: 2rem;
  padding: 0;
  border-radius: 0.25rem;
  font-size: var(--text-sm, 0.875rem);
  line-height: 1.25rem;
  color: var(--ui-text-highlighted);
  cursor: pointer;
}

.yesterday-note__tick {
  flex-shrink: 0;
  width: 0.875rem;
  height: 0.875rem;
  color: var(--ui-color-success-800);
}

.yesterday-note__caret {
  flex-shrink: 0;
  width: 0.75rem;
  height: 0.75rem;
  transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.yesterday-note__caret--open {
  transform: rotate(180deg);
}

.yesterday-note__ack {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  min-height: 2rem;
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  font-size: var(--text-sm, 0.875rem);
  font-weight: 500;
  color: var(--ui-color-success-800);
  text-underline-offset: 0.2em;
  cursor: pointer;
}

.yesterday-note__ack:hover {
  text-decoration: underline;
}

/* 44px hit areas on the phone (D4): the line grows to 44px, the surface drops its vertical padding (46px with the border) */
@media (max-width: 767px) {
  .yesterday-note__surface {
    padding-block: 0;
  }

  .yesterday-note__line,
  .yesterday-note__toggle,
  .yesterday-note__ack {
    min-height: 2.75rem;
  }

  .yesterday-note__ack {
    padding-inline: 0.5rem;
  }
}

.yesterday-note__list {
  margin: 0;
  padding: 0.25rem 0 0.375rem 1.25rem;
  list-style: none;
}

.yesterday-note__title {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  width: 100%;
  min-height: 1.75rem;
  padding: 0.125rem 0;
  text-align: left;
  font-size: var(--text-sm, 0.875rem);
  line-height: 1.5rem;
  cursor: pointer;
  border-radius: 0.25rem;
}

.yesterday-note__title:hover .yesterday-note__name {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.yesterday-note__time {
  flex-shrink: 0;
}

.yesterday-note__more {
  font-size: var(--text-sm, 0.875rem);
  line-height: 1.75rem;
}

.yesterday-note-leave-active,
.yesterday-note-enter-active {
  transition: grid-template-rows 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.yesterday-note-leave-active .yesterday-note__inner,
.yesterday-note-enter-active .yesterday-note__inner {
  overflow: hidden;
}

.yesterday-note-leave-to,
.yesterday-note-enter-from {
  grid-template-rows: 0fr;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .yesterday-note-leave-active,
  .yesterday-note-enter-active,
  .yesterday-note__caret {
    transition: none;
  }
}
</style>
