<!--
@component DataExportImport
@kind block
@category action
@description The "Daten exportieren / importieren" section of /settings/data (#224, ADR 011): a plain JSON file,
independent of the data folder and without any credentials. Export writes through the native save dialog
(web, #238: a browser download); import validates the picked file first and then asks the page to confirm
(same modal as a restore; web: file chooser).
@usage <DataExportImport @import="onImport" />
@avoid Only the export/import section of /settings/data.
@responsibility
- "Exportieren…": save dialog, then the current state; cancel changes nothing
- "Importieren…": open dialog, validation errors inline (invalid, not a kan-do file, newer schema),
  on success emits the preview for the confirmation modal
-->
<template>
  <section aria-labelledby="data-transfer-heading" class="space-y-3" data-testid="data-transfer">
    <h2 id="data-transfer-heading" class="section-heading">
      {{ t('settings.data.exportImport.heading') }}
    </h2>
    <p class="text-sm text-muted">{{ t(desktop ? 'settings.data.exportImport.body' : 'settings.data.exportImport.webBody') }}</p>
    <div class="flex flex-wrap gap-2">
      <UButton variant="soft" color="neutral" :loading="busy === 'export'" :disabled="busy !== null" data-testid="data-export" @click="onExport">
        {{ t(desktop ? 'settings.data.exportImport.export' : 'settings.data.exportImport.webExport') }}
      </UButton>
      <UButton variant="soft" color="neutral" :loading="busy === 'import'" :disabled="busy !== null || !canImport" data-testid="data-import" @click="onPickImport">
        {{ t('settings.data.exportImport.import') }}
      </UButton>
    </div>
    <p v-if="restoreBlock" class="text-sm text-muted" data-testid="data-import-blocked">
      {{ t(`settings.data.restoreBlocked.${restoreBlock}`) }}
    </p>
    <p v-if="doneText" class="text-sm text-default" role="status" data-testid="data-transfer-done">{{ doneText }}</p>
    <UAlert
      v-if="errorText"
      color="error"
      variant="subtle"
      icon="i-ph-x-circle"
      role="alert"
      :description="errorText"
      data-testid="data-transfer-error"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataFolder, type ImportPreview } from '~/composables/useDataFolder';
import { useWebDataTransfer } from '~/composables/useWebDataTransfer';
import { isTauri } from '~/utils/isTauri';

defineOptions({ name: 'DataExportImport' });

const emit = defineEmits<{
  import: [preview: ImportPreview];
}>();

const { t } = useI18n();
const desktop = isTauri();
// Desktop: native dialogs and the data folder; web: download and file chooser on localStorage (#238).
const { restoreBlock, exportData, pickImport, describeError } = desktop ? useDataFolder() : useWebDataTransfer();

const busy = ref<'export' | 'import' | null>(null);
const doneText = ref<string | null>(null);
const errorText = ref<string | null>(null);

/** Importing replaces the file: not while a decision is pending or the file is newer (see `restoreBlockedBy`). */
const canImport = computed(() => restoreBlock.value === null);

function reset() {
  doneText.value = null;
  errorText.value = null;
}

async function onExport() {
  reset();
  busy.value = 'export';
  try {
    if ((await exportData()) === 'saved') doneText.value = t('settings.data.exportImport.exported');
  } catch (error) {
    errorText.value = t('settings.data.exportImport.exportFailed', { error: describeError(error) });
  } finally {
    busy.value = null;
  }
}

const IMPORT_FAILURES = {
  invalid: 'invalid',
  'not-kan-do': 'notKando',
  'newer-schema': 'newerSchema',
  unreadable: 'unreadable',
} as const;

async function onPickImport() {
  reset();
  busy.value = 'import';
  try {
    const picked = await pickImport();
    if (picked.kind === 'failed') errorText.value = t(`settings.data.exportImport.${IMPORT_FAILURES[picked.reason]}`);
    else if (picked.kind === 'ready') emit('import', picked.preview);
  } catch (error) {
    errorText.value = t('settings.data.exportImport.importFailed', { error: describeError(error) });
  } finally {
    busy.value = null;
  }
}
</script>
