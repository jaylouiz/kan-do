<!--
@component SourcesRedirectPage
@description `/settings/sources` was the "Aufgaben-Quellen" page; it now lives in "Einstellungen" at `/settings` (#394).
@usage Old links, bookmarks and desktop windows that still point here
@responsibility
- Redirect to `/settings?tab=sources` (the tab that holds the sources, #691) through the route record, so it works on a cold load and on in-app navigation alike,
  also in the static (`nuxt generate`) build where the router answers on the client
-->
<template>
  <div />
</template>

<script setup lang="ts">
defineOptions({ name: 'SourcesRedirectPage' })

definePageMeta({
  layout: false,
  redirect: '/settings?tab=sources',
})
</script>
