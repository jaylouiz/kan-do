<!--
@component DataBackupList
@description The "Sicherungen" section of /settings/data (#224, ADR 011): when the last backup was taken,
"Jetzt sichern", and the backups newest first with their kind, origin and task count. Mostly text; the
only colour is the orange line when a daily or manual backup failed. Restoring is requested through an
event, the page owns the single confirmation modal.
@usage <DataBackupList @restore="onRestore" />
@responsibility
- Loads the list on mount and after every backup; empty, loading and error states
- Newest 8 visible, "Alle n anzeigen" for the rest
- Unreadable files are listed as "nicht lesbar" without an action; a backup from a newer app version
  shows a disabled "App aktualisieren"
- "Wiederherstellen" follows `restoreBlock`: off with a one-line reason in a conflict, a newer-schema file
  or an unavailable folder; on in a corrupt file, where restoring is the way out
-->
<template>
  <section aria-labelledby="data-backups-heading" class="space-y-3" data-testid="data-backups">
    <h2 id="data-backups-heading" class="section-heading">
      {{ t('settings.data.backups.heading') }}
    </h2>
    <p class="text-sm text-muted">{{ t('settings.data.backups.lead') }}</p>
    <p v-if="restoreBlock" class="text-sm text-muted" data-testid="data-restore-blocked">
      {{ t(`settings.data.restoreBlocked.${restoreBlock}`) }}
    </p>

    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p class="text-sm text-muted" data-testid="data-backups-last">{{ lastLine }}</p>
      <UButton
        variant="soft"
        color="neutral"
        :loading="working"
        :disabled="working || !canBackUp"
        data-testid="data-backup-now"
        @click="onBackupNow"
      >
        {{ working ? t('settings.data.backups.working') : t('settings.data.backups.now') }}
      </UButton>
    </div>

    <p v-if="failureLine" class="text-sm text-warning-700" role="status" data-testid="data-backup-error">{{ failureLine }}</p>

    <p v-if="backupsLoad === 'loading'" class="text-sm text-muted" data-testid="data-backups-loading">
      {{ t('settings.data.backups.loading') }}
    </p>
    <div v-else-if="backupsLoad === 'error'" class="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="data-backups-failed">
      <p class="text-sm text-error-700">{{ t('settings.data.backups.loadFailed') }}</p>
      <UButton variant="link" color="neutral" size="sm" @click="refreshBackups">{{ t('settings.data.backups.reload') }}</UButton>
    </div>
    <p v-else-if="backups.length === 0" class="text-sm text-muted" data-testid="data-backups-empty">
      {{ t('settings.data.backups.empty') }}
    </p>

    <ul v-if="visible.length" :aria-label="t('settings.data.backups.listLabel')" class="divide-y divide-default">
      <li
        v-for="entry in visible"
        :key="entry.name"
        class="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5"
        data-testid="data-backup-row"
        :data-kind="entry.kind"
      >
        <p class="min-w-0 text-sm text-default">
          <span class="text-highlighted tabular-nums">{{ formatDateTime(entry.ts, 'mediumDateShortTime') }}</span>
          <span class="px-1.5 text-muted" aria-hidden="true">·</span>
          <span>{{ t(`settings.data.backups.kind.${entry.kind}`) }}</span>
          <template v-if="entry.readable && !entry.ownDevice">
            <span class="px-1.5 text-muted" aria-hidden="true">·</span>
            <span class="text-muted">{{ t('settings.data.backups.otherDevice') }}</span>
          </template>
          <span class="px-1.5 text-muted" aria-hidden="true">·</span>
          <span v-if="!entry.readable" class="text-muted" data-testid="data-backup-unreadable">{{ t('settings.data.backups.unreadable') }}</span>
          <span v-else-if="entry.taskCount !== null" class="text-muted">{{ t('settings.data.backups.tasks', { n: entry.taskCount }, entry.taskCount) }}</span>
        </p>
        <UButton
          v-if="entry.readable && isNewer(entry)"
          variant="ghost"
          color="neutral"
          size="sm"
          disabled
          data-testid="data-backup-update"
        >
          {{ t('settings.data.backups.update') }}
        </UButton>
        <UButton
          v-else-if="entry.readable"
          variant="soft"
          color="neutral"
          size="sm"
          :disabled="restoreBlock !== null"
          :aria-label="t('settings.data.backups.restoreAt', { time: formatDateTime(entry.ts, 'mediumDateShortTime') })"
          data-testid="data-backup-restore"
          @click="emit('restore', entry)"
        >
          {{ t('settings.data.backups.restore') }}
        </UButton>
      </li>
    </ul>

    <UButton
      v-if="backups.length > VISIBLE_COUNT"
      variant="link"
      color="neutral"
      size="sm"
      :aria-expanded="showAll"
      data-testid="data-backups-toggle"
      @click="showAll = !showAll"
    >
      {{ showAll ? t('settings.data.backups.showLess') : t('settings.data.backups.showAll', { n: backups.length }) }}
    </UButton>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataFolder } from '~/composables/useDataFolder';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { CURRENT_SCHEMA_VERSION } from '~/utils/dataFile/envelope';
import type { BackupEntry } from '~/types/dataFile';

defineOptions({ name: 'DataBackupList' });

const emit = defineEmits<{
  restore: [entry: BackupEntry];
}>();

const VISIBLE_COUNT = 8;

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const { backups, backupsLoad, backupError, state, status, restoreBlock, refreshBackups, backupNow, describeError } = useDataFolder();

const showAll = ref(false);
const working = ref(false);
const manualError = ref<string | null>(null);

/** Nothing to copy while the file is unreadable, missing, in conflict or the folder is gone. */
const canBackUp = computed(() => ['ok', 'write-failed', 'read-only-newer-schema'].includes(status.value));

const visible = computed(() => (showAll.value ? backups.value : backups.value.slice(0, VISIBLE_COUNT)));

const lastLine = computed(() => {
  const newest = backups.value[0];
  return newest
    ? t('settings.data.backups.last', { time: formatDateTime(newest.ts, 'mediumDateShortTime') })
    : t('settings.data.backups.none');
});

const failureLine = computed(() => {
  const error = backupError.value ?? manualError.value;
  return error ? t('settings.data.backups.failed', { error }) : null;
});

function isNewer(entry: BackupEntry): boolean {
  return (entry.schemaVersion ?? 0) > CURRENT_SCHEMA_VERSION;
}

async function onBackupNow() {
  working.value = true;
  manualError.value = null;
  try {
    await backupNow('manual');
  } catch (error) {
    manualError.value = describeError(error);
  } finally {
    working.value = false;
  }
}

onMounted(() => { void refreshBackups(); });

// A daily backup or a save in the background changes the list without a click here.
watch(() => state.writtenAt, () => { void refreshBackups(); });
</script>
