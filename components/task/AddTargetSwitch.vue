<!--
@component AddTargetSwitch
@kind component
@category input
@description The quiet "Speichern in" line in the add sheet's footer: picks the source a new task is saved to (#321)
@usage Registered as the footer `lead` by pages/tasks/add.vue; only shown with 2+ available sources
@avoid Only the add sheet's footer, and only with 2+ available sources.
@responsibility
- Muted label + value-as-text picker (property-select grammar, no box or fill); the label is aria-hidden, the trigger is announced once as "Speichern in: Notion"
- Lists Lokal and every connected source; the default carries "Standard", a source needing attention stays selectable with a heads-up (not an error)
- Locked while the save runs, enabled again after a failed save with the chosen target kept
- Opens upward: the line sits at the bottom of the sheet
-->
<template>
  <div v-if="isSwitchVisible" class="flex items-center gap-3" data-testid="add-target-switch">
    <span class="text-xs font-medium text-muted" aria-hidden="true">{{ t('task.form.saveIn') }}</span>
    <TaskPropertySelect
      :label="t('task.form.saveIn')"
      :model-value="targetSource"
      :items="items"
      value-key="value"
      side="top"
      align="start"
      :disabled="isSaving"
      :picker-ui="{ content: 'min-w-64 max-w-xs', itemDescription: 'whitespace-normal' }"
      data-testid="add-target-select"
      @update:model-value="(value) => setTarget(value as SourceId)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SelectMenuItem } from '@nuxt/ui';
import TaskPropertySelect from '~/components/task/TaskPropertySelect.vue';
import { useAddTarget } from '~/composables/useAddTarget';
import type { SourceId } from '~/types/taskSource';

defineOptions({ name: 'AddTargetSwitch' });

const { t } = useI18n();
const { availableSources, defaultSource, targetSource, isSwitchVisible, isSaving, setTarget, needsAttention } = useAddTarget();

const items = computed<SelectMenuItem[]>(() =>
  availableSources.value.map((source) => {
    const captions = [
      source === defaultSource.value ? t('task.form.saveInDefault') : '',
      needsAttention(source) ? t('task.form.saveInAttention') : '',
    ].filter(Boolean);
    return {
      label: t(`source.name.${source}`),
      value: source,
      ...(captions.length > 0 ? { description: captions.join(' · ') } : {}),
    };
  }),
);
</script>
