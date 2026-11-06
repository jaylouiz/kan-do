<!--
@component LocalSetupModal
@description Modal for setting up local mode without external integrations
@usage Used during initial setup when user chooses to work locally
@responsibility
- Explains local mode benefits
- Offers choice to start fresh or with sample tasks
- Emits complete event to trigger navigation
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="t('onboarding.local.title')"
    :ui="{ content: MODAL_WIDTH.md }"
  >
    <template #body>
      <div class="flex flex-col gap-6 p-6">
        <div class="flex items-start gap-4">
          <div class="flex size-12  shrink-0 items-center justify-center rounded-full bg-primary/10">
            <UIcon name="i-ph-desktop" class="size-6  text-primary" />
          </div>
          <div>
            <p class="text-base text-default">
              {{ t('onboarding.local.intro') }}
            </p>
            <p class="mt-2 text-sm text-muted">
              {{ t('onboarding.local.later') }}
            </p>
          </div>
        </div>

        <USeparator />

        <div class="flex flex-col gap-3">
          <p class="text-sm font-medium text-default">{{ t('onboarding.local.howToStart') }}</p>
          
          <UButton
            block
            size="lg"
            color="primary"
            @click="startFresh"
          >
            <UIcon name="i-ph-plus-circle" class="size-5 " />
            {{ t('onboarding.local.startFresh') }}
          </UButton>
          
          <UButton
            block
            color="neutral"
            variant="soft"
            @click="startWithSamples"
          >
            <UIcon name="i-ph-sparkle" class="size-5 " />
            {{ t('onboarding.local.startSamples') }}
          </UButton>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="soft" @click="closeModal">
        {{ t('common.cancel') }}
      </UButton>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { MODAL_WIDTH } from '~/utils/modalSizes'
import { useI18n } from 'vue-i18n';
import { useTasksStore } from '~/store/tasks';
import { buildDemoBoard } from '~/lib/demo-board';
import { useTopicStylesStore } from '~/store/topicStyles';

defineOptions({ name: 'LocalSetupModal' });

const isOpen = defineModel<boolean>('open');

const emit = defineEmits<{
  (e: 'complete', withSamples: boolean): void;
}>();

const { t } = useI18n();
const tasksStore = useTasksStore();

/**
 * Start with an empty board
 */
const startFresh = () => {
  tasksStore.setTasks([]);
  emit('complete', false);
};

/**
 * Start with sample tasks for demonstration
 */
const startWithSamples = () => {
  // The shared demo board (#527): tasks, carried-over counters and topic colours/symbols
  const demo = buildDemoBoard();
  tasksStore.setTasks(demo.tasks);
  tasksStore.setCarryOver(demo.carryOverByTaskId);
  const topicStyles = useTopicStylesStore();
  for (const [name, style] of Object.entries(demo.topicStyles)) topicStyles.setStyle(name, style);
  emit('complete', true);
};

const closeModal = () => {
  isOpen.value = false;
};
</script>
