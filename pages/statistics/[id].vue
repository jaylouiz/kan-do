<!--
@component StatisticsTaskDetailPage
@description Detail route /statistics/:id: a task opened from the statistics page, in the same task sheet as on the board (kd#179)
@usage Child page of StatisticsPage; the body is the shared TaskSheetDetail
@responsibility
- Opens the sheet over the statistics page for one task; closing returns to /statistics
-->
<template>
  <TaskSheetDetail />
</template>

<script setup lang="ts">
import TaskSheetDetail from '~/components/task/TaskSheetDetail.vue';

definePageMeta({
  // The statistics page stays where it is under the sheet
  scrollToTop: false,
});
</script>
