<!--
@component MiddleEllipsis
@kind primitive
@category display
@description One line of a user-given option name (a topic, an activity, a list value) that is shortened in the middle when it does not fit, so names that share a beginning or an ending stay apart: "Karriere: Bewerbung" and "Karriere: Weiterbildung" read "Karr…rbung" and "Karr…ldung", "Kunde Müller: Angebot" reads "Kun…Angebot" (kd#119).
@usage <MiddleEllipsis :text="name" data-private /> inside a flex row or a pill that may shrink it (it has `min-width: 0`); attributes and classes land on the root span. The answer pills and list rows of the new-card flow, the stack pill and the topic lists use it.
@avoid Not for running text or a title that may wrap (line-clamp, as TaskCard's title), not for a path in a sentence (`middleEllipsis()` in utils/middleEllipsis.ts returns a string of a fixed length) and not where only the beginning matters (Tailwind `truncate`).
@responsibility
- A name that fits is one plain text node, exactly what a `truncate` span renders (same kerning, same pixels); that is also the state before the script runs, with the ellipsis at the end
- A name that does not fit (measured: on mount, when the element's width changes (ResizeObserver: 390 px, desktop, a resized window), when the text changes and once the fonts are in) is drawn as a head and a short tail (`splitMiddle`, utils/middleEllipsis.ts: the last word when it has 3 to 7 graphemes, else the last 5 graphemes; at most half the name, never inside an emoji or a letter with its mark). The head is shortened by CSS `text-overflow: ellipsis`, the tail always shows, so the cut itself follows the width without any text measuring or character counting
- While cut, the name is in the DOM once, as visually hidden text: that is what a screen reader, the accessible name of a surrounding button, `textContent` and the page search get. The two visible halves are generated content of `aria-hidden` spans, so no reader hears "Karriere: Weiterbi" and "ldung" as two words; `title` carries the full name for a pointer (none while the name fits)
- `data-private` from the host masks both halves in a feedback screenshot (the mask colours the element and everything in it)
- Accepted: the ellipsis sits before the last word or the last 5 characters, not at the exact centre, and a last word of more than 7 characters is cut inside the word ("Karr…rbung": the flow's desktop pill holds about 11 characters); a box narrower than the tail clips it at the end (the flow's pills never get that narrow: 7ch minimum); the room a dropped character leaves shows as a small gap after the ellipsis
-->
<template>
  <span ref="rootEl" class="middle-ellipsis" :class="{ 'is-cut': cut }" :title="cut ? text : undefined">
    <template v-if="cut">
      <span ref="fullEl" class="sr-only">{{ text }}</span>
      <span class="middle-ellipsis__head" aria-hidden="true" :data-text="parts.head" />
      <span v-if="parts.tail" class="middle-ellipsis__tail" aria-hidden="true" :data-text="parts.tail" />
    </template>
    <template v-else>{{ text }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { splitMiddle } from '~/utils/middleEllipsis';

defineOptions({ name: 'MiddleEllipsis' });

const props = defineProps<{
  /** The full name; shown whole while it fits */
  text: string;
}>();

const rootEl = ref<HTMLElement | null>(null);
const fullEl = ref<HTMLElement | null>(null);
/** The name does not fit its box: draw head, ellipsis and tail */
const cut = ref(false);
const parts = computed(() => splitMiddle(props.text));

/** Whether the whole name is wider than the box: read from the plain text while it shows, from the hidden full name while cut (no switching back and forth to find out) */
function measure() {
  const root = rootEl.value;
  if (!root) return;
  const full = cut.value ? fullEl.value?.scrollWidth : root.scrollWidth;
  if (full !== undefined) cut.value = full > root.clientWidth;
}

let observer: ResizeObserver | undefined;

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    observer = new ResizeObserver(measure);
    observer.observe(rootEl.value);
  }
  // A web font that arrives later changes the name's width, not the box
  void document.fonts?.ready.then(measure);
});

watch(() => props.text, () => void nextTick(measure));

onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
/* Fits: what Tailwind `truncate` gives a span (the fallback cut is at the end) */
.middle-ellipsis {
  /* relative: the visually hidden name is positioned inside it, not somewhere up the tree */
  position: relative;
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.middle-ellipsis.is-cut {
  display: flex;
  /* pre: a space at the cut ("Kunde A: " + "Büro") must not collapse */
  white-space: pre;
}

.middle-ellipsis__head {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.middle-ellipsis__tail {
  flex: none;
}

.middle-ellipsis__head::before,
.middle-ellipsis__tail::before {
  content: attr(data-text);
}
</style>
