<!--
@component DataRestoreModal
@description Confirmation with a preview for every action that replaces the data file with another
version: restoring a backup, restoring a conflict copy, importing a JSON file (#224, ADR 011). It exists
for the comparison (source vs. now), not as an "are you sure?"; the replace is reversible through the
`pre-restore` backup the app takes first.
@usage <DataRestoreModal v-model:open="open" :request="request" @after:leave="restoreFocus" />
@responsibility
- Shows what will be restored and the task counts of the source and of now
- Web import (#238): optional default-checked "safety download" of the current data, passed to `request.run`
- Runs `request.run`; the window reloads on success, so there is no toast
- Shows a failure inline and changes nothing; Cancel or Escape changes nothing
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="request?.title ?? ''"
    :dismissible="!working"
    :ui="{ content: MODAL_WIDTH.sm }"
    @after:leave="emit('after:leave')"
  >
    <template #body>
      <div v-if="request" class="space-y-4" data-testid="data-restore-modal">
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="min-w-0 break-all text-muted">{{ request.sourceLabel }}</dt>
          <dd class="text-highlighted" data-testid="data-restore-source">{{ countText(request.sourceCount) }}</dd>
          <dt class="text-muted">{{ t('settings.data.restore.current') }}</dt>
          <dd class="text-highlighted" data-testid="data-restore-current">{{ countText(currentCount) }}</dd>
        </dl>
        <p class="text-sm text-default">{{ request.note ?? t('settings.data.restore.note') }}</p>
        <UCheckbox
          v-if="request.safetyOption"
          v-model="safetyDownload"
          :label="t('settings.data.exportImport.safetyDownload')"
          data-testid="data-restore-safety"
        />
        <p v-if="errorText" class="text-sm text-error-700" role="alert" data-testid="data-restore-error">{{ errorText }}</p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <UButton color="neutral" variant="soft" :disabled="working" @click="isOpen = false">
          {{ t('common.cancel') }}
        </UButton>
        <UButton size="lg" color="primary" :loading="working" :disabled="working" data-testid="data-restore-confirm" @click="onConfirm">
          {{ request?.confirmLabel ?? t('settings.data.restore.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataFolder } from '~/composables/useDataFolder';
import { readWebStores } from '~/composables/useWebDataTransfer';
import { snapshotMirror } from '~/lib/dataStorage';
import { WebTransferError } from '~/utils/dataFile/webReplace';
import { isTauri } from '~/utils/isTauri';
import { MODAL_WIDTH } from '~/utils/modalSizes';

defineOptions({ name: 'DataRestoreModal' });

export interface RestoreRequest {
  title: string;
  /** Row label for the source, e.g. "Sicherung" or the import file name. */
  sourceLabel: string;
  sourceCount: number | null;
  confirmLabel?: string;
  /** Replaces the default "backed up first" note (web has no automatic backup). */
  note?: string;
  /** Shows the "download current data first" checkbox, checked by default (web import). */
  safetyOption?: boolean;
  /** Replaces the data; resolves when the window is about to reload. */
  run: (options: { safetyDownload: boolean }) => Promise<void>;
}

interface Props {
  request: RestoreRequest | null;
}

const props = defineProps<Props>();
const isOpen = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  'after:leave': [];
}>();

const { t } = useI18n();
const dataFolder = useDataFolder();

const working = ref(false);
const errorText = ref<string | null>(null);
const currentCount = ref<number | null>(null);
const safetyDownload = ref(true);

watch(isOpen, (open) => {
  if (!open) return;
  errorText.value = null;
  working.value = false;
  safetyDownload.value = true;
  const tasks = ((isTauri() ? snapshotMirror() : readWebStores())['tasks-store'] as { tasks?: unknown } | undefined)?.tasks;
  currentCount.value = Array.isArray(tasks) ? tasks.length : null;
});

const countText = computed(() => (count: number | null) =>
  count === null ? '–' : t('settings.data.backups.tasks', { n: count }, count));

function failureText(error: unknown): string {
  if (error instanceof WebTransferError) {
    const key = { quota: 'failedQuota', safety: 'failedSafety', write: 'failedWrite' }[error.kind];
    return t(`settings.data.exportImport.${key}`);
  }
  const detail = dataFolder.toDataError(error);
  if (detail.kind === 'backup_failed') return t('settings.data.restore.failedBackup');
  if (detail.kind === 'blocked') return t('settings.data.restore.failedBlocked');
  if (detail.kind === 'newer_schema') return t('settings.data.restore.failedNewer');
  if (detail.kind === 'unreadable') return t('settings.data.restore.failedUnreadable');
  return t('settings.data.restore.failed', { error: detail.detail ?? detail.kind });
}

async function onConfirm() {
  if (!props.request) return;
  working.value = true;
  errorText.value = null;
  try {
    await props.request.run({ safetyDownload: safetyDownload.value });
  } catch (error) {
    errorText.value = failureText(error);
    working.value = false;
  }
}
</script>
