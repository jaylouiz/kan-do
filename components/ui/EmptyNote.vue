<!--
@component EmptyNote
@kind primitive
@category feedback
@description The one empty state: a muted one-sentence line ("Noch keine X.") for a list, table or panel that fills with use.
@usage <EmptyNote data-testid="trash-empty-state">{{ t('trash.empty') }}</EmptyNote>; spacing comes from the call site's `class`.
@avoid Not for a search or filter without a result beyond the sentence "Keine X gefunden.", not for an error (UAlert) and never for an empty board column, which stays blank.
@responsibility
- Render the sentence as muted small text, nothing else: no icon, no heading, no action (DESIGN.md "Voice and copy": "Noch keine X.")
- Pass attributes (testid, role) and the call site's spacing class through to the paragraph
-->
<template>
  <p class="text-sm text-muted">
    <slot />
  </p>
</template>

<script setup lang="ts">
defineOptions({ name: 'EmptyNote' });
</script>
