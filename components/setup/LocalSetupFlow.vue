<!--
@component LocalSetupFlow
@kind block
@category input
@description The local setup as page content inside the welcome sheet (#43): pick an empty or a sample board, then confirm
@usage <LocalSetupFlow @back="flow = null" @complete="onLocalDone" /> inside pages/welcome.vue
@avoid Only the local setup on the welcome page; Notion is NotionSetupFlow.
@responsibility
- Explains that tasks stay on this device and other connections come later
- Two radio cards (empty board, sample board): `ChoiceCard`s with a `value` inside reka-ui's RadioGroup (the primitive under Nuxt UI's URadioGroup, whose card variant cannot carry the icon and the answer-row look): arrow keys select, one Tab stop (roving tabindex) and one "Los geht's" confirmation; nothing happens on the pick alone
- Seeds the task store (empty, or the shared demo board of #527 with carry-over and topic styles), then emits `complete`
- Back returns to the choice: a text button, no arrow (DESIGN.md "Chrome"; the welcome page has no app bar to lead back)
- Pattern: first-run setup, diverged from the modal wizard; the radio cards are the welcome page's answer rows (ChoiceCard)
-->
<template>
  <section class="flex flex-col gap-6" data-testid="local-setup-flow" :aria-label="t('onboarding.flow.local.label')">
    <UButton
      color="neutral"
      variant="ghost"
      class="-ml-2 min-h-11 self-start"
      data-testid="setup-back"
      @click="emit('back')"
    >
      {{ t('onboarding.flow.backToChoice') }}
    </UButton>
    <div>
      <SectionHeader ref="headingRef" tag="h2" size="display" tabindex="-1" class="text-balance outline-none">
        {{ t('onboarding.flow.local.title') }}
      </SectionHeader>
      <p class="mt-2 text-sm text-default">{{ t('onboarding.flow.local.intro') }}</p>
    </div>

    <RadioGroupRoot v-model="pick" class="flex flex-col gap-3" orientation="vertical" :aria-label="t('onboarding.local.howToStart')">
      <ChoiceCard
        v-for="option in options"
        :key="option.key"
        :value="option.key"
        :icon="option.icon"
        :data-testid="`local-option-${option.key}`"
      >
        {{ option.label }}
        <template #hint>{{ option.hint }}</template>
      </ChoiceCard>
    </RadioGroupRoot>

    <UButton color="primary" size="lg" block data-testid="local-confirm" @click="confirm">
      {{ t('onboarding.flow.local.confirm') }}
    </UButton>
  </section>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { ref, computed } from 'vue';
import { RadioGroupRoot } from 'reka-ui';
import ChoiceCard from '~/components/ui/ChoiceCard.vue';
import { useI18n } from 'vue-i18n';
import { useTasksStore } from '~/store/tasks';
import { useTopicStylesStore } from '~/store/topicStyles';
import { buildDemoBoard } from '~/lib/demo-board';

defineOptions({ name: 'LocalSetupFlow' });

const emit = defineEmits<{ (e: 'back'): void; (e: 'complete', withSamples: boolean): void }>();

const { t } = useI18n();
const tasksStore = useTasksStore();
const headingRef = ref<{ $el: HTMLElement } | null>(null);
const pick = ref<'fresh' | 'samples'>('fresh');

const options = computed(() => [
  { key: 'fresh' as const, icon: 'i-ph-plus-circle', label: t('onboarding.local.startFresh'), hint: t('onboarding.flow.local.freshHint') },
  { key: 'samples' as const, icon: 'i-ph-sparkle', label: t('onboarding.local.startSamples'), hint: t('onboarding.flow.local.samplesHint') },
]);

defineExpose({ focusHeading: () => headingRef.value?.$el.focus({ preventScroll: true }) });

function confirm() {
  if (pick.value === 'samples') {
    // The shared demo board (#527): tasks, carried-over counters and topic colours and symbols
    const demo = buildDemoBoard();
    tasksStore.setTasks(demo.tasks);
    tasksStore.setCarryOver(demo.carryOverByTaskId);
    const topicStyles = useTopicStylesStore();
    for (const [name, style] of Object.entries(demo.topicStyles)) topicStyles.setStyle(name, style);
  } else {
    tasksStore.setTasks([]);
  }
  emit('complete', pick.value === 'samples');
}
</script>
