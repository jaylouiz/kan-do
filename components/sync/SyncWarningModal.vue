<!--
@component SyncWarningModal
@kind block
@category overlay
@description Warning when the sync of one source returns an empty or a much smaller result; the user confirms or cancels the sync of that source. Names the source (#318)
@usage Mounted once in pages/tasks.vue, opened by useSyncValidation
@avoid Only for a suspiciously empty or small sync result; a broken source is repaired through the sync popover, never a dialog.
@responsibility
- Show why the result looks suspicious, the stored and fetched task counts and the last merged sync
- Emit `action` ('confirm' | 'cancel'); the caller applies or drops the fetched tasks. Closing the dialog is a cancel (`update:open`)
-->
<script setup lang="ts">
import AppDialog from '~/components/ui/AppDialog.vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { integrationLabel } from '~/lib/taskSources'
import type { SourceId } from '~/types/taskSource'

defineOptions({ name: 'SyncWarningModal' })

interface Props {
  open: boolean
  /** The source whose sync looks suspicious */
  source: SourceId | null
  /** Why it looks suspicious: an empty result, or a drop of more than 80% */
  reason: string | null
  /** Stored tasks of that source */
  currentTaskCount: number
  /** Tasks the sync returned for it */
  fetchedCount: number
  /** Last sync of that source that was merged */
  lastSyncTimestamp: Date | null
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'action', action: 'confirm' | 'cancel'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const localOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const handleConfirm = () => {
  emit('action', 'confirm')
  localOpen.value = false
}

const handleCancel = () => {
  emit('action', 'cancel')
  localOpen.value = false
}

const { t } = useI18n()
const sourceName = computed(() => (props.source && props.source !== 'local' ? integrationLabel(props.source) : ''))
const isDrop = computed(() => props.reason === 'significant_task_count_drop')
const { formatDateTime } = useLocaleFormat()
const formatDate = (date: Date | null): string => {
  if (!date) return t('sync.warning.never')
  return formatDateTime(date, 'shortDateShortTime')
}
</script>

<template>
  <AppDialog
    v-model:open="localOpen"
    :title="t('sync.warning.title')"
    :dismissible="false"
    size="sm"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-ph-warning"
          :title="isDrop ? t('sync.warning.alertTitleDrop') : t('sync.warning.alertTitle')"
          :description="isDrop
            ? t('sync.warning.alertDescriptionDrop', { source: sourceName, fetched: fetchedCount, count: currentTaskCount })
            : t('sync.warning.alertDescription', { source: sourceName })"
        />

        <div class="space-y-2 text-sm">
          <p class="text-muted">
            <strong>{{ t('sync.warning.situation') }}</strong>
          </p>
          <ul class="ml-2 list-inside list-disc space-y-1 text-muted">
            <i18n-t keypath="sync.warning.localTasks" tag="li">
              <template #source>{{ sourceName }}</template>
              <template #count><strong class="text-highlighted">{{ currentTaskCount }}</strong></template>
            </i18n-t>
            <i18n-t keypath="sync.warning.lastSync" tag="li">
              <template #date><strong class="text-highlighted">{{ formatDate(lastSyncTimestamp) }}</strong></template>
            </i18n-t>
            <i18n-t keypath="sync.warning.newTasks" tag="li">
              <template #source>{{ sourceName }}</template>
              <template #count><strong class="text-warning-700">{{ fetchedCount }}</strong></template>
            </i18n-t>
          </ul>
        </div>

        <UAlert
          color="warning"
          variant="subtle"
          icon="i-ph-warning"
          :title="t('sync.warning.attention')"
          :description="t('sync.warning.deleteNotice', { count: currentTaskCount - fetchedCount, source: sourceName })"
        />

        <div class="space-y-2 text-sm text-muted">
          <p class="font-medium text-highlighted">{{ t('sync.warning.causesTitle') }}</p>
          <ul class="ml-2 list-inside list-disc space-y-1">
            <li>{{ t('sync.warning.causeEmpty', { source: sourceName }) }}</li>
            <li>{{ t('sync.warning.causeConnection', { source: sourceName }) }}</li>
            <li>{{ t('sync.warning.causeFilter', { source: sourceName }) }}</li>
            <li>{{ t('sync.warning.causeCriteria') }}</li>
          </ul>
        </div>

        <UAlert
          color="info"
          variant="subtle"
          icon="i-ph-info"
          :title="t('sync.warning.tipTitle')"
          :description="t('sync.warning.tipDescription', { source: sourceName })"
        />
      </div>
    </template>

    <template #footer>
      <UButton
        :label="t('common.cancel')"
        color="neutral"
        variant="soft"
        @click="handleCancel"
      />
      <UButton
        :label="t('sync.warning.confirm')"
        color="error"
        size="lg"
        @click="handleConfirm"
      />
    </template>
  </AppDialog>
</template>
