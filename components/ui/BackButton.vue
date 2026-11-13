<!--
@component BackButton
@kind component
@category navigation
@description The one control to step back inside a flow or to the parent of a deeper route (#236): a ghost button with a left arrow and "Zurück zu <where>"
@usage <BackButton :label="t('onboarding.flow.backToChoice')" @click="emit('back')" /> for a step inside a flow; <BackButton :label="t('common.backToSettings')" to="/settings?tab=manage" /> for a deeper route (the sub-page layout renders it on every `/settings/*` page)
@avoid Not for leaving a page through the app bar (Heute, Statistik, ⋯): the bar stays the way between pages, /settings, /trash and /statistics have no back control. Not a "close" (a dialog has its X) and not a step arrow in a deck or a column (`ICONS.back` caret).
@responsibility
- A `UButton` ghost, neutral, `ICONS.stepBack` arrow before the label, left-aligned (`self-start`), at least 44 px high (touch target), pulled 8 px left so the label lines up with the content edge
- Without `to` it emits `click` (the host moves the step); with `to` it is a link to that route
- One test id for every back control (`setup-back`)
- Pattern: step back in a flow or deeper route, aligned with the earlier text "Zur Auswahl" buttons of the setup flows (now with the arrow); diverged from DESIGN.md "no back arrow anywhere" by the owner's decision (D1 of #236, 2026-11-13)
-->
<template>
  <UButton
    color="neutral"
    variant="ghost"
    :icon="ICONS.stepBack"
    :to="to"
    class="-ml-2 min-h-11 self-start"
    data-testid="setup-back"
    @click="emit('click')"
  >
    {{ label }}
  </UButton>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons';

defineOptions({ name: 'BackButton' });

defineProps<{
  /** "Zurück zur Auswahl", "Zurück zu Einstellungen": names where the step leads */
  label: string;
  /** A route to lead to; leave out for a step inside a flow (then the click is emitted) */
  to?: string;
}>();

const emit = defineEmits<{ (e: 'click'): void }>();
</script>
