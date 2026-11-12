<!--
@component DataSettingsPage
@description Sub-page /settings/data (web: only the export/import section, #238): where `kan-do-data.json` lives, when it was last
saved, and how to move it (#222, ADR 008); its backups, cloud conflict copies and the portable JSON
export/import (#224, ADR 011). Mostly text; the path is shown because choosing the folder is the feature.
@usage Command palette "Datenordner öffnen", the link in the Notion settings header, the notice's "Details" link
@responsibility
- Show the folder (middle-ellipsised, full path in the tooltip), last-saved time and schema version; for an iCloud folder one muted line with the upload state (#271)
- "Ordner ändern…" opens the native picker, then DataFolderChangeModal; "Im Finder zeigen" reveals the file
- Explain every non-ok state in one sentence with the few actions it allows; web shows nothing but export/import
- Hosts the one confirmation modal for restore (backup or conflict copy) and import; ends with the "App zurücksetzen" section (kd#227, asks in place)
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <div class="space-y-8">
        <DataStorageNotice v-if="desktop" :show-details="false" />

        <PageSheet v-if="desktop" tag="section" aria-labelledby="data-folder-heading" class="space-y-3">
          <SectionHeader id="data-folder-heading" tag="h2">
            {{ t('settings.data.folderHeading') }}
          </SectionHeader>
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p class="min-w-0 font-mono text-sm break-all text-highlighted" :title="state.folder" data-testid="data-folder-path">
              <span aria-hidden="true">{{ shortFolder }}</span>
              <span class="sr-only">{{ state.folder }}</span>
            </p>
            <UButton ref="changeButton" variant="soft" color="neutral" data-testid="data-folder-change" @click="onChangeFolder">
              {{ t('settings.data.changeFolder') }}
            </UButton>
          </div>
          <p class="text-sm text-muted" data-testid="data-folder-saved">{{ savedLine }}</p>
          <div v-if="cloudLine" class="space-y-1" data-testid="data-folder-cloud">
            <p class="text-body text-muted">{{ cloudLine }}</p>
            <p v-if="state.cloudSync?.state === 'error' && state.cloudSync.message" class="font-mono text-xs wrap-break-word text-muted">{{ state.cloudSync.message }}</p>
          </div>
          <UButton variant="ghost" color="neutral" icon="i-ph-folder-open" data-testid="data-folder-reveal" @click="onReveal">
            {{ t('settings.data.reveal') }}
          </UButton>
        </PageSheet>

        <PageSheet v-if="desktop && problemText" tag="section" class="space-y-3" data-testid="data-folder-problem">
          <UAlert
            :color="isFailure ? 'error' : 'neutral'"
            variant="subtle"
            :icon="isFailure ? 'i-ph-warning-circle' : 'i-ph-info'"
            role="status"
            :description="problemText"
          />
          <p v-if="isFailure && state.error" class="font-mono text-xs wrap-break-word text-muted">{{ state.error }}</p>
          <div v-if="problemActions" class="flex flex-wrap gap-2">
            <UButton v-if="status === 'missing-file'" variant="soft" color="neutral" data-testid="data-folder-start-fresh" @click="onStartFresh">
              {{ t('settings.data.startFresh') }}
            </UButton>
            <UButton v-if="status === 'folder-unavailable'" variant="soft" color="neutral" :loading="retrying" data-testid="data-folder-retry" @click="onRetry">
              {{ t('settings.data.notice.retry') }}
            </UButton>
            <UButton v-if="status === 'conflict'" variant="soft" color="neutral" data-testid="data-folder-resolve" @click="openConflict">
              {{ t('settings.data.notice.resolve') }}
            </UButton>
            <UButton v-if="status !== 'conflict'" variant="soft" color="neutral" data-testid="data-folder-choose" @click="onChangeFolder">
              {{ t('settings.data.chooseFolder') }}
            </UButton>
          </div>
        </PageSheet>

        <template v-if="desktop && status !== 'folder-unavailable'">
          <DataBackupList @restore="onRestoreBackup" />
          <DataConflictCopies @restore="onRestoreCopy" />
        </template>
        <DataExportImport @import="onImport" />
        <DataResetSection />
      </div>

      <DataFolderChangeModal v-if="desktop" v-model:open="modalOpen" :choice="choice" @after:leave="restoreFocus" />
      <DataRestoreModal v-model:open="restoreOpen" :request="restoreRequest" @after:leave="restoreImportFocus" />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import PageSheet from '~/components/ui/PageSheet.vue'
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DataBackupList from '~/components/settings/DataBackupList.vue';
import DataConflictCopies from '~/components/settings/DataConflictCopies.vue';
import DataExportImport from '~/components/settings/DataExportImport.vue';
import DataResetSection from '~/components/settings/DataResetSection.vue';
import DataFolderChangeModal from '~/components/settings/DataFolderChangeModal.vue';
import DataRestoreModal, { type RestoreRequest } from '~/components/settings/DataRestoreModal.vue';
import DataStorageNotice from '~/components/settings/DataStorageNotice.vue';
import { openConflict } from '~/composables/useDataConflictFlow';
import { useDataFolder, type FolderChoice, type ImportPreview } from '~/composables/useDataFolder';
import { useWebDataTransfer } from '~/composables/useWebDataTransfer';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { isTauri } from '~/utils/isTauri';
import { middleEllipsis } from '~/utils/middleEllipsis';
import type { BackupEntry, ConflictCopy } from '~/types/dataFile';

defineOptions({ name: 'DataSettingsPage' });

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  titleKey: 'settings.data.pageTitle',
  descriptionKey: 'settings.data.pageDescription',
});

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const dataFolder = useDataFolder();
const { state, status } = dataFolder;
const desktop = isTauri();
const webTransfer = useWebDataTransfer();

const modalOpen = ref(false);
const choice = ref<FolderChoice | null>(null);
const changeButton = ref<{ $el?: HTMLElement } | null>(null);

const shortFolder = computed(() => middleEllipsis(state.folder));

const savedLine = computed(() => {
  const version = state.schemaVersion ?? 1;
  return state.writtenAt
    ? t('settings.data.lastSaved', { time: formatDateTime(state.writtenAt, 'mediumDateShortTime'), version })
    : t('settings.data.notSavedYet', { version });
});

/** iCloud folders only (the field is null for every other folder and on web); live, also inside the grace. */
const cloudLine = computed(() => {
  const sync = state.cloudSync;
  return sync ? t(`settings.data.cloud.${sync.state}`) : null;
});

const PROBLEMS = {
  'read-only-newer-schema': 'newerSchema',
  'read-only-corrupt': 'corrupt',
  'missing-file': 'missing',
  'write-failed': 'writeFailed',
  conflict: 'conflict',
  'folder-unavailable': 'folderUnavailable',
} as const;

/** Failed, as opposed to "needs a decision": raspberry text and the raw error line. */
const isFailure = computed(() => status.value === 'write-failed' || status.value === 'folder-unavailable');

/** Which states offer actions below the sentence; write-failed retries on its own. */
const problemActions = computed(() => ['missing-file', 'read-only-corrupt', 'folder-unavailable', 'conflict'].includes(status.value));

const problemText = computed(() => {
  const key = PROBLEMS[status.value as keyof typeof PROBLEMS];
  return key ? t(`settings.data.state.${key}`) : null;
});

/** The picker's cancel changes nothing: no modal, no state. */
async function onChangeFolder() {
  const picked = await dataFolder.chooseFolder();
  if (!picked) return;
  choice.value = picked;
  modalOpen.value = true;
}

/** The modal opens after the native picker, not from a trigger, so focus would fall back to the body. */
function restoreFocus() {
  void nextTick(() => changeButton.value?.$el?.focus());
}

async function onReveal() {
  await dataFolder.revealInFinder().catch(() => undefined);
}

async function onStartFresh() {
  await dataFolder.startFresh().catch(() => undefined);
}

const retrying = ref(false);

async function onRetry() {
  retrying.value = true;
  try {
    await dataFolder.retry();
  } catch {
    // The status event keeps the page truthful.
  } finally {
    retrying.value = false;
  }
}

const restoreOpen = ref(false);
const restoreRequest = ref<RestoreRequest | null>(null);

/** Only the web import opens after an async chooser; restores keep the modal's own focus return to their row. */
const focusImportOnLeave = ref(false);

function askRestore(request: RestoreRequest, options: { focusImport?: boolean } = {}) {
  focusImportOnLeave.value = options.focusImport ?? false;
  restoreRequest.value = request;
  restoreOpen.value = true;
}

function onRestoreBackup(entry: BackupEntry) {
  askRestore({
    title: t('settings.data.restore.title', { time: formatDateTime(entry.ts, 'mediumDateShortTime') }),
    sourceLabel: t('settings.data.restore.source'),
    sourceCount: entry.taskCount,
    run: () => dataFolder.restore(entry.name),
  });
}

function onRestoreCopy(copy: ConflictCopy) {
  askRestore({
    title: t('settings.data.restore.title', { time: formatDateTime(copy.writtenAt, 'mediumDateShortTime') }),
    sourceLabel: t('settings.data.restore.source'),
    sourceCount: copy.taskCount,
    run: () => dataFolder.restore(copy.name),
  });
}

/** The modal opens after the async file chooser, so focus would fall back to the body. */
function restoreImportFocus() {
  if (!focusImportOnLeave.value) return;
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="data-import"]')?.focus());
}

function onImport(preview: ImportPreview) {
  askRestore({
    title: t('settings.data.exportImport.importTitle'),
    sourceLabel: preview.fileName,
    sourceCount: preview.taskCount,
    ...(desktop
      ? { confirmLabel: t('settings.data.exportImport.importConfirm'), run: () => dataFolder.applyImport(preview) }
      : {
          confirmLabel: t('settings.data.exportImport.webConfirm'),
          note: t('settings.data.exportImport.webNote'),
          safetyOption: true,
          run: ({ safetyDownload }) => webTransfer.applyImport(preview, { safetyDownload }),
        }),
  }, { focusImport: !desktop });
}

onMounted(() => { if (desktop) void dataFolder.refresh().catch(() => undefined); });
</script>
