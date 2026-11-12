<!--
@page TrashPage
@description The full trash (#422): every deleted task as the board's own card, grouped Heute / Gestern / Früher, with "Wiederherstellen" and remove-forever per entry and "Papierkorb leeren" on top
@usage Route /trash, reached from the "Papierkorb" row in the Mehr panel (sub-page layout; leave it with the browser back or the app bar, no back arrow since #470)
@responsibility
- One entry per row (card, then meta and actions beside it or below at 390px), full width at 390
- One 672 px column centred on the app bar's axis (`pageWidth: 'narrow'`, the sub-page layout owns it, #673)
- The retention line and "Papierkorb leeren" are one flat note on the page (a neutral UAlert, kd#217): secondary to the entries, so no sheet and no shadow. Emptying is irreversible and confirms in place (the note turns into the question), no dialog
- Reached with an empty trash it shows the page empty state (EmptyState, kd#106): the trash icon, "Noch keine gelöschten Aufgaben." and the subline that deleted tasks can be restored here; the note shows only with entries (a rule about nothing is noise)
- No visible page header (#670): the app bar's third segment reads "Papierkorb"; the layout keeps the title as an sr-only h1
- The empty-trash question moves focus to "Abbrechen"; Esc cancels and returns focus to "Papierkorb leeren" (kd#21)
- Focus: when the focused entry leaves, focus goes to the page heading
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <div class="space-y-10" data-testid="trash-page">
        <section aria-labelledby="trash-heading">
          <h2 id="trash-heading" ref="headingEl" tabindex="-1" class="sr-only">{{ t('trash.listHeading') }}</h2>
          <PageSheet v-if="count === 0">
            <EmptyState icon="i-ph-trash-light" :subline="t('trash.emptyHint')" data-testid="trash-empty-state">
              {{ t('trash.empty') }}
            </EmptyState>
          </PageSheet>
          <!-- The retention rule and "Papierkorb leeren" are secondary to the entries: a flat note on the page, no sheet (kd#217) -->
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-ph-info"
            class="items-center py-3 ring-0"
            data-testid="trash-note"
            @keydown.esc.stop="confirming && cancelEmpty()"
          >
            <!-- The action follows the line, not the note's far edge past a dead strip (#683) -->
            <template #description>
              <div v-if="confirming" class="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p class="text-default" role="alert">{{ t('trash.emptyConfirm', { n: count }, count) }}</p>
                <span class="flex flex-wrap items-center gap-2">
                  <UButton color="error" variant="soft" data-testid="trash-empty-confirm" @click="confirmEmpty">
                    {{ t('trash.emptyConfirmYes') }}
                  </UButton>
                  <UButton ref="cancelEl" color="neutral" variant="ghost" data-testid="trash-empty-cancel" @click="cancelEmpty">
                    {{ t('common.cancel') }}
                  </UButton>
                </span>
              </div>
              <div v-else class="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p>{{ t('trash.retention') }}</p>
                <UButton ref="emptyEl" color="neutral" variant="soft" data-testid="trash-empty" @click="openEmpty">
                  {{ t('trash.emptyTrash') }}
                </UButton>
              </div>
            </template>
          </UAlert>
        </section>

        <section v-for="group in groups" :key="group.group" class="space-y-4" :data-testid="`trash-group-${group.group}`">
          <SectionHeader tag="h3">{{ t(`trash.groups.${group.group}`) }}</SectionHeader>
          <div class="trash-grid">
            <TrashEntryRow
              v-for="entry in group.entries"
              :key="entry.taskId"
              :entry="entry"
              forever
              @restore="restore"
              @remove="remove"
            />
          </div>
        </section>
      </div>
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import PageSheet from '~/components/ui/PageSheet.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '~/components/ui/EmptyState.vue'
import TrashEntryRow from '~/components/trash/TrashEntryRow.vue'
import { useTrash } from '~/composables/useTrash'

defineOptions({ name: 'TrashPage' })

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  titleKey: 'trash.title',
  pageHeader: false, // the app bar's third segment reads "Papierkorb" (#670)
})

const { t } = useI18n()
const { count, groups, restoreFromTrash, removeForever, emptyTrash } = useTrash()
const confirming = ref(false)
const headingEl = ref<HTMLElement | null>(null)
const cancelEl = ref<{ $el: HTMLElement } | null>(null)
const emptyEl = ref<{ $el: HTMLElement } | null>(null)

/** The empty-trash question (kd#21): focus lands on "Abbrechen"; Esc and Abbrechen hand it back to "Papierkorb leeren". */
const openEmpty = async () => {
  confirming.value = true
  await nextTick()
  cancelEl.value?.$el.focus()
}
const cancelEmpty = async () => {
  confirming.value = false
  await nextTick()
  emptyEl.value?.$el.focus()
}

/** The focused entry is leaving the page: focus goes to the heading instead of falling to <body>. */
const keepFocus = async () => {
  await nextTick()
  const active = document.activeElement
  if (!active || active === document.body || !active.isConnected) headingEl.value?.focus({ preventScroll: true })
}

const restore = async (taskId: string) => {
  await restoreFromTrash(taskId)
  await keepFocus()
}

const remove = async (taskId: string) => {
  removeForever(taskId)
  await keepFocus()
}

const confirmEmpty = async () => {
  emptyTrash()
  confirming.value = false
  await keepFocus()
}
</script>

<style scoped>
.trash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 31rem), 1fr));
  gap: 1.5rem 2rem;
}
</style>
