<!--
@component LocalSetupFlow
@kind block
@category input
@description The local setup as page content inside the welcome sheet (#43): confirms starting with an empty board on this device
@usage <LocalSetupFlow @back="flow = null" @complete="onLocalDone" /> inside pages/welcome.vue
@avoid Only the local setup on the welcome page; Notion is NotionSetupFlow, the trial board is SamplesSetupFlow.
@responsibility
- Explains that tasks stay on this device and other connections come later, and says the board starts empty
- Empties the task store, then emits `complete` ("Los geht's" is the only action; sample cards moved to their own step, #236)
- Back returns to the choice: the shared `BackButton` ("Zurück zur Auswahl", with the arrow, DESIGN.md "Chrome")
- Pattern: first-run setup, diverged from the modal wizard
-->
<template>
  <section class="flex flex-col gap-6" data-testid="local-setup-flow" :aria-label="t('onboarding.flow.local.label')">
    <BackButton :label="t('onboarding.flow.backToChoice')" @click="emit('back')" />
    <div>
      <SectionHeader ref="headingRef" tag="h2" size="display" tabindex="-1" class="text-balance outline-none">
        {{ t('onboarding.flow.local.title') }}
      </SectionHeader>
      <p class="mt-2 text-body text-default">{{ t('onboarding.flow.local.intro') }}</p>
      <p class="mt-2 text-body text-default">{{ t('onboarding.flow.local.emptyBoard') }}</p>
    </div>

    <UButton color="primary" size="lg" block data-testid="local-confirm" @click="confirm">
      {{ t('onboarding.flow.local.confirm') }}
    </UButton>
  </section>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { ref } from 'vue';
import BackButton from '~/components/ui/BackButton.vue';
import { useI18n } from 'vue-i18n';
import { useTasksStore } from '~/store/tasks';

defineOptions({ name: 'LocalSetupFlow' });

const emit = defineEmits<{ (e: 'back' | 'complete'): void }>();

const { t } = useI18n();
const tasksStore = useTasksStore();
const headingRef = ref<{ $el: HTMLElement } | null>(null);

defineExpose({ focusHeading: () => headingRef.value?.$el.focus({ preventScroll: true }) });

function confirm() {
  tasksStore.setTasks([]);
  emit('complete');
}
</script>
