<!--
@component RecapDeck
@kind component
@category display
@description One group of the new-day recap (#385, #451): the finished or still-open tasks as a swipe deck. The front card
shows with up to two layers peeking behind it; swiping, tapping, ←/→ or the chevrons send it to the back. The deck never
changes size, so nothing on the page moves while it is looked at.
@usage Rendered by NewDayRecap, kind `undone` (left) and kind `done` (right). The parent skips the `undone` group when it is empty; the `done` group is always rendered and copes with an empty list itself (counter "0 / 0", no card, chevrons and keys inert, not a tab stop), as it does with a single card.
@avoid Only inside NewDayRecap; a plain list of tasks uses DayCloseTaskRow rows.
@responsibility
- `hideHeading`: the heading row turns visually hidden (still the section's name) when the phone switcher already says which deck it is (#44)
- Layout: heading row (`min-h-10`, `h2` above the cards), the deck (card height + 1.25rem, whatever the card content or n), the bar (chevron, counter "1 / n", chevron)
- Cards are view-only: inert, hidden from the accessibility tree, no task sheet. Front card = newest completion (done) or Jetzt/Offen first (undone)
- With 2+ cards the deck is one tab stop: `role="group"`, `tabindex="0"`, roledescription "Stapel", name "{label}, mit Pfeiltasten wechseln"; ←/→ act only while the deck itself has focus. With 0 or 1 card there is nothing to switch to (#478): no `tabindex`, no roledescription, the name is just "{label}"; all three follow `canMove` when the count crosses 1 <-> 2
- A visually hidden polite live region announces "2 von 4: Titel" after a settled change (the cards are inert, so this is how a screen reader hears the front card); the counter is decorative
- Geometry: layer d (max 2) at `translateY(d*8px) scale(1 - d*0.04)`, deeper cards hidden; front card follows the pointer with `rotate(dx/24 deg)`
- Motion (#690): the travelling card (next: front, prev: back) slides sideways 50% of the deck width at full opacity (130ms), then takes its new depth, so it passes behind the stack (next) or comes to the front (prev); settle 240ms `cubic-bezier(0.22, 1, 0.36, 1)` on transform. Nothing fades out; a card deeper than layer 2 stays visible while it travels. With prefers-reduced-motion cards swap at once (the drag still follows the pointer)
- The grab area carries `data-vaul-no-drag`: on phones the deck sits in a drawer, and a card swipe must never drag it closed (closing archives the done tasks, #44)
- Gesture, queue and timers live in `useSwipeDeck` (drag past 80px or tap = next, 6px tap slop, queue of 8)
- Accepted trade-offs (#451): one card at a time, no list view; two chevrons per deck stay focusable (six tab stops for two decks) so keyboard users need not discover the arrow keys
-->
<template>
  <section class="recap-deck-group" :aria-labelledby="headingId">
    <header class="recap-deck__heading" :class="{ 'sr-only': hideHeading }">
      <h2 :id="headingId" class="font-display text-headline text-muted" data-testid="recap-deck-label">
        {{ label }}
      </h2>
    </header>

    <div
      class="recap-deck"
      :class="{ 'recap-deck--multi': deck.canMove.value }"
      :tabindex="deck.canMove.value ? 0 : undefined"
      role="group"
      :aria-roledescription="deck.canMove.value ? t('recap.deck.roleDescription') : undefined"
      :aria-label="deck.canMove.value ? t('recap.deck.label', { label }) : label"
      :data-testid="`recap-deck-${kind}`"
      @keydown="deck.onKeydown"
    >
      <span
        v-for="(task, index) in cards"
        :key="task.id"
        class="recap-deck__card"
        :class="{ 'recap-deck__card--instant': deck.dragging.value && deck.depthOf(index) === 0, 'recap-deck__card--hidden': deck.depthOf(index) > 2, 'recap-deck__card--out': deck.moving.value?.index === index && deck.moving.value.stage === 'out' }"
        :style="cardStyle(index)"
        inert
        aria-hidden="true"
        data-testid="recap-deck-card"
      >
        <TaskCard :task="task" />
      </span>
      <div
        ref="grabRef"
        class="recap-deck__grab"
        data-vaul-no-drag
        @pointerdown="onPointerDown"
        @pointermove="deck.onPointerMove"
        @pointerup="deck.onPointerUp"
        @pointercancel="deck.onPointerCancel"
        @lostpointercapture="deck.onPointerCancel"
      />
    </div>

    <div class="recap-deck__bar">
      <UButton
        color="neutral"
        variant="ghost"
        :icon="ICONS.back"
        :aria-label="t('recap.deck.previous')"
        :disabled="!deck.canMove.value"
        :data-testid="`recap-prev-${kind}`"
        @click="deck.prev()"
      />
      <span class="recap-deck__counter text-sm text-muted tabular-nums" aria-hidden="true" data-testid="recap-deck-counter">
        {{ t('recap.deck.counter', { position: deck.position.value, total: tasks.length }) }}
      </span>
      <span class="sr-only" aria-live="polite" data-testid="recap-deck-live">{{ announcement }}</span>
      <UButton
        color="neutral"
        variant="ghost"
        :icon="ICONS.forward"
        :aria-label="t('recap.deck.next')"
        :disabled="!deck.canMove.value"
        :data-testid="`recap-next-${kind}`"
        @click="deck.next()"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskCard from '~/components/task/TaskCard.vue'
import { useSwipeDeck } from '~/composables/useSwipeDeck'
import type { Task } from '~/types/task'

defineOptions({ name: 'RecapDeck' })

const props = defineProps<{
  tasks: Task[]
  kind: 'done' | 'undone'
  /** The switcher above names the deck (phone, #44): the heading stays for assistive tech only. */
  hideHeading?: boolean
}>()

const { t } = useI18n()
const headingId = `recap-group-${useId()}`
const label = computed(() => t(props.kind === 'done' ? 'recap.deck.done' : 'recap.deck.undone', { n: props.tasks.length }))

/** Deal order, front card first: the newest completion for the done deck, Jetzt/Offen first for the rest. */
const cards = computed(() => (props.kind === 'done' ? [...props.tasks].reverse() : props.tasks))

const grabRef = ref<HTMLElement | null>(null)
const deck = useSwipeDeck({
  count: () => cards.value.length,
  key: () => cards.value.map(task => task.id).join('|'),
  // far enough to clear the deck's edge, not to leave it: the card goes behind the stack, so it never widens the page
  flyDistance: () => (grabRef.value?.offsetWidth ?? 288) * 0.5,
})

/**
 * Layer geometry by depth; the front card follows the pointer. Deeper than the second layer is hidden, except the card that
 * travels in a move (#690): it stays visible at full opacity, so it never seems to leave the deck.
 */
function cardStyle(index: number) {
  const depth = deck.depthOf(index)
  const m = deck.moving.value?.index === index ? deck.moving.value : null
  if (depth === 0) {
    const x = deck.frontX.value
    return { zIndex: 10, transform: `translateX(${x}px) translateY(0px) scale(1) rotate(${x / 24}deg)`, opacity: 1 }
  }
  const shown = Math.min(depth, 2)
  const x = m && m.stage === 'out' ? m.x : 0
  return {
    zIndex: 10 - depth,
    transform: `translateX(${x}px) translateY(${shown * 8}px) scale(${1 - shown * 0.04}) rotate(${x / 24}deg)`,
    opacity: depth > 2 && !m ? 0 : 1,
  }
}

/** Set after a settled change, so a screen reader hears the new front card once and nothing on first render. */
const announcement = computed(() => {
  const index = deck.announceIndex.value
  const task = index === null ? undefined : cards.value[index]
  return task ? t('recap.deck.announce', { position: (index ?? 0) + 1, total: cards.value.length, title: task.title }) : ''
})

function onPointerDown(event: PointerEvent) {
  deck.onPointerDown(event)
  // keep the gesture on the deck when the pointer leaves it; jsdom and old WebViews may lack capture
  if (event.button === 0 || event.pointerType === 'touch') grabRef.value?.setPointerCapture?.(event.pointerId)
}
</script>

<style scoped>
.recap-deck-group {
  display: flex;
  flex-direction: column;
  width: min(100%, 18rem);
}

/* Heading above the cards in a row of fixed height: both decks share one baseline */
.recap-deck__heading {
  display: flex;
  align-items: center;
  min-height: 2.5rem;
  margin-bottom: 0.5rem;
}
.recap-deck__heading h2 {
  text-align: left;
}

/* Height is card height + room for the two layers, whatever the content or n */
.recap-deck {
  position: relative;
  display: block;
  width: 100%;
  height: calc(var(--task-card-height, 8.25rem) + 1.25rem);
  text-align: left;
  user-select: none;
  -webkit-user-select: none;
  border-radius: var(--radius-lg);
}
.recap-deck:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 6px;
}
.recap-deck__card {
  position: absolute;
  inset: 0 0 auto 0;
  display: block;
  transform-origin: 50% 100%;
  pointer-events: none;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease;
}
.recap-deck__card--hidden {
  /* a card that drops below layer 2 stays visible until it has travelled behind the stack, then vanishes (#690) */
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 0s linear 260ms;
}
.recap-deck__card--out {
  transition: transform 130ms cubic-bezier(0.33, 1, 0.68, 1);
}
.recap-deck__card--instant {
  transition: none;
}
.recap-deck__grab {
  position: absolute;
  inset: 0;
  z-index: 20;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.recap-deck--multi .recap-deck__grab {
  cursor: grab;
}
.recap-deck--multi .recap-deck__grab:active {
  cursor: grabbing;
}

/* Fixed height: the 44px phone floor of the chevron buttons (button theme, #552) decides it, for every n */
.recap-deck__bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  margin-top: 0.25rem;
}
.recap-deck__counter {
  min-width: 3.5rem;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .recap-deck__card {
    transition: none;
  }
}
</style>
