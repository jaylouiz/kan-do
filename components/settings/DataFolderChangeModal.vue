<!--
@component DataFolderChangeModal
@kind block
@category overlay
@description Modal for switching the desktop data folder after the native picker returned a folder
(#222, ADR 008). The target decides the choices: an empty folder gets "copy my data here" (the old file
stays), a folder that already holds data offers "use the data already there" (the app reloads) or
"replace it with my data" (explicit confirm step). Unwritable and unreadable targets are refused inline.
@usage <DataFolderChangeModal v-model:open="open" :choice="choice" />
@avoid Only for switching the desktop data folder.
@responsibility
- Shows the target path and what is in it; Cancel or Escape changes nothing
- Calls `useDataFolder().applyFolder`; Rust flushes pending writes before the switch
- Keeps one dialog: replace asks for confirmation inside the same modal (no modal on modal)
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="t('settings.data.modal.title')"
    :ui="{ content: MODAL_WIDTH.md }"
    @after:leave="emit('after:leave')"
  >
    <template #body>
      <div v-if="choice" class="space-y-4">
        <div class="space-y-1">
          <p class="text-sm text-muted">{{ t('settings.data.modal.target') }}</p>
          <p class="font-mono text-sm break-all text-highlighted" data-testid="data-folder-target">{{ choice.folder }}</p>
        </div>

        <UAlert
          v-if="blockedText"
          color="error"
          variant="subtle"
          icon="i-ph-x-circle"
          role="alert"
          :description="blockedText"
          data-testid="data-folder-blocked"
        />

        <template v-else-if="step === 'confirm'">
          <p class="text-sm text-default" data-testid="data-folder-confirm">{{ t('settings.data.modal.confirmReplace') }}</p>
        </template>

        <p v-else-if="existing === 'none'" class="flex items-start gap-2 text-sm">
          <UIcon name="i-ph-copy" class="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
          <span>
            <span class="block font-medium text-highlighted">{{ t('settings.data.modal.copyMine') }}</span>
            <span class="text-muted">{{ t('settings.data.modal.copyMineBody') }}</span>
          </span>
        </p>

        <template v-else>
          <p class="text-sm text-default">{{ hasDataText }}</p>
          <p v-if="existing === 'newer-schema'" class="text-sm text-muted">{{ t('settings.data.modal.newerSchema') }}</p>
          <URadioGroup
            v-else
            v-model="mode"
            :legend="t('settings.data.modal.choiceLabel')"
            :items="options"
            color="neutral"
            name="data-folder-mode"
            :aria-label="t('settings.data.modal.choiceLabel')"
            :ui="{ legend: 'text-sm font-medium text-highlighted', description: 'text-muted' }"
          />
        </template>

        <UAlert
          v-if="errorText"
          color="error"
          variant="subtle"
          icon="i-ph-x-circle"
          role="alert"
          :description="errorText"
          data-testid="data-folder-error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <UButton color="neutral" variant="soft" :disabled="working" @click="onSecondary">
          {{ step === 'confirm' ? t('settings.data.modal.back') : t('common.cancel') }}
        </UButton>
        <UButton
          size="lg"
          color="primary"
          :loading="working"
          :disabled="!canContinue || working"
          data-testid="data-folder-continue"
          @click="onContinue"
        >
          {{ primaryLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataFolder, type FolderChoice } from '~/composables/useDataFolder';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { MODAL_WIDTH } from '~/utils/modalSizes';
import type { LocationMode } from '~/types/dataFile';

defineOptions({ name: 'DataFolderChangeModal' });

interface Props {
  /** The folder the picker returned, with what it holds; null while closed. */
  choice: FolderChoice | null;
}

const props = defineProps<Props>();
const isOpen = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  /** After the close animation: the page puts focus back on its own control. */
  'after:leave': [];
}>();

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const dataFolder = useDataFolder();

type Step = 'choose' | 'confirm';
const step = ref<Step>('choose');
const mode = ref<Exclude<LocationMode, 'move'>>('use');
const working = ref(false);
const errorText = ref<string | null>(null);

watch(() => [props.choice, isOpen.value] as const, () => {
  step.value = 'choose';
  mode.value = 'use';
  working.value = false;
  errorText.value = null;
});

const info = computed(() => props.choice?.info ?? null);
const existing = computed(() => info.value?.existing ?? 'none');

const blockedText = computed(() => {
  if (!info.value) return null;
  if (info.value.isCurrent) return t('settings.data.modal.sameFolder');
  if (!info.value.writable) return t('settings.data.modal.notWritable');
  if (existing.value === 'corrupt') return t('settings.data.modal.corrupt');
  return null;
});

const hasDataText = computed(() => {
  const writtenAt = info.value?.writtenAt;
  return writtenAt
    ? t('settings.data.modal.hasData', { time: formatDateTime(writtenAt, 'mediumDateShortTime') })
    : t('settings.data.modal.hasDataNoTime');
});

const options = computed(() => [
  { value: 'use', label: t('settings.data.modal.optionUse'), description: t('settings.data.modal.optionUseBody') },
  { value: 'replace', label: t('settings.data.modal.optionReplace'), description: t('settings.data.modal.optionReplaceBody') },
]);

const canContinue = computed(() => !blockedText.value && info.value !== null);

/** The mode the primary button applies; `replace` first needs the confirm step. */
const targetMode = computed<LocationMode>(() => {
  if (existing.value === 'none') return 'move';
  if (existing.value === 'newer-schema') return 'use';
  return mode.value;
});

const primaryLabel = computed(() => {
  if (working.value) return t('settings.data.modal.working');
  if (step.value === 'confirm') return t('settings.data.modal.replace');
  return targetMode.value === 'move' ? t('settings.data.modal.copyMine') : t('settings.data.modal.next');
});

function onSecondary() {
  if (step.value === 'confirm') {
    step.value = 'choose';
    return;
  }
  isOpen.value = false;
}

async function onContinue() {
  const choice = props.choice;
  if (!choice || !canContinue.value) return;
  if (targetMode.value === 'replace' && step.value === 'choose') {
    step.value = 'confirm';
    return;
  }
  working.value = true;
  errorText.value = null;
  try {
    await dataFolder.applyFolder(choice.folder, targetMode.value);
    isOpen.value = false;
  } catch (error) {
    errorText.value = failureText(dataFolder.toDataError(error).kind);
    step.value = 'choose';
  } finally {
    working.value = false;
  }
}

function failureText(kind: string): string {
  if (kind === 'not_writable') return t('settings.data.modal.notWritable');
  if (kind === 'target_has_data') return t('settings.data.modal.failedHasData');
  if (kind === 'blocked') return t('settings.data.modal.failedBlocked');
  if (kind === 'target_corrupt') return t('settings.data.modal.corrupt');
  return t('settings.data.modal.failed');
}
</script>
