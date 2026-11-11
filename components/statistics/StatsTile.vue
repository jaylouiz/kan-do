<!--
@component StatsTile
@kind compound
@category display
@description Disclosure tile of the Statistik page: a question as heading, one line and a mini chart; it expands in place to its full panel
@usage Q2 to Q4 and the work-rhythm tile (5) in StatsTiles
@avoid Only the disclosure tiles of the Statistik page; a one-question verdict that stays open is StatsVerdict.
@responsibility
- Heading `<h2>` holding one toggle `<button aria-expanded aria-controls>`; Enter / Space toggles, Esc closes an open tile
- Grouped surface by `tone` (semantic tokens only), full width of the grid when open; a `wide` tile is always full width and, closed at `md+`, puts its line left and its chart right (about 20rem, #600)
- Summary slot is always shown, the `detail` slot only while open (`v-if`, so a closed tile has no tab stops in its panel)
- Without `toggleable` (no timeboxes at all) the heading is plain text and there is no panel
- Expose `focus()` so the grid can restore focus after it reorders the tiles in the DOM
- Disclosure tile (moved from DESIGN.md, kd#176): the open tile moves first in the DOM at `md+` (never CSS `order`, which breaks reading and focus order), the DOM order stays natural below `md`; closed panels have no tab stops; the toggle row is at least 44px; reduced motion removes any motion. No tile carries a step label
-->
<template>
  <section
    :aria-labelledby="headingId"
    class="rounded-3xl p-6 md:p-7"
    :class="[tone === 'elevated' ? 'bg-elevated ring ring-default' : 'bg-default shadow-(--shadow-task)', open ? 'md:col-span-3 md:p-10' : wide ? 'md:col-span-3' : '']"
    :data-testid="`stats-tile-${n}`"
  >
    <h2 :id="headingId" class="m-0">
      <button
        v-if="toggleable"
        ref="button"
        type="button"
        class="group flex min-h-11 w-full items-start justify-between gap-4 text-left focus-ring"
        :aria-expanded="open"
        :aria-controls="panelId"
        :data-testid="`stats-tile-${n}-toggle`"
        @click="emit('toggle')"
        @keydown.esc="open && emit('toggle')"
      >
        <span class="font-display block text-headline text-highlighted">{{ question }}</span>
        <span class="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-toned group-hover:text-highlighted" aria-hidden="true">
          <UIcon :name="open ? ICONS.close : 'i-ph-arrows-out-simple'" class="size-4" />
        </span>
      </button>
      <span v-else class="font-display block text-headline text-highlighted">{{ question }}</span>
    </h2>
    <div :class="wide && !open ? 'md:flex md:items-center md:justify-between md:gap-10' : ''">
      <div :class="wide && !open ? 'md:flex-1' : ''">
        <p class="mt-3 text-pretty text-default" data-private>{{ line }}</p>
        <slot name="under-line" />
      </div>
      <!-- A wide tile's chart is replaced by its panel while open: no empty spacer -->
      <div v-if="!(wide && open)" class="mt-5" :class="wide ? 'md:mt-3 md:w-80 md:shrink-0' : ''">
        <slot />
      </div>
    </div>

    <div v-if="toggleable && open" :id="panelId" class="mt-8 border-t border-default pt-6">
      <slot name="detail" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { ref, useId } from 'vue'

defineOptions({ name: 'StatsTile' })

withDefaults(defineProps<{
  /** Position among the tiles (1 is the verdict; 5 is the work-rhythm tile, #600); names the test ids. */
  n: 2 | 3 | 4 | 5
  question: string
  /** The one-sentence answer under the heading. */
  line: string
  open: boolean
  tone?: 'default' | 'elevated'
  toggleable?: boolean
  /** Full width of the grid also while closed, line left and chart right at `md+`. */
  wide?: boolean
}>(), { tone: 'default', toggleable: true, wide: false })

const emit = defineEmits<{ toggle: [] }>()

const uid = useId()
const headingId = `stats-q-${uid}`
const panelId = `stats-panel-${uid}`
const button = ref<HTMLButtonElement | null>(null)

defineExpose({ focus: () => button.value?.focus({ preventScroll: true }) })
</script>
