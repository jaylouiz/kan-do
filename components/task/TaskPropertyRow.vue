<!--
@component TaskPropertyRow
@kind primitive
@category input
@description One labelled property row of the task sheet: quiet label left, value right
@usage Detail (TaskDetailContent, TaskDetailCustomFields) and add (TaskForm) share this row, so each property is learned once
@avoid Only labelled property rows of the task sheet; a section title is SectionHeader.
@responsibility
- Fixed label column (Label role, text-muted) so values line up across rows
- Value slot receives `labelId`, so the value control can be named by its label
- 44px hit area at <=767px; no icon, divider or box (space separates groups)
- `private` marks the value (not the label) `data-private`: hidden during a feedback screenshot (#247)
-->
<template>
  <div class="flex items-start gap-3" data-testid="task-property-row">
    <span
      :id="labelId"
      class="flex min-h-8 w-22 shrink-0 items-center text-xs font-medium text-muted max-md:min-h-11"
    >
      {{ label }}
    </span>
    <div class="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-4 max-md:min-h-11" :data-private="isPrivate ? '' : undefined">
      <slot :label-id="labelId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';

defineOptions({ name: 'TaskPropertyRow' });

const props = defineProps<{
  /** Visible property name (also the accessible name prefix of the value control) */
  label: string;
  /** The value is task content (topic, activity, custom property): masked in a feedback screenshot */
  private?: boolean;
}>();

const isPrivate = computed(() => props.private === true);

defineSlots<{
  default(props: { labelId: string }): unknown;
}>();

const labelId = useId();
</script>
