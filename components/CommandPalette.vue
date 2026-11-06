<!--
@component CommandPalette
@description Cmd/Ctrl+K command palette: board-wide commands plus actions for the card that held
keyboard focus when the palette opened (issue #101, Direction B).
@usage Mounted once in pages/tasks.vue; open with Cmd/Ctrl+K. Desktop/keyboard only (no entry point on mobile).
@responsibility
- Render UCommandPalette inside UModal; Esc closes and focus returns to the card
- Show the shortcut hints of the commands (`kbds`) and the palette's own keys in the footer
- Empty and loading states; screen-reader result status via role="status"
-->
<template>
  <UModal
    v-model:open="isOpen"
    :title="t('commandPalette.title')"
    :description="t('commandPalette.description')"
    :ui="modalUi"
    @after:leave="restoreFocus"
  >
    <template #content>
      <UCommandPalette
        :groups="groups"
        :loading="tasksStore.isLoading"
        :placeholder="t('commandPalette.placeholder')"
        :back="false"
        :ui="paletteUi"
        :fuse="fuseOptions"
        class="max-h-144"
        @update:open="isOpen = $event"
      >
        <template #empty="{ searchTerm }">
          <p role="status" class="px-4 py-6 text-sm text-muted">
            {{ t('commandPalette.empty', { term: searchTerm }) }}
          </p>
        </template>
        <template #footer>
          <p v-if="!hasCard" class="px-3 pt-2 text-xs text-muted">
            {{ t('commandPalette.noCardHint') }}
          </p>
          <div class="flex items-center gap-4 px-3 py-2 text-xs text-muted">
            <span class="inline-flex items-center gap-1">
              <UKbd value="arrowup" /><UKbd value="arrowdown" />
              {{ t('commandPalette.hintNavigate') }}
            </span>
            <span class="inline-flex items-center gap-1">
              <UKbd value="enter" />
              {{ t('commandPalette.hintRun') }}
            </span>
            <span class="inline-flex items-center gap-1">
              <UKbd value="escape" />
              {{ t('commandPalette.hintClose') }}
            </span>
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '~/store/tasks'
import { useCommandPalette } from '~/composables/useCommandPalette'

defineOptions({ name: 'CommandPalette' })

const emit = defineEmits<{
  openStatistics: []
  openSettings: []
}>()

const { t } = useI18n()
const tasksStore = useTasksStore()

const { isOpen, groups, hasCard, open, restoreFocus } = useCommandPalette({
  openStatistics: () => emit('openStatistics'),
  openSettings: () => emit('openSettings'),
})

// Not usingInput: the shortcut stays silent while typing in fields. Desktop keyboards only.
defineShortcuts({ meta_k: open })

const modalUi = {
  content: 'sm:top-20 sm:translate-y-0 sm:max-w-xl overflow-hidden',
}
// Variant B "Quiet Desk" (chosen over stock A and dense C, see PR): display-role group headings like the
// column names, no hard dividers between groups, suffix in Graphite (text-muted) for AA contrast.
// Replaces Nuxt UI's defaults wholesale, so repeat them (strict threshold keeps "erledigt" off the Wartet row).
const fuseOptions = {
  fuseOptions: { ignoreLocation: true, threshold: 0.1, keys: ['label', 'description', 'suffix'] },
  resultLimit: 30,
  matchAllWhenSearchEmpty: true,
}

const paletteUi = {
  root: 'divide-default/40',
  viewport: 'divide-y-0 p-2 mask-b-from-92%',
  group: 'p-0 pb-3',
  label: 'font-display text-base text-muted px-3 pt-3 pb-1',
  // The stock highlight (bg-elevated/50) is invisible on the bg-elevated modal; use Rule Line (bg-muted).
  // Disabled rows keep full opacity so the reason suffix stays AA; only the label is dimmed.
  item: 'px-3 py-2 text-sm before:rounded-lg data-disabled:opacity-100 data-highlighted:not-data-disabled:before:bg-muted',
  itemLabelBase: 'group-data-disabled:text-dimmed',
  itemLeadingIcon: 'group-data-disabled:text-dimmed',
  itemLabelSuffix: 'text-muted',
}
</script>
