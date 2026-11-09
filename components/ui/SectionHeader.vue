<!--
@component SectionHeader
@kind primitive
@category layout
@description Reusable section header with optional icon and configurable HTML tag
@usage Used for section titles throughout the application
@avoid Only a section title; a page title is PageHeader.
@responsibility
- Display section titles with consistent styling
- Support optional icons
- Allow semantic HTML tag selection
-->

<template>
  <component
    :is="tag"
    :id="id"
    class="flex items-center gap-2 text-xs font-medium text-muted"
    :class="[
      tag === 'h1' ? 'mb-4' : tag === 'h2' ? 'mb-3' : 'mb-2',
      $attrs.class
    ]"
  >
    <UIcon v-if="icon" :name="icon" class="size-4 " />
    <slot>{{ text }}</slot>
  </component>
</template>

<script setup lang="ts">
defineOptions({ name: 'SectionHeader' });

/**
 * Props
 */
const props = withDefaults(defineProps<{
  /** Icon name to display before the text */
  icon?: string;
  /** Text content (alternative to using slot) */
  text?: string;
  /** HTML tag to render (default: div) */
  tag?: 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  /** ID for accessibility (links with aria-labelledby) */
  id?: string;
}>(), {
  tag: 'div',
  icon: undefined,
  text: undefined,
  id: undefined
});

// Props is used by the template via Vue's reactivity system
 
const _ = props; // Mark as used to satisfy linter
</script>
