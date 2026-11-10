<!--
@component DisconnectSourceDialog
@kind component
@category overlay
@description Confirmation for taking an integration off the board (#320, epic #264 section 1). States how many
tasks leave, where new tasks go when the source was the default, and what happens to changes the source does
not hold yet.
@usage <DisconnectSourceDialog v-model:open="open" :source="'notion'" @disconnected="..." />, opened from the
Notion settings page now and from the "Verbindungen" page (#324).
@avoid Only for taking an integration off the board; deleting tasks has its own undo, not a dialog.
@responsibility
- Reads the plan from `useSourceConnections().disconnectPlan` (live) and calls `disconnectSource`
- Offers "Erst synchronisieren, dann trennen" only while the source can be reached; "Trotzdem trennen" and
  "Abbrechen" always
- Stays open and says why when the disconnect did not happen (changes left unsynced, Keychain refused)
-->
<template>
  <AppDialog
    v-model:open="isOpen"
    :title="t('sources.disconnect.title', { source: sourceName })"
    :dismissible="!isBusy"
    size="sm"
  >
    <template #body>
      <div class="space-y-4" data-testid="disconnect-dialog">
        <p class="text-default">
          {{ plan && plan.taskCount > 0
            ? t('sources.disconnect.leaving', { n: plan.taskCount, source: sourceName }, plan.taskCount)
            : t('sources.disconnect.leavingNone', { source: sourceName }) }}
        </p>
        <p v-if="plan?.isDefault" class="text-default" data-testid="disconnect-default-note">
          {{ t('sources.disconnect.defaultFallback') }}
        </p>
        <p v-if="timerTaskTitle" class="text-muted" data-testid="disconnect-timer-note">
          <i18n-t keypath="sources.disconnect.timerStops" tag="span">
            <template #title><span data-private>{{ timerTaskTitle }}</span></template>
          </i18n-t>
        </p>

        <UAlert
          v-if="plan && plan.unsyncedCount > 0"
          color="warning"
          variant="subtle"
          icon="i-ph-warning"
          :title="t('sources.disconnect.unsyncedTitle')"
          :description="canSync
            ? t('sources.disconnect.unsyncedReachable', { n: plan.unsyncedCount, source: sourceName }, plan.unsyncedCount)
            : t('sources.disconnect.unsyncedUnreachable', { n: plan.unsyncedCount, source: sourceName }, plan.unsyncedCount)"
          data-testid="disconnect-unsynced"
        />

        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          icon="i-ph-x-circle"
          role="alert"
          :title="failure === 'credentials' ? t('sources.disconnect.credentialsFailedTitle') : t('sources.disconnect.syncFailedTitle')"
          :description="failure === 'credentials'
            ? t('sources.disconnect.credentialsFailed', { source: sourceName })
            : t('sources.disconnect.syncFailed', { source: sourceName })"
          data-testid="disconnect-failure"
        />
      </div>
    </template>

    <template #footer>
      <!-- Three choices do not fit the sm dialog in a row: they stack, the safe one on top -->
      <div class="flex w-full flex-col-reverse gap-2" :class="canSync ? '' : 'sm:flex-row sm:items-center sm:justify-end'">
        <UButton
          color="neutral"
          variant="soft"
          :label="t('common.cancel')"
          :disabled="isBusy"
          :class="buttonClass"
          data-testid="disconnect-cancel"
          @click="isOpen = false"
        />
        <UButton
          :color="plan && plan.unsyncedCount > 0 ? 'error' : 'primary'"
          :variant="plan && plan.unsyncedCount > 0 ? 'soft' : 'solid'"
          :size="plan && plan.unsyncedCount > 0 ? undefined : 'lg'"
          :label="plan && plan.unsyncedCount > 0 ? t('sources.disconnect.anyway') : t('sources.disconnect.confirm')"
          :loading="busyAction === 'discard'"
          :disabled="isBusy || !plan"
          :class="buttonClass"
          data-testid="disconnect-anyway"
          @click="run(false)"
        />
        <UButton
          v-if="canSync"
          size="lg"
          color="primary"
          :label="t('sources.disconnect.syncFirst')"
          :loading="busyAction === 'sync'"
          :disabled="isBusy"
          :class="buttonClass"
          data-testid="disconnect-sync-first"
          @click="run(true)"
        />
      </div>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import AppDialog from '~/components/ui/AppDialog.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { integrationLabel } from '~/lib/taskSources'
import { useSourceConnections, type DisconnectResult } from '~/composables/useSourceConnections'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { IntegrationSourceId } from '~/types/taskSource'

defineOptions({ name: 'DisconnectSourceDialog' })

interface Props {
  /** The integration to disconnect; `null` while the dialog is closed. */
  source: IntegrationSourceId | null
}

const props = defineProps<Props>()
const isOpen = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  (e: 'disconnected', result: Extract<DisconnectResult, { ok: true }>): void
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()
const { disconnectPlan, disconnectSource } = useSourceConnections()

const sourceName = computed(() => (props.source ? integrationLabel(props.source) : ''))
const plan = computed(() => (props.source ? disconnectPlan(props.source) : null))
/** "Erst synchronisieren" needs a reachable source and something to push. */
const canSync = computed(() => !!plan.value && plan.value.reachable && plan.value.unsyncedCount > 0)

/** Full-width rows on a phone and whenever the three choices stack; a pair of buttons keeps its natural width from `sm` up. */
const buttonClass = computed(() => (canSync.value ? 'w-full justify-center' : 'w-full justify-center sm:w-auto'))

/** The running timer of a task of this source, named because it stops with the disconnect. */
const timerTaskTitle = computed(() =>
  tasksStore.tasks.find((task) => task.source === props.source && !!task.timerId && task.status === TaskStatus.Progress)?.title ?? null)

const busyAction = ref<'sync' | 'discard' | null>(null)
const isBusy = computed(() => busyAction.value !== null)
const failure = ref<'sync-incomplete' | 'credentials' | null>(null)

// A fresh opening starts without the failure of the last one
watch(isOpen, (open) => {
  if (open) failure.value = null
})

// The source went away underneath the dialog (connection removed elsewhere): nothing left to confirm
watch(plan, (next) => {
  if (isOpen.value && !next && !isBusy.value) isOpen.value = false
})

async function run(syncFirst: boolean) {
  if (!props.source || isBusy.value) return
  busyAction.value = syncFirst ? 'sync' : 'discard'
  failure.value = null
  try {
    const result = await disconnectSource(props.source, { syncFirst })
    if (result.ok) {
      isOpen.value = false
      emit('disconnected', result)
    } else if (result.reason === 'sync-incomplete' || result.reason === 'credentials') {
      failure.value = result.reason
    }
  } finally {
    busyAction.value = null
  }
}
</script>
