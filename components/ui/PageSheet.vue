<!--
@component PageSheet
@kind primitive
@category layout
@description The white sheet a page is made of (kd#180): one surface shape for a settings section, a statistics tile, the trash header and the welcome page, with the card's 16 px radius and its resting shadow on the paper canvas.
@usage <PageSheet tag="section" aria-labelledby="x"><SectionHeader …/>…</PageSheet>; a page is a column of sheets on the canvas, a list inside a sheet is a `ListRow` list with hairlines. `tag` picks the element (`section` for a named region, `details` for a disclosure, `div` otherwise); attributes (`aria-labelledby`, `data-testid`, `class` for layout only) land on it.
@avoid Never a sheet on a sheet (a `TaskCard` is a sheet already: the trash lists cards on the canvas, never in a PageSheet); not a card (TaskCard, UCard) and not an overlay (AppDialog, TaskSheet).
@responsibility
- Draw the surface: `bg-default`, `rounded-lg` (16 px, the card's radius), `shadow-(--shadow-task)` (the resting shadow of the cards), one padding step (24 px, 32 px from `md`)
- Own nothing else: no heading, no state; the content brings its own SectionHeader
- The shadow stays on the sheet alone (The Sheets Cast Shadows Rule, DESIGN.md "Elevation"); a control inside never casts one
-->
<template>
  <component :is="tag" class="rounded-lg bg-default p-6 shadow-(--shadow-task) md:p-8">
    <slot />
  </component>
</template>

<script setup lang="ts">
defineOptions({ name: 'PageSheet' })

withDefaults(defineProps<{
  /** The element: `section` for a named region (with `aria-labelledby`), `details` for a disclosure, `div` otherwise */
  tag?: 'section' | 'div' | 'details'
}>(), { tag: 'div' })
</script>
