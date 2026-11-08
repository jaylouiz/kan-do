<!--
@component LocalSetupFlow
@description The local setup as page content inside the welcome sheet (#43): pick an empty or a sample board, then confirm
@usage <LocalSetupFlow @back="flow = null" @complete="onLocalDone" /> inside pages/welcome.vue
@responsibility
- Explains that tasks stay on this device and other connections come later
- Two radio cards (empty board, sample board) on reka-ui's RadioGroup (the primitive under Nuxt UI's URadioGroup, whose card variant cannot carry the icon and the answer-row look): arrow keys select, one Tab stop (roving tabindex) and one "Los geht's" confirmation; nothing happens on the pick alone
- Seeds the task store (empty, or the shared demo board of #527 with carry-over and topic styles), then emits `complete`
- Back returns to the choice
- Pattern: first-run setup, diverged from the modal wizard; the radio cards follow the welcome page's answer rows
-->
<template>
  <section class="flex flex-col gap-6" data-testid="local-setup-flow" :aria-label="t('onboarding.flow.local.label')">
    <button
      type="button"
      class="focus-ring -ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-1 text-sm text-toned hover:text-highlighted"
      data-testid="setup-back"
      @click="emit('back')"
    >
      <UIcon name="i-ph-arrow-left" class="size-4" aria-hidden="true" />
      {{ t('onboarding.flow.backToChoice') }}
    </button>
    <div>
      <h2 ref="headingRef" tabindex="-1" class="font-display tracking-display text-3xl leading-(--lh-tight) text-balance text-highlighted outline-none sm:text-4xl">
        {{ t('onboarding.flow.local.title') }}
      </h2>
      <p class="mt-2 text-base text-default">{{ t('onboarding.flow.local.intro') }}</p>
    </div>

    <RadioGroupRoot v-model="pick" class="flex flex-col gap-3" orientation="vertical" :aria-label="t('onboarding.local.howToStart')">
      <RadioGroupItem
        v-for="option in options"
        :key="option.key"
        :value="option.key"
        class="focus-ring flex min-h-16 w-full items-center gap-4 rounded-xl border bg-elevated p-4 text-left hover:border-accented"
        :class="pick === option.key ? 'border-inverted bg-default' : 'border-default'"
        :data-testid="`local-option-${option.key}`"
      >
        <UIcon :name="option.icon" class="size-6 shrink-0 text-toned" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block text-lg font-medium text-highlighted">{{ option.label }}</span>
          <span class="block text-sm text-muted">{{ option.hint }}</span>
        </span>
        <span class="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]" :class="pick === option.key ? 'border-inverted' : 'border-accented'" aria-hidden="true">
          <span class="size-2.5 rounded-full bg-inverted transition-transform duration-150 motion-reduce:transition-none" :class="pick === option.key ? 'scale-100' : 'scale-0'" />
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>

    <UButton color="primary" size="lg" block data-testid="local-confirm" @click="confirm">
      {{ t('onboarding.flow.local.confirm') }}
    </UButton>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { RadioGroupRoot, RadioGroupItem } from 'reka-ui';
import { useI18n } from 'vue-i18n';
import { useTasksStore } from '~/store/tasks';
import { useTopicStylesStore } from '~/store/topicStyles';
import { buildDemoBoard } from '~/lib/demo-board';

defineOptions({ name: 'LocalSetupFlow' });

const emit = defineEmits<{ (e: 'back'): void; (e: 'complete', withSamples: boolean): void }>();

const { t } = useI18n();
const tasksStore = useTasksStore();
const headingRef = ref<HTMLElement | null>(null);
const pick = ref<'fresh' | 'samples'>('fresh');

const options = computed(() => [
  { key: 'fresh' as const, icon: 'i-ph-plus-circle', label: t('onboarding.local.startFresh'), hint: t('onboarding.flow.local.freshHint') },
  { key: 'samples' as const, icon: 'i-ph-sparkle', label: t('onboarding.local.startSamples'), hint: t('onboarding.flow.local.samplesHint') },
]);

defineExpose({ focusHeading: () => headingRef.value?.focus({ preventScroll: true }) });

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
