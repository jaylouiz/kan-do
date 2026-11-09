<!--
@component DataConflictCopies
@kind block
@category display
@description The "Konflikt-Kopien" section of /settings/data (#224, ADR 011): files a sync client left next
to the data file (Dropbox "conflicted copy", iCloud `kan-do-data 2.json`, Syncthing `.sync-conflict-`) that
parse as a data file. Only rendered when there are any. Nothing is ever deleted: "Wiederherstellen" runs the
restore flow with that file as the source, "Ablegen" moves it into `backups/` so the sync client stops
showing it.
@usage <DataConflictCopies @restore="onRestoreCopy" />
@avoid Only the Konflikt-Kopien section of /settings/data.
@responsibility
- Lists each copy with its time and task count
- "Ablegen" files it away and reports a failure inline
-->
<template>
  <section v-if="conflictCopies.length" aria-labelledby="data-copies-heading" class="space-y-3" data-testid="data-copies">
    <h2 id="data-copies-heading" class="section-heading">
      {{ t('settings.data.copies.heading') }}
    </h2>
    <p class="text-sm text-muted">{{ t('settings.data.copies.body') }}</p>
    <ul class="divide-y divide-default">
      <li v-for="copy in conflictCopies" :key="copy.name" class="space-y-2 py-2" data-testid="data-copy-row">
        <p class="min-w-0 text-sm break-all text-highlighted">{{ copy.name }}</p>
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p class="text-sm text-muted">
            <span class="tabular-nums">{{ formatDateTime(copy.writtenAt, 'mediumDateShortTime') }}</span>
            <template v-if="copy.taskCount !== null">
              <span class="px-1.5" aria-hidden="true">·</span>{{ t('settings.data.backups.tasks', { n: copy.taskCount }, copy.taskCount) }}
            </template>
          </p>
          <div class="flex gap-2">
            <UButton
              variant="soft"
              color="neutral"
              size="sm"
              :disabled="copy.schemaVersion > CURRENT_SCHEMA_VERSION || !canRestore"
              data-testid="data-copy-restore"
              @click="emit('restore', copy)"
            >
              {{ t('settings.data.copies.restore') }}
            </UButton>
            <UButton
              variant="soft"
              color="neutral"
              size="sm"
              :loading="filing === copy.name"
              :disabled="filing !== null"
              data-testid="data-copy-file"
              @click="onFile(copy.name)"
            >
              {{ t('settings.data.copies.file') }}
            </UButton>
          </div>
        </div>
      </li>
    </ul>
    <p v-if="errorText" class="text-sm text-error-700" role="alert" data-testid="data-copies-error">{{ errorText }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDataFolder } from '~/composables/useDataFolder';
import { useLocaleFormat } from '~/composables/useLocaleFormat';
import { CURRENT_SCHEMA_VERSION } from '~/utils/dataFile/envelope';
import type { ConflictCopy } from '~/types/dataFile';

defineOptions({ name: 'DataConflictCopies' });

const emit = defineEmits<{
  restore: [copy: ConflictCopy];
}>();

const { t } = useI18n();
const { formatDateTime } = useLocaleFormat();
const { conflictCopies, restoreBlock, fileToBackups, describeError } = useDataFolder();

const filing = ref<string | null>(null);
const errorText = ref<string | null>(null);

/** Restoring replaces the file: not while a decision is pending or the file is newer (see `restoreBlockedBy`). */
const canRestore = computed(() => restoreBlock.value === null);

async function onFile(name: string) {
  filing.value = name;
  errorText.value = null;
  try {
    await fileToBackups(name);
  } catch (error) {
    errorText.value = t('settings.data.copies.failed', { error: describeError(error) });
  } finally {
    filing.value = null;
  }
}
</script>
