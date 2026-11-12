<!--
@component DataStorageNotice
@kind component
@category feedback
@description Persistent single-line notice for the desktop data file (#222, ADR 008; #224, ADR 011). Shown
for every state other than `ok`, for cloud-sync conflict copies and, last, for a data file iCloud has not
uploaded (#271); it disappears on its own when the state is healthy again. Not a toast: it stays until the problem is gone,
except the cloud notice, which "Ausblenden" hides for the rest of the app session (#289, memory only). Also hosts the conflict modal and opens it
once when a conflict appears.
@usage <DataStorageNotice /> above the board in pages/tasks.vue, <DataStorageNotice :show-details="false" /> on /settings/data
@avoid A persistent notice for the data file; transient results use a toast, a source's sync problem uses the sync popover.
@responsibility
- Warning colour for read-only, missing-file, conflict and conflict copies (needs attention); neutral colour
  for a late iCloud upload in any state (uploading, pending, error: one copy, the data is safe locally); error colour for write-failed and an unavailable folder
- `role="status"` so the change is announced politely
- The cloud notice is held back (or kept) while a board drag runs, so it never shifts the board under a dragged card
- "Details" link to /settings/data (hidden on that page); "Ausblenden" on the cloud notice only; "Lösen" for a conflict; "Erneut versuchen" for an
  unavailable folder
-->
<template>
  <UAlert
    v-if="notice"
    v-bind="$attrs"
    role="status"
    variant="subtle"
    orientation="horizontal"
    :color="notice.color"
    :icon="notice.icon"
    :title="notice.text"
    :actions="actions"
    :ui="{ title: 'text-sm font-medium text-default', root: 'py-3 ring-0', actions: 'kando-notice-actions flex-wrap' }"
    data-testid="data-storage-notice"
  />
  <!-- Loaded on first use: most sessions never see a conflict, and the modal's module graph is not cheap. -->
  <DataConflictModal v-if="conflictWanted" v-model:open="conflictOpen" />
</template>

<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { conflictOpen, openConflict, useConflictAutoOpen } from '~/composables/useDataConflictFlow';
import { useDataFolder } from '~/composables/useDataFolder';
import { useHeldWhileDragging } from '~/composables/useHeldWhileDragging';

defineOptions({ name: 'DataStorageNotice', inheritAttrs: false });

interface Props {
  /** The "Details" link; off on the page it points to. */
  showDetails?: boolean;
}

const props = withDefaults(defineProps<Props>(), { showDetails: true });

const { t } = useI18n();
const { status, conflictCopies, cloudNotice, dismissCloudNotice, retry } = useDataFolder();
const retrying = ref(false);
// The late-upload notice appears on its own mid-session: never while a card is being dragged (it would move the board).
const cloudShown = useHeldWhileDragging(cloudNotice);

const DataConflictModal = defineAsyncComponent(() => import('~/components/settings/DataConflictModal.vue'));
/** Mounted from the first opening on and kept, so the close animation and focus return still run. */
const conflictWanted = ref(conflictOpen.value);
watch(conflictOpen, (open) => { if (open) conflictWanted.value = true; }, { immediate: true });

useConflictAutoOpen();

const NOTICES = {
  'read-only-newer-schema': { text: 'newerSchema', color: 'warning', icon: 'i-ph-warning' },
  'read-only-corrupt': { text: 'corrupt', color: 'warning', icon: 'i-ph-warning' },
  'missing-file': { text: 'missing', color: 'warning', icon: 'i-ph-warning' },
  'write-failed': { text: 'writeFailed', color: 'error', icon: 'i-ph-warning-circle' },
  conflict: { text: 'conflict', color: 'warning', icon: 'i-ph-warning' },
  'folder-unavailable': { text: 'folderUnavailable', color: 'error', icon: 'i-ph-warning-circle' },
} as const;

const isCloudNotice = computed(
  () => !(status.value in NOTICES) && conflictCopies.value.length === 0 && cloudShown.value !== null,
);

const notice = computed(() => {
  // No `needsAttention` gate: a held cloud notice outlives it for the length of a drag.
  const entry = NOTICES[status.value as keyof typeof NOTICES];
  if (entry) return { ...entry, text: t(`settings.data.notice.${entry.text}`) };
  // Healthy file, but a sync client left copies behind: non-blocking, never above warning.
  if (conflictCopies.value.length > 0) {
    return { text: t('settings.data.notice.conflictCopies'), color: 'warning' as const, icon: 'i-ph-copy' };
  }
  // The data is safe locally, the cloud copy is late (any reason): quiet and neutral, clears itself.
  if (cloudShown.value) {
    return { text: t('settings.data.notice.cloudPending'), color: 'neutral' as const, icon: 'i-ph-cloud-slash' };
  }
  return null;
});

async function onRetry() {
  retrying.value = true;
  try {
    await retry();
  } catch {
    // The status event keeps the notice truthful; a failed IPC call changes nothing.
  } finally {
    retrying.value = false;
  }
}

const actions = computed(() => {
  const base = { color: 'neutral' as const, variant: 'link' as const };
  if (status.value === 'conflict') {
    return [{ ...base, label: t('settings.data.notice.resolve'), onClick: openConflict }];
  }
  if (status.value === 'folder-unavailable') {
    return [{ ...base, label: t('settings.data.notice.retry'), loading: retrying.value, onClick: onRetry }];
  }
  const list: ButtonProps[] = [];
  if (props.showDetails) list.push({ ...base, label: t('settings.data.notice.details'), to: '/settings/data' });
  // Only when the cloud notice is on screen AND still live: while a drag holds it, `dismissCloudNotice` would
  // hide a notice the user has not seen yet, so the action waits for the drop.
  if (isCloudNotice.value && cloudNotice.value !== null) list.push({ ...base, label: t('settings.data.notice.hide'), onClick: dismissCloudNotice });
  return list.length > 0 ? list : undefined;
});
</script>
