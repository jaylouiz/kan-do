<!--
@component LocalSetupFlow
@kind block
@category input
@description Step 2 of the welcome sheet (#294): says that tasks live on this device by default and offers further services as a checkbox list, then starts the board or the Notion setup
@usage <LocalSetupFlow v-model:notion="wantNotion" @back="flow = null" @connect-notion="openNotion" @complete="onLocalDone" /> inside pages/welcome.vue
@avoid Only the second step on the welcome page; Notion is NotionSetupFlow, the trial board is SamplesSetupFlow.
@responsibility
- Explains that tasks stay on this device, local tasks are always possible and services can be connected now or later in Einstellungen
- Lists Notion as a checkbox (`UCheckbox`, neutral) and Todoist as a disabled one with "(kommt später)"
- One primary action whose label follows the checkbox: unchecked empties the task store and emits `complete` ("Zum Board"), checked emits `connect-notion` ("Mit Notion einrichten") and leaves the store alone
- Back returns to the start view: the shared `BackButton` ("Zurück")
- Pattern: first-run setup, diverged from the modal wizard; checkbox list aligned with the feedback dialog's context list
-->
<template>
  <section class="flex flex-col gap-6" data-testid="local-setup-flow" :aria-label="t('onboarding.flow.local.label')">
    <BackButton :label="t('common.back')" @click="emit('back')" />
    <div>
      <SectionHeader ref="headingRef" tag="h2" size="display" tabindex="-1" class="text-balance outline-none">
        {{ t('onboarding.flow.local.title') }}
      </SectionHeader>
      <p class="mt-2 text-body text-default">{{ t('onboarding.flow.local.intro') }}</p>
    </div>

    <fieldset class="flex flex-col gap-3" data-testid="local-sources">
      <legend class="mb-3 text-sm font-medium text-highlighted">{{ t('onboarding.flow.local.legend') }}</legend>
      <UCheckbox v-model="notion" color="neutral" :label="t('onboarding.flow.local.notion')" data-testid="local-source-notion" />
      <UCheckbox
        :model-value="false"
        disabled
        color="neutral"
        :label="t('onboarding.flow.local.todoist')"
        data-testid="local-source-todoist"
      />
    </fieldset>

    <UButton color="primary" size="lg" block aria-live="polite" data-testid="local-confirm" @click="confirm">
      {{ notion ? t('onboarding.flow.local.confirmNotion') : t('onboarding.flow.local.confirm') }}
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

const emit = defineEmits<{ (e: 'back' | 'complete' | 'connect-notion'): void }>();
/** Whether Notion is ticked: the host keeps it, so Back from the Notion setup finds it set */
const notion = defineModel<boolean>('notion', { default: false });

const { t } = useI18n();
const tasksStore = useTasksStore();
const headingRef = ref<{ $el: HTMLElement } | null>(null);

defineExpose({ focusHeading: () => headingRef.value?.$el.focus({ preventScroll: true }) });

function confirm() {
  if (notion.value) return emit('connect-notion');
  tasksStore.setTasks([]);
  emit('complete');
}
</script>
