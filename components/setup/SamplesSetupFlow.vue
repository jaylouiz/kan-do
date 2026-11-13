<!--
@component SamplesSetupFlow
@kind block
@category input
@description The sample start as page content inside the welcome sheet (#236): step 2 of "Mit Beispielaufgaben", says how to leave the trial, then opens the filled board
@usage <SamplesSetupFlow @back="flow = null" @complete="onLocalDone" /> inside pages/welcome.vue
@avoid Only the sample start on the welcome page; an empty local board is LocalSetupFlow.
@responsibility
- Heading, a short line on what the board holds, and a note card with the way out: a reset under Einstellungen › Daten & Speicher removes the samples and the statistics collected meanwhile (the sample board stores none itself, a finished sample task does)
- "Board ansehen" is the one primary action: stores the shared demo board (#527: tasks, carried-over counters, topic colours and symbols), then emits `complete`
- Back returns to the choice: the shared `BackButton` ("Zurück zur Auswahl")
- Pattern: first-run setup, aligned with LocalSetupFlow; the note is a muted bordered card (no card in a card: it stands on the sheet)
-->
<template>
  <section class="flex flex-col gap-6" data-testid="samples-setup-flow" :aria-label="t('onboarding.flow.samples.label')">
    <BackButton :label="t('onboarding.flow.backToChoice')" @click="emit('back')" />
    <div>
      <SectionHeader ref="headingRef" tag="h2" size="display" tabindex="-1" class="text-balance outline-none">
        {{ t('onboarding.flow.samples.title') }}
      </SectionHeader>
      <p class="mt-2 text-body text-default">{{ t('onboarding.flow.samples.intro') }}</p>
    </div>
    <div class="flex gap-3 rounded-md border border-default bg-elevated p-4" data-testid="samples-reset-note">
      <UIcon name="i-ph-arrow-counter-clockwise" class="mt-0.5 size-5 shrink-0 text-toned" aria-hidden="true" />
      <p class="text-body text-default">{{ t('onboarding.flow.samples.resetNote') }}</p>
    </div>
    <UButton color="primary" size="lg" block data-testid="samples-confirm" @click="confirm">
      {{ t('onboarding.flow.samples.confirm') }}
    </UButton>
  </section>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { ref } from 'vue';
import BackButton from '~/components/ui/BackButton.vue';
import { useI18n } from 'vue-i18n';
import { useTasksStore } from '~/store/tasks';
import { useTopicStylesStore } from '~/store/topicStyles';
import { buildDemoBoard } from '~/lib/demo-board';

defineOptions({ name: 'SamplesSetupFlow' });

const emit = defineEmits<{ (e: 'back' | 'complete'): void }>();

const { t } = useI18n();
const tasksStore = useTasksStore();
const headingRef = ref<{ $el: HTMLElement } | null>(null);

defineExpose({ focusHeading: () => headingRef.value?.$el.focus({ preventScroll: true }) });

function confirm() {
  // The shared demo board (#527): tasks, carried-over counters and topic colours and symbols
  const demo = buildDemoBoard();
  tasksStore.setTasks(demo.tasks);
  tasksStore.setCarryOver(demo.carryOverByTaskId);
  const topicStyles = useTopicStylesStore();
  for (const [name, style] of Object.entries(demo.topicStyles)) topicStyles.setStyle(name, style);
  emit('complete');
}
</script>
