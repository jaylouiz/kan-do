<!--
@component CommandPalette
@kind component
@category navigation
@description Cmd/Ctrl+K command palette: app-wide commands in four groups (Aktionen, Gehe zu, Daten & Speicher, and on desktop App;
#234) plus actions for the card that held keyboard focus when the palette opened (issue #101, Direction B; on every page since #224).
The row that would navigate to the page the user is already on is left out (`buildCommandGroups`, `currentPath`).
@usage Mounted once in app.vue while the app bar shows (not on /welcome); open with Cmd/Ctrl+K or the ⋯ panel's "Befehle". Desktop/keyboard only (no entry point on mobile).
@avoid Not for pointer navigation (AppNav, MorePanel); desktop and keyboard only, there is no entry point on a phone.
@responsibility
- Render UCommandPalette inside UModal; Esc closes and focus returns to the card
- Show the shortcut hints of the commands (`kbds`) and the palette's own keys in the footer
- The "focus a task with Tab" hint only on the board, the one place a card can have focus
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
          <EmptyNote role="status" class="px-4 py-6">
            {{ t('commandPalette.empty', { term: searchTerm }) }}
          </EmptyNote>
        </template>
        <template #footer>
          <p v-if="onBoard && !hasCard" class="px-3 pt-2 text-xs text-muted">
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
import EmptyNote from '~/components/ui/EmptyNote.vue'
import { useTasksStore } from '~/store/tasks'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { useAppNav } from '~/composables/useAppNav'

defineOptions({ name: 'CommandPalette' })

const { t } = useI18n()
const tasksStore = useTasksStore()

const { onBoard } = useAppNav()
const { isOpen, groups, hasCard, open, restoreFocus } = useCommandPalette()

// Not usingInput: the shortcut stays silent while typing in fields. Desktop keyboards only.
// Nuxt UI maps `meta_k` to Ctrl+K off macOS (Cmd+K on macOS); the explicit `ctrl_k` also gives macOS a Ctrl+K (kd#23).
defineShortcuts({ meta_k: open, ctrl_k: open })

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
  label: 'text-base font-semibold text-muted px-3 pt-3 pb-1',
  // The stock highlight (bg-elevated/50) is invisible on the bg-elevated (white) modal, and so is bg-muted (~1.07:1); use the
  // canvas fill's hover step, the same warm tint as every other state fill (main.css `--fill-on-canvas-hover`).
  // Disabled rows keep full opacity so the reason suffix stays AA; only the label is dimmed.
  item: 'min-h-9 px-3 py-2 text-sm before:rounded-lg data-disabled:opacity-100 data-highlighted:not-data-disabled:before:bg-(--fill-on-canvas-hover)',
  itemLabelBase: 'group-data-disabled:text-dimmed',
  itemLeadingIcon: 'group-data-disabled:text-dimmed',
  itemLabelSuffix: 'text-muted',
}
</script>
