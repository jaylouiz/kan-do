<!--
@component DataResetSection
@kind block
@category action
@description The "App zurücksetzen" section of /settings/data (kd#227): one sentence and one button. Pressing it turns the section into the confirmation in place
(the same way the trash's "Papierkorb leeren" asks, DESIGN.md "An irreversible action confirms in place"): what is erased, what stays, the backup (desktop) or
that it cannot be undone (web), then "App zurücksetzen" and "Abbrechen". The export section sits right above, so "export first" is one scroll away.
@usage <DataResetSection /> below the export/import section of Daten & Speicher (web and desktop). The command palette's "App zurücksetzen…" goes to this page with the question already open.
@avoid Only the app reset; deleting a task has its undo, taking one connection off the board is DisconnectSourceDialog.
@responsibility
- Question: focus moves to "Abbrechen" (Enter, a repeated Enter from the palette included, cancels); Esc and "Abbrechen" hand focus back to the opening button
- "App zurücksetzen" is the only destructive control (error colour); it is disabled while working and the question cannot be cancelled then
- Stays open and says why when the reset did not complete: backup failed (nothing erased), data not writable (nothing changed), Keychain refused (data already erased:
  names the tokens, "Erneut versuchen" repeats the deletions only); "Abbrechen" then reloads the page from the already erased file (writes are frozen, the old state must not stay on screen)
- While a desktop data state (conflict, newer schema, unavailable folder) blocks replacing the data the button is off and the reason shows (same rule as import)
- Leaving the page drops an open question: coming back shows the button again
- Pattern: confirmation of an irreversible action, aligned with the trash's in-place "Papierkorb leeren" (a section sheet instead of the flat note: the action is app-wide, not a row)
-->
<template>
  <PageSheet
    tag="section"
    aria-labelledby="data-reset-heading"
    class="space-y-3"
    data-testid="data-reset"
    @keydown.esc.stop="confirming && !busy && cancel()"
  >
    <SectionHeader id="data-reset-heading" tag="h2">
      {{ t('settings.data.reset.heading') }}
    </SectionHeader>

    <template v-if="confirming">
      <div class="space-y-3" data-testid="reset-panel">
        <p class="text-default" role="alert" data-testid="reset-erased">
          {{ t('settings.data.reset.erased', { n: taskCount }, taskCount) }}
        </p>
        <!-- The losses: icon and text on the sheet itself, no boxed alert inside the sheet (no card in a card) -->
        <div class="flex items-start gap-2 text-default" data-testid="reset-note">
          <UIcon name="i-ph-warning" class="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden="true" />
          <div class="space-y-1">
            <p v-if="!desktop">{{ t('settings.data.reset.noteWeb') }}</p>
            <p>{{ t('settings.data.reset.unsynced') }}</p>
          </div>
        </div>
        <p class="text-body text-muted" data-testid="reset-kept">
          {{ t('settings.data.reset.upstream') }} {{ t('settings.data.reset.kept') }}<template v-if="desktop"> {{ t('settings.data.reset.noteDesktop') }}</template>
        </p>
        <div v-if="failure" class="flex items-start gap-2 text-default" role="alert" data-testid="reset-failure">
          <UIcon name="i-ph-x-circle" class="mt-0.5 size-4 shrink-0 text-error-700" aria-hidden="true" />
          <p>{{ failureText }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            color="error"
            variant="soft"
            :label="confirmLabel"
            :loading="busy"
            :disabled="busy"
            :aria-busy="busy"
            data-testid="reset-confirm"
            @click="confirm"
          />
          <UButton
            ref="cancelEl"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            :disabled="busy"
            data-testid="reset-cancel"
            @click="cancel"
          />
        </div>
      </div>
    </template>
    <template v-else>
      <p class="text-body text-muted">{{ t('settings.data.reset.body') }}</p>
      <div>
        <UButton ref="openEl" variant="soft" color="neutral" :disabled="block !== null" data-testid="data-reset-open" @click="open">
          {{ t('settings.data.reset.action') }}
        </UButton>
      </div>
      <p v-if="block" class="text-body text-muted" data-testid="data-reset-blocked">
        {{ t(`settings.data.reset.blocked.${block}`) }}
      </p>
    </template>
  </PageSheet>
</template>

<script setup lang="ts">
import SectionHeader from '~/components/ui/SectionHeader.vue'
import PageSheet from '~/components/ui/PageSheet.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppReset } from '~/composables/useAppReset'
import { useTasksStore } from '~/store/tasks'
import { isTauri } from '~/utils/isTauri'

defineOptions({ name: 'DataResetSection' })

const { t } = useI18n()
const tasksStore = useTasksStore()
const { isOpen, busy, failure, block, open, close, confirm } = useAppReset()
const desktop = isTauri()

/** The question shows while it was asked and nothing blocks replacing the data. */
const confirming = computed(() => isOpen.value && block.value === null)
const taskCount = computed(() => tasksStore.tasks.length)
/** A failed Keychain deletion turns the button into a retry: the data is already gone. */
const confirmLabel = computed(() => {
  if (busy.value) return t('settings.data.reset.working')
  return failure.value?.kind === 'tokens' ? t('settings.data.reset.retry') : t('settings.data.reset.confirm')
})
const failureText = computed(() => {
  const current = failure.value
  if (!current) return ''
  if (current.kind === 'tokens') return t('settings.data.reset.errorTokens', { entries: current.entries.join(', ') })
  return t(current.kind === 'backup' ? 'settings.data.reset.errorBackup' : 'settings.data.reset.errorWrite')
})

const cancelEl = ref<{ $el?: HTMLElement } | null>(null)
const openEl = ref<{ $el?: HTMLElement } | null>(null)

/** The safe choice holds focus, so Enter (also a repeated one from the palette) never confirms. */
async function focusCancel() {
  await nextTick()
  const button = cancelEl.value?.$el
  button?.focus({ preventScroll: true })
  button?.scrollIntoView({ block: 'center' })
}

async function cancel() {
  close()
  await nextTick()
  openEl.value?.$el?.focus()
}

watch(confirming, (now) => { if (now) void focusCancel() })
// Asked before the page mounted (the palette's command): the question is already open
onMounted(() => { if (confirming.value) void focusCancel() })
onBeforeUnmount(close)
</script>
