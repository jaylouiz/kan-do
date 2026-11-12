<!--
@component SectionHeader
@kind primitive
@category layout
@description The one heading of the app below a page title (kd#180): five roles in a closed list, Fraunces for the first four, with the tag, the spacing below and the optional icon.
@usage <SectionHeader tag="h2" :text="…" /> (size `headline`, 22 px, the default: a section of a page or a dialog); `sub` (18 px) for a heading inside a section or a dialog; `display` (36 px) and `hero` (48 px, 36 on a phone) for the welcome and verdict lines; `label` (12 px, the sans, muted) for the caption of a field group in the task sheet. `tone="muted"` for a heading that must stay quiet (the day-close lists).
@avoid A page title is PageHeader (the column names and the wordmark keep their own CSS); a label on one control is its own `<label>`; never write `font-display` and a size class by hand.
@responsibility
- Render the heading element (`tag`, default `div`; pass `h2` / `h3` for a real heading) with the role's size, face, tracking and line height from the type tokens
- `id` links the heading with `aria-labelledby`
- The `label` role keeps its spacing below by tag (4, 3 or 2) unless the host sets its own `mb-*`; the other roles leave spacing to the host
-->
<template>
  <component
    :is="tag"
    :id="id"
    :class="[ROLE[size], size === 'label' ? (tag === 'h1' ? 'mb-4' : tag === 'h2' ? 'mb-3' : 'mb-2') : '', tone === 'muted' || size === 'label' ? 'text-muted' : 'text-highlighted']"
  >
    <UIcon v-if="icon" :name="icon" class="size-4" />
    <slot>{{ text }}</slot>
  </component>
</template>

<script setup lang="ts">
defineOptions({ name: 'SectionHeader' })

withDefaults(defineProps<{
  /** The role: hero 48 px (36 on a phone), display 36, headline 22, sub 18, label 12 */
  size?: 'hero' | 'display' | 'headline' | 'sub' | 'label'
  /** Icon name to display before the text (label role) */
  icon?: string
  /** Text content (alternative to the slot) */
  text?: string
  /** HTML tag to render */
  tag?: 'div' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p'
  /** ID for `aria-labelledby` */
  id?: string
  /** `muted` for a heading that stays quiet */
  tone?: 'default' | 'muted'
}>(), { size: 'headline', tone: 'default', tag: 'div', icon: undefined, text: undefined, id: undefined })

const FACE = 'font-display tracking-display'
const ROLE = {
  hero: `${FACE} text-display sm:text-5xl`,
  display: `${FACE} text-display`,
  headline: `${FACE} text-headline`,
  sub: `${FACE} text-lg`,
  label: 'flex items-center gap-2 text-xs font-medium',
} as const
</script>
