<!--
@component StatisticsPage
@description Statistik (#469): a review of how work is going, answered in the user's questions and against their own last 4 weeks
@usage Accessible via /statistics route; a task opens as /statistics/:id in the shared task sheet
@responsibility
- Compose the verdict (Q1, always open), the three question tiles (Q2 to Q4, open in place), the work-rhythm tile (#600) and the list of all completed tasks
- No period filter: the windows are fixed (7 days against the 4 weeks before, 8 weekly points); `?timeFrame=` / `?section=` links are ignored
- No visible page header (#686, reverses #670 D1 for this page): the app bar's second segment reads "Statistik"; the layout keeps the title as an sr-only h1 and the verdict card starts at the same top offset as /settings and /trash
- The drill-down opens the task sheet of the board through the child route `/statistics/:id` (`TaskSheetHost`, kd#179); this page stays mounted under it. No sync button of its own (#670): ⋯ -> "Jetzt synchronisieren" syncs, the same sync also runs the archive backfill (`useManualSync`), which otherwise runs by itself daily (`plugins/statistics-backfill.client.ts`)
-->

<template>
  <div data-task-sheet-return>
    <NuxtLayout name="sub-page">
      <div class="space-y-4 md:space-y-6">
        <StatsVerdict :review="review" />

        <StatsTiles :review="review" :unfinished="unfinished" :rhythm="rhythm" :initial-open="initialOpen" @open-task="openTask" />

        <details
          v-if="records.length > 0"
          class="group rounded-3xl bg-default p-6 shadow-(--shadow-task) md:px-10 md:py-6"
          data-testid="stats-all-tasks"
          @toggle="listOpened = true"
        >
          <summary class="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-default focus-ring">
            {{ t('statistics.allTasks', { n: records.length }) }}
            <UIcon name="i-ph-caret-down" class="size-4 shrink-0 text-muted group-open:rotate-180" aria-hidden="true" />
          </summary>
          <TasksTable v-if="listOpened" class="mt-4" :tasks="records" :show-completed-date="true" @row-click="handleTaskClick" />
        </details>
      </div>

      <!-- A task opens in the board's sheet: the child route /statistics/:id (kd#179) -->
      <TaskSheetHost>
        <NuxtPage />
      </TaskSheetHost>
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TaskCompletionRecord } from '@/store/taskStatistics';
import { useStatisticsReview } from '~/composables/useStatisticsReview';
import TasksTable from '~/components/statistics/TasksTable.vue';
import StatsVerdict from '~/components/statistics/StatsVerdict.vue';
import StatsTiles from '~/components/statistics/StatsTiles.vue';
import TaskSheetHost from '~/components/task/TaskSheetHost.vue';

const { t } = useI18n();

const { review, records, unfinished, rhythm } = useStatisticsReview();

/** Deep link `?open=2|3|4|5` opens a tile on first render (tests, screenshots); it is never written back. */
const initialOpen = Number(useRoute().query.open) || null;

/** The task list builds its table the first time the disclosure opens (months of history stay cheap). */
const listOpened = ref(false);

/** A task opens in the same sheet as on the board, through its child route; focus returns to the opener on close. */
const openTask = (taskId: string) => {
  void navigateTo({ path: `/statistics/${taskId}` });
};

/**
 * Handle task row click
 */
const handleTaskClick = (record: TaskCompletionRecord) => openTask(record.taskId);

// Set page metadata
useHead({
  title: () => t('statistics.headTitle'),
});

// Translated by the sub-page layout (definePageMeta runs at compile time, so it cannot call t())
definePageMeta({
  layout: false,
  titleKey: 'statistics.pageTitle',
  pageHeader: false, // the app bar's second segment reads "Statistik" (#686)
});
</script>
