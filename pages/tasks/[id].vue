<!--
@component TaskDetailPage
@description Detail route /tasks/:id, shown in the task sheet of the board (TaskSheetHost)
@usage Child page of TasksPage; the body is the shared TaskSheetDetail
@responsibility
- Opens the sheet on the board for one task; the same body serves /statistics/:id
-->
<template>
  <TaskSheetDetail />
</template>

<script setup lang="ts">
import TaskSheetDetail from '~/components/task/TaskSheetDetail.vue';

definePageMeta({
  // Prevent scroll to top when opening the task sheet
  scrollToTop: false,
});
</script>
