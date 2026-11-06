<!--
@component IndexRedirect
@description Leitet die Startseite auf /tasks weiter
@usage Einstiegspunkt unter /
@responsibility
- Clientseitige Weiterleitung zu /tasks
-->
<template>
  <div />
 </template>

<script setup lang="ts">
// No app bar here (#470): first run, developer pages and the empty redirect page
definePageMeta({ appNav: false })
/**
 * Führt die clientseitige Navigation zu /tasks aus.
 */
async function initializeIndexRedirect() {
  if (import.meta.server) return; // SSR Guard
  await navigateTo("/tasks");
}

onMounted(initializeIndexRedirect);
</script>

<style scoped lang="css"></style>
