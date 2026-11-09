<!--
@component SetupRail
@kind component
@category navigation
@description Guide rail of a multi-step setup on a page (#43): a vertical rail with one-line help at md and up, a label
  plus "n / m" and a progress bar below md. Non-interactive: the steps validate in order.
@usage <SetupRail :steps="[{ key, label }]" :current="2" :help="text" :label="t('notion.modal.stepsLabel')" />
@avoid Progress of a multi-step setup page; not a tab bar and not interactive.
@responsibility
- Shows done, current and todo steps (state in data-state, aria-current on the current one, a screen-reader "done" on finished ones)
- Pattern: step progress, new (guide rail). Replaces the dialog stepper of the Notion modal for the welcome page only
- Reduced motion: dot, line and bar changes are instant
-->
<template>
  <div>
    <!-- Below md: label, n / m and a bar -->
    <div class="flex flex-col gap-2 md:hidden" data-testid="setup-progress">
      <div class="flex items-baseline justify-between text-sm">
        <span class="font-medium text-highlighted">{{ steps[current]?.label }}</span>
        <span class="text-muted">{{ current + 1 }} / {{ steps.length }}</span>
      </div>
      <div
        class="h-1 overflow-hidden rounded-full bg-accented"
        role="progressbar"
        :aria-label="label"
        :aria-valuemin="1"
        :aria-valuemax="steps.length"
        :aria-valuenow="current + 1"
      >
        <div
          class="h-full rounded-full bg-inverted transition-[width] duration-300 ease-out motion-reduce:transition-none"
          :style="{ width: `${((current + 1) / steps.length) * 100}%` }"
        />
      </div>
    </div>

    <!-- From md: the rail with the help text under it -->
    <div class="hidden md:block">
      <ol :aria-label="label" data-testid="notion-setup-steps" class="flex flex-col gap-5">
        <li
          v-for="(step, index) in steps"
          :key="step.key"
          class="setup-rail-item relative flex items-center gap-3"
          :aria-current="index === current ? 'step' : undefined"
          :data-state="index < current ? 'done' : index === current ? 'active' : 'todo'"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none"
            :class="index <= current ? 'bg-inverted text-inverted' : 'bg-accented text-muted'"
            aria-hidden="true"
          >
            <UIcon v-if="index < current" name="i-ph-check-bold" class="size-3.5" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="text-sm" :class="index === current ? 'font-semibold text-highlighted' : index < current ? 'text-default' : 'text-muted'">
            {{ step.label }}
            <span v-if="index < current" class="sr-only">{{ doneLabel }}</span>
          </span>
        </li>
      </ol>
      <p v-if="help" class="mt-6 border-t border-default pt-4 text-sm text-muted" aria-live="polite">{{ help }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'SetupRail' });

defineProps<{
  steps: { key: string; label: string }[];
  /** Zero-based index of the current step */
  current: number;
  help?: string;
  label: string;
  doneLabel: string;
}>();
</script>

<style scoped>
/* The line between two dots; the current item's line takes the "done" colour once it is passed */
.setup-rail-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 0.6875rem;
  top: 1.75rem;
  width: 2px;
  height: 1.25rem;
  background: var(--ui-bg-accented);
  transition: background-color 0.3s;
}
.setup-rail-item[data-state='done']:not(:last-child)::after {
  background: var(--ui-bg-inverted);
}
@media (prefers-reduced-motion: reduce) {
  .setup-rail-item::after {
    transition: none;
  }
}
</style>
