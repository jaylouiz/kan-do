<!--
@component BoardCapacityDivider
@kind component
@category display
@description The "Kapazität" divider in the Offen list (#132): a wavy red line with the label in its middle at the point where the day's time is used up, a muted helper text under it and an info button that opens a popover saying the estimate learns with use (or, with a working day set in Einstellungen, that it is based on it, #306)
@usage Rendered by BoardColumnItem for the `capacity` list item, which BoardColumn inserts behind the card that fills the day (`useDayCapacity`, `withCapacityItem`). Only in the Offen column of the live board.
@avoid Not an alert and not a limit: it only informs, nothing is blocked (the WIP limit of Jetzt is the rule). Not for another column or a static board; for a note that acknowledges something use BoardColumnYesterdayNote.
@responsibility
- One root element, no sortable, no drag, no drop: it sits between the draggable items of the flat list (#146) and dnd-kit never sees it
- Wavy line (an SVG pattern in user space, so the waves keep their size at any width) in `error-700` with the label centred in it; the line is the `separator`, the label is its accessible name
- Helper text under the line in muted small type, left-aligned, with the info button right of it (`UButton` ghost neutral: the default size, so the theme brings focus ring, hover wash and the 44 px phone floor, #552); the popover is Nuxt UI's `UPopover` (click or tap, Enter and Space on the button, Esc closes)
- Card geometry: the card's width token capped like the card, centred, so the line and the text start where the cards start
- Calm tone (PRODUCT.md): `error-700` text on the page ground for the label only; the helper stays `text-muted`, no fill, no icon beside the label
-->
<template>
  <div
    class="capacity-divider"
    data-testid="capacity-divider"
  >
    <div
      class="capacity-divider__line"
      role="separator"
      :aria-label="t('board.capacity.label')"
    >
      <svg
        class="capacity-divider__wave"
        width="100%"
        height="8"
        aria-hidden="true"
      >
        <defs>
          <pattern
            :id="patternId"
            width="16"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 4 Q4 0 8 4 T16 4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="8"
          :fill="`url(#${patternId})`"
        />
      </svg>
      <span
        class="capacity-divider__label"
        aria-hidden="true"
      >{{ t('board.capacity.label') }}</span>
      <svg
        class="capacity-divider__wave"
        width="100%"
        height="8"
        aria-hidden="true"
      >
        <defs>
          <pattern
            :id="`${patternId}-end`"
            width="16"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 4 Q4 0 8 4 T16 4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="8"
          :fill="`url(#${patternId}-end)`"
        />
      </svg>
    </div>
    <div class="capacity-divider__note">
      <p class="capacity-divider__help">
        {{ t('board.capacity.help') }}
      </p>
      <UPopover :content="{ side: 'bottom', align: 'end', sideOffset: 6, collisionPadding: 8 }">
        <UButton
          color="neutral"
          variant="ghost"
          square
          icon="i-ph-info"
          class="capacity-divider__info"
          data-testid="capacity-info"
          :aria-label="t('board.capacity.infoLabel')"
        />
        <template #content>
          <p
            class="capacity-divider__pop"
            data-testid="capacity-info-text"
          >
            {{ t(isSet ? 'board.capacity.infoSet' : 'board.capacity.info') }}
          </p>
        </template>
      </UPopover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '~/store/settings'

defineOptions({ name: 'BoardCapacityDivider' })

const { t } = useI18n()
// The day length the user set in Einstellungen (#306) instead of the learned one: the info text says which
const isSet = computed(() => useSettingsStore().workingHoursMinutes !== null)
const patternId = `capacity-wave-${useId()}`
</script>

<style scoped>
.capacity-divider {
  margin-inline: auto;
  /* The box of a card: its width token, capped like the card, centred */
  width: min(var(--task-card-width, 100%), 100%);
  max-width: var(--task-card-max-width, 20rem);
  padding-bottom: 0.25rem;
  color: var(--ui-color-error-700);
  text-align: left;
}

.capacity-divider__line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.capacity-divider__wave {
  flex: 1 1 0;
  min-width: 0;
  height: 0.5rem;
}

.capacity-divider__label {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: var(--lh-snug);
  letter-spacing: 0.02em;
}

.capacity-divider__note {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.capacity-divider__help {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  padding-block: 0.25rem;
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
  color: var(--ui-text-muted);
}

.capacity-divider__info {
  flex: none;
  margin-inline-end: -0.25rem;
}

.capacity-divider__pop {
  max-width: 16rem;
  margin: 0;
  padding: 0.75rem;
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
}
</style>
