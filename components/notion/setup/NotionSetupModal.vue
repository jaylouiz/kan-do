<!--
@component NotionSetupModal
@description Content component for the Notion setup modal
@usage Used during initial setup and when reconfiguring Notion integration settings
@responsibility
- Manages the Notion setup wizard flow
- Handles token input and validation
- Controls navigation between setup steps
- Provides configuration options (disconnecting is the dialog of #320, opened from the "Verbindungen" page)
-->
<template>
  <UModal
    v-model:open="isOpen"
    :dismissible="false"
    :title="modalTitle"
    :ui="{ content: MODAL_WIDTH.lg, body: 'p-0' }"
  >
    <template #body>
      <div class="p-6">
        <div class="flex h-(--modal-height-wizard) flex-col gap-4">
          <!-- Progress indicator: non-interactive by design (the wizard validates each step in order) -->
          <ol
            class="flex w-full items-start"
            :aria-label="t('notion.modal.stepsLabel')"
            data-testid="notion-setup-steps"
          >
            <li
              v-for="(item, index) in stepperItems"
              :key="item.title"
              class="relative flex-1 text-center"
              :aria-current="index === activeStepIndex ? 'step' : undefined"
              :data-state="index < activeStepIndex ? 'completed' : index === activeStepIndex ? 'active' : 'inactive'"
            >
              <div class="flex justify-center">
                <span
                  class="flex size-7 items-center justify-center rounded-full text-xs font-semibold"
                  :class="index <= activeStepIndex ? 'bg-primary text-inverted' : 'bg-accented text-muted'"
                  aria-hidden="true"
                >{{ index + 1 }}</span>
              </div>
              <span
                v-if="index < stepperItems.length - 1"
                class="absolute top-3 left-[calc(50%+1.25rem)] h-0.5 w-[calc(100%-2.5rem)] rounded-full"
                :class="index < activeStepIndex ? 'bg-primary' : 'bg-accented'"
                aria-hidden="true"
              />
              <div class="mt-1 px-0.5 text-xs font-medium break-words hyphens-auto" :class="index === activeStepIndex ? 'text-default' : 'text-muted'">
                {{ item.title }}
                <span v-if="index < activeStepIndex" class="sr-only">{{ t('notion.modal.stepDone') }}</span>
              </div>
            </li>
          </ol>

          <!-- Setup Wizard (scrollable content area) -->
          <div class="flex-1 overflow-y-auto">
            <WizardController
              ref="setupRef"
              :token="notionConfigStore.config?.token"
              :broken="isBroken"
              :mode="
                props.forceSetup
                  ? 'setup'
                  : notionConfigStore.isConfigured
                    ? 'settings'
                    : 'setup'
              "
              @cancel="closeModal"
              @next="setupRef?.nextStep()"
              @complete="complete"
            />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between space-x-2">
        <div class="flex items-center space-x-2">
          <UButton color="neutral" variant="soft" @click="closeModal">
            {{ t('common.cancel') }}
          </UButton>
        </div>
        <div class="flex items-center space-x-2">
          <UButton
            v-if="showBackButton"
            color="neutral"
            variant="soft"
            @click="handleBack"
          >
            {{ t('common.back') }}
          </UButton>
          <UButton
            color="primary"
            size="lg"
            :loading="isProceedButtonLoading"
            :disabled="isProceedButtonDisabled"
            data-testid="wizard-proceed"
            @click="handleProceed"
          >
            {{ proceedButtonText }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { MODAL_WIDTH } from '~/utils/modalSizes'
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import WizardController from "./wizard/WizardController.vue";
import { useNotionConfigStore } from "~/store/notionConfig";
import { useIntegrationHealthStore } from "~/store/integrationHealth";

defineOptions({ name: 'NotionSetupModal' });

/**
 * Props
 * @prop {boolean=} forceSetup Whether to force setup mode even if already configured
 */
const props = defineProps<{
  /** Whether to force setup mode even if already configured */
  forceSetup?: boolean;
}>();

const isOpen = defineModel<boolean>("open");

const emit = defineEmits<{ (e: "complete"): void }>();

const { t } = useI18n();
const notionConfigStore = useNotionConfigStore();
const integrationHealth = useIntegrationHealthStore();

const setupRef = ref<InstanceType<typeof WizardController> | null>(null);

const proceedButtonText = computed(() => {
  if (setupRef.value?.step === "status-mapping") {
    return t('notion.modal.finish');
  }
  return t('notion.modal.next');
});

// Broken state derived from integration health store
const isBroken = computed(() => integrationHealth.isBroken('notion'));

const isProceedButtonLoading = computed(() => {
  return !!setupRef.value?.isValidating;
});

const isProceedButtonDisabled = computed(() => {
  return !setupRef.value?.canProceed;
});

const showBackButton = computed(() => {
  // Only show back button in setup mode and not on the first step (token)
  const isSetupMode = props.forceSetup || !notionConfigStore.isConfigured;
  const isNotFirstSetupStep = setupRef.value?.step !== "token";
  const isNotFirstSettingsStep = setupRef.value?.step !== "mapping";

  if (isSetupMode) {
    return isNotFirstSetupStep;
  }
  return isNotFirstSettingsStep;
});

// Settings mode: an already configured integration, not opened with `forceSetup` (shorter step list)
const isSettingsMode = computed(() => !props.forceSetup && notionConfigStore.isConfigured);

const handleProceed = () => {
  if (
    setupRef.value?.step === "token" ||
    setupRef.value?.step === "database" ||
    setupRef.value?.step === "mapping" ||
    setupRef.value?.step === "custom-properties"
  ) {
    setupRef.value?.nextStep();
  } else if (setupRef.value?.step === "priority-mapping") {
    // Trigger the save method on the priority mapping step
    const priorityMappingStep = setupRef.value?.priorityMappingStep;
    if (priorityMappingStep && priorityMappingStep.save) {
      priorityMappingStep.save();
    }
  } else if (setupRef.value?.step === "status-mapping") {
    // Trigger the save method on the status mapping step, which will emit 'saved' and call finishSetup
    const statusMappingStep = setupRef.value?.statusMappingStep;
    if (statusMappingStep && statusMappingStep.save) {
      statusMappingStep.save();
    }
  }
};

const handleBack = () => {
  setupRef.value?.back();
};

const modalTitle = computed(() => {
  if (!props.forceSetup && notionConfigStore.isConfigured) {
    return t('notion.modal.titleSettings');
  }
  return setupRef.value?.step === "token"
    ? t('notion.modal.titleConnect')
    : t('notion.modal.titleConfigure');
});

// Stepper items and active step index
const allSteps = [
  { key: 'token', titleKey: 'notion.modal.steps.token' },
  { key: 'database', titleKey: 'notion.modal.steps.database' },
  { key: 'mapping', titleKey: 'notion.modal.steps.mapping' },
  { key: 'custom-properties', titleKey: 'notion.modal.steps.customProperties' },
  { key: 'priority-mapping', titleKey: 'notion.modal.steps.priority' },
  { key: 'status-mapping', titleKey: 'notion.modal.steps.status' }
] as const;

const stepperItems = computed(() => {
  const allowed = isSettingsMode.value
    ? ['mapping', 'custom-properties', 'priority-mapping', 'status-mapping']
    : ['token', 'database', 'mapping', 'custom-properties', 'priority-mapping', 'status-mapping'];
  
  // Filter out priority-mapping if no priority property selected
  // Check both the current propertyMapping and the stored config for priority field
  const currentMapping = setupRef.value?.propertyMapping;
  const storedMapping = notionConfigStore.config?.propertyMapping;
  const hasPriority = currentMapping?.priority || storedMapping?.priority;
  
  return allSteps
    .filter(s => allowed.includes(s.key))
    .filter(s => s.key !== 'priority-mapping' || hasPriority)
    .map(s => ({ title: t(s.titleKey) }));
});

const activeStepIndex = computed(() => {
  const current = setupRef.value?.step || (isSettingsMode.value ? 'mapping' : 'token');
  const allowed = isSettingsMode.value
    ? ['mapping', 'custom-properties', 'priority-mapping', 'status-mapping']
    : ['token', 'database', 'mapping', 'custom-properties', 'priority-mapping', 'status-mapping'];
  
  // Apply same filter as stepperItems
  const currentMapping = setupRef.value?.propertyMapping;
  const storedMapping = notionConfigStore.config?.propertyMapping;
  const hasPriority = currentMapping?.priority || storedMapping?.priority;
  const filtered = allowed.filter(s => s !== 'priority-mapping' || hasPriority);
  
  return filtered.indexOf(current);
});

/**
 * Resets state when closing
 */
const resetState = () => {
  // Reset will be handled by the WizardController itself
};

const closeModal = () => {
  isOpen.value = false;
  resetState();
};

/**
 * Handles completion of the setup process
 */
const complete = () => {
  emit("complete");
  closeModal();
};
</script>
