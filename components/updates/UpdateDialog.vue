<!--
@component UpdateDialog
@kind block
@category overlay
@description Confirmation dialog for installing a found update (#225, ADR 009). Names the new and the
current version, says that data is backed up first and the app restarts, and installs only on
"Installieren und neu starten". While it downloads or installs it cannot be closed.
@usage <UpdateDialog /> once in app.vue; open it with useAppUpdater().openDialog()
@avoid Only installing a found update; the after-update highlights are WhatsNewDialog.
@responsibility
- Footer right-aligned: neutral "Später" first, primary install button last (the one filled element)
- Progress as plain text on the button ("Wird geladen… 42%"), announced in a polite live region in 10% steps
- Failures stay inline and change nothing: data blocked (orange, linking to the data folder page), install failed (raspberry), with a retry
- Highlights of the new version come from getUpdateNotes() (#226): with them, the line "Neu seit deiner Version (x):" labels the list (#390); without (null), "Du nutzt x." stays and no list renders
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="update ? t('updates.dialog.title', { version: update.version }) : t('updates.dialog.titleFallback')"
    :description="t('updates.dialog.description')"
    :dismissible="!state.installing"
    :close="!state.installing"
    :ui="{ content: MODAL_WIDTH.sm, description: 'sr-only' }"
  >
    <template #body>
      <div v-if="update" class="space-y-3">
        <template v-if="notes">
          <p id="update-notes-label" class="text-sm text-default" data-testid="update-notes-label">
            {{ t('updates.dialog.sinceVersion', { version: update.currentVersion }) }}
          </p>
          <ul aria-labelledby="update-notes-label" class="list-disc space-y-1.5 pl-5 text-sm text-default" data-testid="update-notes">
            <li v-for="(bullet, index) in notes" :key="`${index}-${bullet.title}`">
              <strong class="font-semibold text-highlighted">{{ bullet.title }}</strong> {{ bullet.text }}
            </li>
          </ul>
        </template>
        <p v-else class="text-sm text-default" data-testid="update-current">
          {{ t('updates.dialog.current', { version: update.currentVersion }) }}
        </p>
        <p class="text-sm text-muted">{{ t('updates.dialog.backupNote') }}</p>
        <UAlert
          v-if="failureText"
          :color="failureColor"
          variant="subtle"
          :icon="failureColor === 'warning' ? 'i-ph-warning' : 'i-ph-x-circle'"
          role="alert"
          :description="failureText"
          data-testid="update-error"
        />
        <UButton
          v-if="state.installError?.kind === 'data_blocked'"
          to="/settings/data"
          variant="link"
          color="neutral"
          class="px-0"
          data-testid="update-open-data"
          @click="updater.closeDialog()"
        >
          {{ t('updates.dialog.openData') }}
        </UButton>
        <p class="sr-only" role="status" aria-live="polite" data-testid="update-progress-live">{{ announcement }}</p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <UButton color="neutral" variant="soft" :disabled="state.installing" data-testid="update-later" @click="updater.closeDialog()">
          {{ t('updates.dialog.later') }}
        </UButton>
        <UButton
          size="lg"
          color="primary"
          :loading="state.installing"
          :disabled="state.installing"
          data-testid="update-install"
          @click="updater.install()"
        >
          {{ installLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppUpdater } from '~/composables/useAppUpdater';
import { getUpdateNotes } from '~/lib/updateNotes';
import { MODAL_WIDTH } from '~/utils/modalSizes';
import type { UpdateInstallFailure } from '~/types/updater';

defineOptions({ name: 'UpdateDialog' });

const { t } = useI18n();
const updater = useAppUpdater();
const { state, update, percent } = updater;

const isOpen = computed({
  get: () => state.dialogOpen && !!update.value,
  set: (open: boolean) => { if (!open) updater.closeDialog(); },
});

const notes = computed(() => (update.value ? getUpdateNotes(update.value) : null));

/** Prepares (flush, backup) until the first progress event, then downloads, then installs. */
const installLabel = computed(() => {
  if (!state.installing) return state.installError ? t('updates.dialog.retry') : t('updates.dialog.install');
  if (!state.progress) return t('updates.dialog.preparing');
  if (percent.value === null) return t('updates.dialog.downloading');
  if (percent.value >= 100) return t('updates.dialog.installing');
  return t('updates.dialog.progress', { percent: percent.value });
});

/** 10% steps keep the screen reader from reading every chunk. */
const announcement = computed(() => {
  if (!state.installing) return '';
  if (percent.value === null) return t('updates.dialog.downloading');
  if (percent.value >= 100) return t('updates.dialog.installing');
  return t('updates.dialog.progress', { percent: Math.floor(percent.value / 10) * 10 });
});

const FAILURE_KEYS = {
  'data_blocked:folder-unavailable': 'dataFolderUnavailable',
  'data_blocked:unreadable': 'dataUnreadable',
  'data_blocked:conflict': 'dataConflict',
  flush_failed: 'saveFailed',
  backup_failed: 'saveFailed',
  install_failed: 'installFailed',
  busy: 'busy',
  no_update: 'installFailed',
} as const;

function failureKey(failure: UpdateInstallFailure): keyof typeof FAILURE_KEYS {
  return failure.kind === 'data_blocked' ? `data_blocked:${failure.reason}` : failure.kind;
}

const failureText = computed(() => {
  const failure = state.installError;
  return failure ? t(`updates.dialog.error.${FAILURE_KEYS[failureKey(failure)]}`) : null;
});

/** Orange for "fix this first", raspberry for a failed install. */
const failureColor = computed(() => (state.installError?.kind === 'data_blocked' ? 'warning' : 'error'));
</script>
