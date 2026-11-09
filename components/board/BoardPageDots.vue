<!--
@component BoardPageDots
@kind primitive
@category navigation
@description Phone page indicator: three dots above the column title, the active one a stretched pill
@usage Rendered once by Board.vue beside .board (so it does not slide with the pages)
@avoid Phone only, for the three board pages; not a tab bar or pagination on desktop.
@responsibility
- Says that three pages exist (Offen, Jetzt + Wartet, Erledigt) and which one is showing (kd#26)
- Follows a live swipe: the pill stretches from one dot to the next with the finger, then settles on the board's own timing
- Pure indicator: not focusable, not tappable (`pointer-events: none`, `aria-hidden`), so it is no tab bar (#470, ADR 017); the page is
  already exposed by the column headings and `data-mobile-page`, a hidden "page 2 of 3" would say it twice
- Phone only (display none from 768 px; scoped CSS, since an unlayered `display: flex` beats the layered `md:hidden`); `prefers-reduced-motion` drops the settle transition
Accepted trade-off: dots 6 px (`--page-dot`), active pill 20 px; colours `--ui-border-accented` and `--ui-text-muted`, no text.
-->
<template>
  <div class="page-dots" :class="{ 'page-dots--live': live }" aria-hidden="true" data-testid="page-dots">
    <span
      v-for="i in PAGE_DOT_COUNT"
      :key="i"
      class="page-dot"
      :data-active="i - 1 === page ? '' : undefined"
      :style="{ '--w': dotWeight(i - 1, progress) }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PAGE_DOT_COUNT, dotWeight, pageProgress } from "~/lib/pageDots";

defineOptions({ name: "BoardPageDots" });

const props = defineProps<{
  /** Settled page index (0..2) */
  page: number;
  /** Live finger offset in px while a swipe is under way */
  offsetPx: number;
  /** True while the finger is down on a swipe: the pill tracks it with no transition */
  live: boolean;
}>();

const progress = computed(() =>
  pageProgress(props.page, props.offsetPx, import.meta.client ? window.innerWidth : 0),
);
</script>

<style scoped>
.page-dots {
  /* Under the status bar; the column pages reserve this strip (--page-dots-strip, board.css) */
  /* Fixed to the viewport, not the board: the Jetzt + Wartet page scrolls the document, and fixed keeps the dots put on all
     three pages. A page-coloured veil (like the app bar's, app-nav.css) keeps scrolled cards off the dots. Rendered before
     .board: in focus mode board-focus-overlay.css drops the z-index so the overlay dims the dots with the rest. */
  position: fixed;
  top: 0;
  inset-inline: 0;
  box-sizing: border-box;
  height: calc(env(safe-area-inset-top, 0px) + var(--page-dots-strip));
  padding-top: env(safe-area-inset-top, 0px);
  background: linear-gradient(var(--ui-page-bg) 70%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  pointer-events: none;
  z-index: 5;
}
.page-dot {
  --w: 0;
  height: 0.375rem;
  width: calc(0.375rem + var(--w) * 0.875rem);
  border-radius: 9999px;
  background: color-mix(in oklab, var(--ui-text-muted) calc(var(--w) * 100%), var(--ui-border-accented));
  transition: width 320ms cubic-bezier(0.4, 0, 0.2, 1), background-color 320ms;
}
.page-dots--live .page-dot {
  transition: none;
}
@media (min-width: 768px) {
  .page-dots {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .page-dot {
    transition: none;
  }
}
</style>
