<!--
@component CopyEditorDialog
@description The two-pane dialog of the live copy editor (#59, dev only), aligned with CommandPalette (search-first
list): left a search over every i18n key in both languages (also copy that is not on screen), right the editor for
the chosen key or the Publish review. At 390px the panes stack, the editor below the list (a bottom sheet in effect).
@usage Rendered by CopyEditorHost; open state, view and selection live in `edits.ts`.
@responsibility Layout, key search and the choice between keys that share a text. Editing and publishing are the panes' job.
-->
<template>
  <UModal
    v-model:open="dialogOpen"
    title="Edit UI copy"
    description="Search every UI text in German and English, edit one language, publish as a pull request."
    :ui="{ content: 'sm:max-w-4xl max-h-dvh overflow-hidden' }"
  >
    <template #content>
      <div data-kando-copy-editor class="flex max-h-dvh flex-col" data-testid="copy-editor-dialog">
        <div class="flex items-center gap-2 border-b border-default px-4 py-2">
          <p class="font-display text-base">Edit UI copy</p>
          <div class="ml-auto flex items-center gap-1" role="group" aria-label="View">
            <UButton size="xs" color="neutral" :variant="view === 'edit' ? 'solid' : 'ghost'" :aria-pressed="view === 'edit'" @click="view = 'edit'">Edit</UButton>
            <UButton size="xs" color="neutral" :variant="view === 'publish' ? 'solid' : 'ghost'" :aria-pressed="view === 'publish'" data-testid="copy-editor-tab-publish" @click="view = 'publish'">
              Publish<span v-if="pendingEdits.length"> · {{ pendingEdits.length }}</span>
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :icon="ICONS.close" aria-label="Close" @click="dialogOpen = false" />
          </div>
        </div>
        <div class="flex min-h-0 flex-1 flex-col md:flex-row">
          <div v-show="view === 'edit'" class="flex max-h-72 min-h-0 flex-col border-default md:max-h-none md:w-1/2 md:border-r" :class="{ 'max-md:hidden': selectedKey }">
            <p v-if="choices.length" class="px-4 pt-3 text-sm text-muted" data-testid="copy-editor-choices-hint">This text comes from {{ choices.length }} keys. Choose one:</p>
            <UCommandPalette
              :groups="groups"
              placeholder="Search keys and text in DE and EN"
              :back="false"
              :fuse="fuseOptions"
              class="min-h-0 flex-1"
              :ui="{ root: 'divide-default/40', viewport: 'p-2', itemLabelSuffix: 'text-muted' }"
              data-testid="copy-editor-search-list"
            >
              <template #empty="{ searchTerm }">
                <p role="status" class="px-4 py-6 text-sm text-muted">No key or text matches “{{ searchTerm }}”.</p>
              </template>
            </UCommandPalette>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto md:min-h-96">
            <!-- 390px: once a key is chosen the list gives way to the editor; this brings it back -->
            <UButton v-if="view === 'edit' && selectedKey" type="button" size="xs" color="neutral" variant="link" :icon="ICONS.back" class="mx-4 mt-3 md:hidden" data-testid="copy-editor-all-keys" @click="showList">All keys</UButton>
            <CopyEditorPublish v-if="view === 'publish'" />
            <CopyEditorEditor v-else-if="selectedKey" :key-name="selectedKey" />
            <p v-else class="p-4 text-sm text-muted" data-testid="copy-editor-empty">Choose a key on the left, or click outlined text on the page.</p>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed } from 'vue'
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import CopyEditorEditor from './CopyEditorEditor.vue'
import CopyEditorPublish from './CopyEditorPublish.vue'
import { ALL_KEYS, choices, currentValue, dialogOpen, edits, pendingEdits, selectedKey, view } from './edits'

defineOptions({ name: 'CopyEditorDialog' })

const showList = () => { selectedKey.value = null }

const fuseOptions = {
  fuseOptions: { ignoreLocation: true, threshold: 0.2, keys: ['label', 'description', 'suffix'] },
  resultLimit: 60,
  matchAllWhenSearchEmpty: true,
}

const item = (key: string): CommandPaletteItem => ({
  id: key,
  label: currentValue(key, 'de'),
  suffix: currentValue(key, 'en'),
  description: key,
  // The key being edited carries a check, an already edited one a pencil.
  icon: key === selectedKey.value ? 'i-ph-check' : edits.value[key] ? 'i-ph-pencil-simple' : undefined,
  onSelect: () => { selectedKey.value = key; view.value = 'edit' },
})

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  // After a pick that matched several keys the list shows only those; the search field still reaches all keys.
  const all = choices.value.length ? choices.value : ALL_KEYS
  // The chosen key leads the list, so a pick from the page and the list read as one thing.
  const keys = selectedKey.value && all.includes(selectedKey.value) ? [selectedKey.value, ...all.filter(key => key !== selectedKey.value)] : all
  return [{ id: 'keys', label: choices.value.length ? 'Keys of this text' : `${ALL_KEYS.length} keys`, items: keys.map(item) }]
})
</script>
