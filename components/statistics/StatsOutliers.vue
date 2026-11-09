<!--
@component StatsOutliers
@kind component
@category display
@description Q3 proof: the tasks of the last 4 weeks that overran their timebox most, each opening the task detail
@usage Open Q3 tile, under the patterns
@avoid Only the Q3 proof list on the Statistik page.
@responsibility
- List up to five completed tasks (title, planned vs. taken time) as buttons
- Emit `open` with the task id; the page owns the detail modal
-->
<template>
  <div>
    <h3 class="font-display tracking-display text-lg leading-(--lh-tight) text-highlighted">{{ t('statistics.outliers.heading') }}</h3>
    <EmptyNote v-if="outliers.length === 0" class="mt-3">{{ t('statistics.outliers.empty') }}</EmptyNote>
    <ul v-else class="mt-3 divide-y divide-default" data-testid="stats-outliers">
      <li v-for="outlier in outliers" :key="outlier.record.taskId">
        <button
          type="button"
          class="flex min-h-11 w-full flex-col gap-1 py-2.5 text-left hover:text-highlighted focus-ring md:flex-row md:items-baseline md:justify-between md:gap-6"
          @click="emit('open', outlier.record.taskId)"
        >
          <span class="min-w-0 truncate text-default" data-private>{{ outlier.record.title }}</span>
          <span class="shrink-0 text-sm text-muted tabular-nums">
            {{ t('statistics.outliers.detail', { planned: formatDuration(outlier.record.timeBoxSeconds, 'spaced'), spent: formatDuration(outlier.record.actualTimeSpentSeconds, 'spaced') }) }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyNote from '~/components/ui/EmptyNote.vue'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import type { Outlier } from '~/lib/statisticsReview'

defineOptions({ name: 'StatsOutliers' })

defineProps<{ outliers: Outlier[] }>()
const emit = defineEmits<{ open: [taskId: string] }>()
const { t } = useI18n()
const { formatDuration } = useLocaleFormat()
</script>
