<!--
@component EmptyNote
@kind primitive
@category feedback
@description The one-sentence empty state: a muted line ("Noch keine X.") for a list, table or panel that fills with use.
@usage <EmptyNote data-testid="trash-empty-state">{{ t('trash.empty') }}</EmptyNote>; spacing comes from the call site's `class`.
@avoid Not for a page or tab panel whose main content is the empty list (EmptyState: icon, sentence, subline, kd#106). Not for a search or filter without a result beyond the sentence "Keine X gefunden.", not for an error (UAlert) and never for an empty board column, which stays blank.
@responsibility
- Render the sentence as muted small text, nothing else: no icon, no heading, no action (docs/copy/voice.md "Empty states": "Noch keine X.")
- Pass attributes (testid, role) and the call site's spacing class through to the paragraph
- Where (moved from DESIGN.md, D1 on kd#68): one muted sentence for an empty tile, dialog, popover, menu, wizard step or a section among other sections; on the task board one muted sentence at most, and empty columns stay blank. A page or tab whose main content is a list that fills with use takes `EmptyState`
-->
<template>
  <p class="text-sm text-muted">
    <slot />
  </p>
</template>

<script setup lang="ts">
defineOptions({ name: 'EmptyNote' });
</script>
