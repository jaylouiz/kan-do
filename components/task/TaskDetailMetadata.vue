<!--
@component TaskDetailMetadata
@description Metadata section of the task detail (source, created, id), collapsed by default
@usage Used by TaskDetailContent; last in the flow on mobile, pinned to the bottom of the desktop slideover (#386)
@responsibility
- Quiet collapsible with the source, the creation date and the stable task id
- `pinned` adds the hairline above it and its padding, so it reads as the sheet footer (the notes sit above, in the scroll region)
- The open state is a v-model owned by the parent, so a resize that swaps pinned and in-flow keeps it
-->
<template>
  <section class="task-detail-section" :class="{ 'shrink-0 border-t border-default px-6 pt-4 pb-6': pinned }" data-testid="task-metadata">
    <UCollapsible v-model:open="open" class="w-full">
      <UButton
        variant="ghost"
        color="neutral"
        class="group/meta w-full justify-between px-0 hover:bg-transparent"
      >
        <SectionHeader :text="t('task.detail.metadata')" tag="h3" class="mb-0" />
        <template #trailing>
          <UIcon
            name="ph:caret-down"
            class="size-4  text-muted transition-transform duration-200"
            :class="{ 'rotate-180': open }"
          />
        </template>
      </UButton>

      <template #content>
        <div class="flex flex-wrap items-center gap-x-2 pt-3 text-xs text-muted">
          <span data-testid="task-detail-source">{{ source ?? t('task.detail.sourceLocal') }}</span>
          <span aria-hidden="true">•</span>
          <span>{{ t('task.detail.created', { date: createdAt }) }}</span>
          <span aria-hidden="true">•</span>
          <span class="select-all">{{ taskId }}</span>
        </div>
      </template>
    </UCollapsible>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import SectionHeader from '~/components/ui/SectionHeader.vue';

defineOptions({ name: 'TaskDetailMetadata' });

const { t } = useI18n();

withDefaults(defineProps<{
  /** Source label (e.g. "Notion"); null for a local task */
  source?: string | null;
  /** Creation date, already formatted for display */
  createdAt: string;
  /** Stable app-level task id */
  taskId: string;
  /** Bottom-pinned in the desktop slideover: hairline above, own padding */
  pinned?: boolean;
}>(), {
  source: null,
  pinned: false,
});

const open = defineModel<boolean>('open', { default: false });
</script>
