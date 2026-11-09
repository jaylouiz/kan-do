<!--
@component DataConflictModal
@kind block
@category overlay
@description The whole-file choice when the data file was changed elsewhere (another device, a hand edit,
a sync client) (#224, ADR 011). It shows exactly two versions with time, device and task count and lets the
user keep mine or load theirs; both versions end up in `<folder>/backups/`. With no unsaved changes of mine
it collapses to one action, "Neu laden".
@usage <DataConflictModal v-model:open="conflictOpen" /> inside DataStorageNotice (once per page)
@avoid Only for a data file changed elsewhere; other confirmations use DataRestoreModal or a plain UModal.
@responsibility
- "Später" / Escape keeps the conflict: status and notice stay, writes stay blocked, the app keeps working
- "Diese Version behalten": their file goes to backups as `conflict`, then mine is written
- "Andere Version laden" / "Neu laden": my state goes to backups as `unsaved`, then the window reloads on their file;
  a failed backup stops the reload and shows the error inline
- Disables the choice that would be unsafe: keeping mine over a newer-schema file, loading an unreadable one
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="t('settings.data.conflict.title')"
    :dismissible="!working"
    :ui="{ content: MODAL_WIDTH.md }"
  >
    <template #body>
      <div v-if="conflict" class="space-y-4" data-testid="data-conflict-modal">
        <dl class="space-y-3 text-sm">
          <div class="space-y-0.5">
            <dt class="font-medium text-highlighted">{{ t('settings.data.conflict.theirs') }}</dt>
            <dd class="text-default" data-testid="data-conflict-theirs">{{ theirsLine }}</dd>
          </div>
          <div class="space-y-0.5">
            <dt class="font-medium text-highlighted">{{ t('settings.data.conflict.mine') }}</dt>
            <dd class="text-default" data-testid="data-conflict-mine">{{ mineLine }}</dd>
          </div>
        </dl>

        <p class="text-sm text-muted">
          {{ conflict.localChanges ? t('settings.data.conflict.bothKept') : t('settings.data.conflict.noChanges') }}
        </p>
        <p v-if="blockedHint" class="text-sm text-default" data-testid="data-conflict-hint">{{ blockedHint }}</p>
        <p v-if="errorText" class="text-sm text-error-700" role="alert" data-testid="data-conflict-error">{{ errorText }}</p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton color="neutral" variant="soft" :disabled="working" data-testid="data-conflict-later" @click="isOpen = false">
          {{ t('settings.data.conflict.later') }}
        </UButton>
        <template v-if="conflict?.localChanges">
          <UButton
            color="neutral"
            variant="soft"
            :loading="working && pending === 'theirs'"
            :disabled="working || !conflict.theirs.readable"
            data-testid="data-conflict-theirs-action"
            @click="onResolve('theirs')"
          >
            {{ t('settings.data.conflict.loadTheirs') }}
          </UButton>
          <UButton
            size="lg"
            color="primary"
            :loading="working && pending === 'mine'"
            :disabled="working || theirsIsNewer"
            data-testid="data-conflict-mine-action"
            @click="onResolve('mine')"
          >
            {{ t('settings.data.conflict.keepMine') }}
          </UButton>
        </template>
        <UButton
          size="lg"
          v-else
          color="primary"
          :loading="working"
          :disabled="working || (conflict !== null && !conflict.theirs.readable)"
          data-testid="data-conflict-reload"
          @click="onResolve('theirs')"
        >
          {{ t('settings.data.conflict.reload') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataFolder } from '~/composables/useDataFolder';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { dataState } from '~/lib/dataStorage';
import { CURRENT_SCHEMA_VERSION } from '~/utils/dataFile/envelope';
import { MODAL_WIDTH } from '~/utils/modalSizes';
import type { ConflictChoice } from '~/types/dataFile';

defineOptions({ name: 'DataConflictModal' });

const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const dataFolder = useDataFolder();
const { conflict } = dataFolder;

const working = ref(false);
const pending = ref<ConflictChoice | null>(null);
const errorText = ref<string | null>(null);

watch(isOpen, (open) => {
  if (open) errorText.value = null;
});

function countText(count: number | null): string | null {
  return count === null ? null : t('settings.data.backups.tasks', { n: count }, count);
}

const theirsLine = computed(() => {
  const theirs = conflict.value?.theirs;
  if (!theirs) return '';
  if (!theirs.readable) return t('settings.data.conflict.unreadable');
  const origin = theirs.writtenBy === dataState.deviceId
    ? t('settings.data.conflict.origin.thisDevice')
    : t('settings.data.conflict.origin.otherDevice');
  const time = theirs.writtenAt
    ? formatDateTime(theirs.writtenAt, 'mediumDateShortTime')
    : t('settings.data.conflict.unknownTime');
  return [time, origin, countText(theirs.taskCount)].filter(Boolean).join(', ');
});

const mineLine = computed(() => {
  const info = conflict.value;
  if (!info) return '';
  const state = info.localChanges ? t('settings.data.conflict.mineChanged') : t('settings.data.conflict.mineSaved');
  return [state, countText(info.mineTaskCount)].filter(Boolean).join(', ');
});

const theirsIsNewer = computed(() => (conflict.value?.theirs.schemaVersion ?? 0) > CURRENT_SCHEMA_VERSION);

const blockedHint = computed(() => {
  const info = conflict.value;
  if (!info) return null;
  if (theirsIsNewer.value && info.localChanges) return t('settings.data.conflict.needsUpdate');
  if (!info.theirs.readable) return t('settings.data.conflict.theirsUnreadable');
  return null;
});

async function onResolve(choice: ConflictChoice) {
  working.value = true;
  pending.value = choice;
  errorText.value = null;
  try {
    await dataFolder.resolveConflict(choice);
    // "Diese Version behalten" lands here and the status leaves `conflict`; "Andere Version laden" reloads the window.
    if (choice === 'mine') isOpen.value = false;
  } catch (error) {
    // The other file moved on while the modal was open; it shows the current version now and nothing was written.
    errorText.value = dataFolder.toDataError(error).kind === 'changed'
      ? t('settings.data.conflict.changed')
      : t('settings.data.conflict.failed', { error: dataFolder.describeError(error) });
  } finally {
    working.value = false;
    pending.value = null;
  }
}
</script>
