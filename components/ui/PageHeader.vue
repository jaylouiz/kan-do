<!--
@component PageHeader
@description Reusable header for settings-style pages with title, description and optional actions; scrolls away with the page (#615)
@usage Used in the sub-page layout for the settings sub-pages (/settings/*); not on /settings, /trash and /statistics (`pageHeader: false`, #670, #686): the app bar names those, the layout renders the title as a screen-reader-only h1
@responsibility
- Provide consistent header styling across settings/detail pages
- No back arrow (#470): a page is left through the app bar (Heute, Statistik) or ⋯ -> Einstellungen
- Not sticky (#615): it scrolls away with the page and the app bar alone stays, so the page gets the room. It sits in
  the flow below the desktop bar row; on a phone the bar is at the bottom and the header is the first thing on the page
  (its `pt-safe` is the only safe-area-top cover a sub-page has: it scrolls away, and `env(safe-area-inset-top)` is 0 outside a
  standalone install, which kan-do is not (#631); revisit with a standalone PWA)
- `bg-page` surface, same as the page it sits on. A sticky element below it (.sticky-below-page-header) sticks under the
  app bar, not under this header
- Support page-specific actions via slot
- `narrow`: the title and actions sit in the same 672 px column as the content below (sub-page layout, `pageWidth: 'narrow'`, #673)
-->
<template>
  <header class="page-header pt-safe px-safe bg-page">
    <div class="mx-auto max-w-5xl px-4 py-6">
      <div class="flex items-center justify-between" :class="{ 'mx-auto max-w-2xl': narrow }">
        <div>
          <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>
          <p v-if="description" class="mt-0.5 text-sm text-muted">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="flex items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
defineOptions({ name: 'PageHeader' });

interface Props {
  /** Page title displayed in the header */
  title: string;
  /** Optional description/subtitle below the title */
  description?: string;
  /** Sit in the 672 px column of a narrow sub-page instead of the full container */
  narrow?: boolean;
}

withDefaults(defineProps<Props>(), {
  description: undefined,
  narrow: false,
});
</script>
