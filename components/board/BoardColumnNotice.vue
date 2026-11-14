<!--
@component BoardColumnNotice
@kind component
@category feedback
@description The compact strip a board column shows in place of cards (#293): a tinted surface with the card's radius, one line of content and exactly one soft action button. The shared basis of the deleted-card gap ("Im Papierkorb", "Rückgängig") and the yesterday note ("Gestern erledigt", "Gesehen"); the tone is the variant.
@usage Rendered by TaskDeletedGap (`tone="trash"`) and BoardColumnYesterdayNote (`tone="done"`); the consumer sets the strip's width and what happens on the action. The default slot is the line's content, `below` is room under the line (the note's opened list; it sits above the wash), `backdrop` and `overlay` are absolutely positioned layers under and over the line (the gap's card picture and drain line).
@avoid Not for an alert or an error (use a UAlert or the sync popover), not for a message that passes by (a toast), and never with a second action button; a strip with no action is not a notice.
@responsibility
- Surface (#605, #581; outline dropped #57): `--task-note-height` minimum (48px, 56px at 390px: a 32px button with 8px around it, the 44px phone button with 6px, #293), card radius, a tone wash on `::before` (`trash`: 12 % `error-500` over the page; `done`: `--done-note-wash`, 70 % `success-100` over `success-50`), no border. The wash has no z-index and the surface opens no stacking context (an `isolation` here let the Jetzt column's drop zone cover the undo pill); a consumer that cross-fades into the strip animates `::before` itself (the gap does)
- One action button, the same shape in both tones: `UButton` `variant="soft"`, the default 12 px radius (DESIGN.md radius scale, no pill), `text-sm` medium; `trash` is `color="error"` (the global compound sets `error-700` text, #594), `done` is `color="neutral"` with `success-800` text. The line keeps at least 8 px between the button and the strip's edges (6 px at 390px, where the button keeps its 44 px hit area)
- Emits `action` on click; `actionDisabled` disables it; `actionLabel` is its text, `actionAriaLabel` the accessible name, `actionTestId` its test id
- `--notice-line-justify` (default `space-between`), `--notice-line-wrap` (default `nowrap`) and `--notice-line-gap` (default `0.5rem`) are the consumer's levers on the line; the line is `.notice__line`, reachable with `:deep()` for a motion
-->
<template>
  <div
    class="notice"
    :class="`notice--${tone}`"
  >
    <slot name="backdrop" />
    <div class="notice__line">
      <slot />
      <UButton
        :color="tone === 'trash' ? 'error' : 'neutral'"
        variant="soft"
        class="notice__action"
        :disabled="actionDisabled"
        :aria-label="actionAriaLabel"
        :data-testid="actionTestId"
        @click="emit('action')"
      >
        {{ actionLabel }}
      </UButton>
    </div>
    <div
      v-if="$slots.below"
      class="notice__below"
    >
      <slot name="below" />
    </div>
    <slot name="overlay" />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'BoardColumnNotice' })

interface Props {
  /** `trash`: the raspberry strip of a deleted card; `done`: the done-green strip of the yesterday note. */
  tone: 'trash' | 'done'
  /** Text of the action button. */
  actionLabel: string
  /** Accessible name of the action button when the text alone is not enough. */
  actionAriaLabel?: string
  actionTestId?: string
  actionDisabled?: boolean
}

withDefaults(defineProps<Props>(), {
  actionAriaLabel: undefined,
  actionTestId: undefined,
  actionDisabled: false,
})

const emit = defineEmits<{
  /** The action button was clicked. */
  action: []
}>()
</script>

<style scoped>
.notice {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  /* 0.5rem above and below a 2rem button in the 3rem minimum; at 390px the 44 px button in 3.5rem leaves 0.375rem */
  min-height: var(--task-note-height);
  padding: 0.25rem 0.5rem 0.25rem 0.75rem;
  border-radius: var(--task-card-radius);
}

/* The wash comes first and has no z-index: the layers and the line paint over it (see the doc block on isolation) */
.notice::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--task-card-radius);
  background-color: var(--notice-wash);
}
.notice--trash {
  --notice-wash: color-mix(in oklab, var(--ui-color-error-500) 12%, var(--ui-bg));
}
.notice--done {
  --notice-wash: var(--done-note-wash);
}

.notice__line {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: var(--notice-line-justify, space-between);
  flex-wrap: var(--notice-line-wrap, nowrap);
  gap: var(--notice-line-gap, 0.5rem);
  min-height: 2rem;
}

/* Above the wash like the line: a positioned `::before` would otherwise paint over (and swallow clicks on) the list */
.notice__below {
  position: relative;
  z-index: 1;
}

.notice__action {
  flex-shrink: 0;
  min-height: 2rem;
  padding: 0 0.75rem;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: inherit;
}
/* the global error/soft compound sets error-700 (#594); the done tone brings its own text colour */
.notice--done .notice__action {
  color: var(--ui-color-success-800);
}

/* 44px hit area on the phone: the strip's minimum (3.5rem) leaves 0.375rem around it. The 44 px floor is restated because
   the button's own min-height (2rem) outranks the theme's */
@media (--phone) {
  .notice {
    padding-block: 0;
  }

  .notice__line,
  .notice__action {
    min-height: 2.75rem;
  }
}
</style>
