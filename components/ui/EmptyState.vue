<!--
@component EmptyState
@kind component
@category feedback
@description The empty state of a page or tab panel whose main content is a list that fills with use (kd#106): a calm line icon, the sentence "Noch keine X." and a subline that says how it fills.
@usage <EmptyState icon="i-ph-trash-light" :subline="t('trash.emptyHint')" data-testid="trash-empty-state">{{ t('trash.empty') }}</EmptyState>; spacing around it comes from the call site.
@avoid Not inside a tile, dialog, popover, menu, wizard step or a section among other sections, and not for a search or filter without a result: those keep the one sentence (EmptyNote). Never on the task board, where empty columns stay blank. Not for an error (UAlert). A chart's empty state shows the chart's own empty outline instead of an icon (StatsVerdict, StatsRhythmBars).
@responsibility
- Own the layout so every surface looks the same: icon, sentence, subline in one left-aligned stack on the page's reading axis (never centred: the pages are one flat column)
- The graphic is one Phosphor icon in the `light` weight at 40 px (`size-10`), `text-dimmed`: at that size the light stroke matches the 16 px regular icons beside text; it is decorative (`aria-hidden`), never a tile, a fill or a status colour; `-ml-1` takes back the glyph box's own inset so the drawing starts on the text edge
- The sentence is body text (`text-default`, regular weight: a sentence, not a heading); the subline is `text-sm text-muted`, capped at `max-w-md`. Same sizes at 390 and 1280
- The subline says what will appear or how it fills, never restates the sentence; a surface with nothing useful to say passes none
- No action of its own; attributes (testid) land on the root
-->
<template>
  <div class="flex flex-col items-start gap-3">
    <UIcon :name="icon" class="-ml-1 size-10 text-dimmed" aria-hidden="true" />
    <div class="space-y-1">
      <p class="text-default" data-testid="empty-state-sentence"><slot /></p>
      <p v-if="subline" class="max-w-md text-sm text-pretty text-muted" data-testid="empty-state-subline">{{ subline }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'EmptyState' });

interface Props {
  /** A Phosphor icon in the light weight (`i-ph-*-light`). */
  icon: `i-ph-${string}`
  /** What will appear here or how it fills; omit when there is nothing useful to say. */
  subline?: string
}

withDefaults(defineProps<Props>(), { subline: undefined });
</script>
