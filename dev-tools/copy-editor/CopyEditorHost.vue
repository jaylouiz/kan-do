<!--
@component CopyEditorHost
@description Mount point of the live copy editor (#59, dev only; `app.vue` renders it only when `__COPY_EDITOR__`).
Registers the one command-bar entry "Edit UI copy: text selection mode"; while the mode is on it shows the mode bar and
the hover outline, listens for ⌥K and Esc, runs the picker and applies saved edits to the running app through
vue-i18n, so the page shows them live.
@usage <component :is="CopyEditorHost" /> in app.vue.
@responsibility Wire mode, picker, shortcuts and live apply. Everything else sits in the bar, dialog and `edits.ts`.
-->
<template>
  <div data-kando-copy-editor-root>
    <template v-if="mode">
      <div
        v-if="hoverRect"
        data-kando-copy-editor
        aria-hidden="true"
        class="pointer-events-none fixed z-40 rounded-sm outline-2 outline-offset-1 outline-primary"
        :style="{ top: `${hoverRect.top}px`, left: `${hoverRect.left}px`, width: `${hoverRect.width}px`, height: `${hoverRect.height}px` }"
      />
      <CopyEditorBar :count="pendingEdits.length" :message="pickMessage" @search="openSearch" @publish="openPublish" @leave="leave" />
    </template>
    <CopyEditorDialog />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { closeCommandPalette } from '~/composables/useCommandPalette'
import { registerPaletteExtension } from '~/lib/paletteExtensions'
import { nestedMessage } from '~/lib/copy-editor/messages'
import CopyEditorBar from './CopyEditorBar.vue'
import CopyEditorDialog from './CopyEditorDialog.vue'
import { baseValue, dialogOpen, edits, mode, openEditor, pendingEdits, view, type Lang } from './edits'
import { hoverRect, pickMessage, startPicker } from './picker'

defineOptions({ name: 'CopyEditorHost' })

const { mergeLocaleMessage, locale } = useI18n()

const applied = new Set<string>()

/** Pushes every edit (and, for a reverted one, the original) into the running i18n messages. */
function applyEdits() {
  const keys = new Set([...applied, ...Object.keys(edits.value)])
  for (const key of keys) {
    for (const lang of ['de', 'en'] as Lang[]) {
      mergeLocaleMessage(lang, nestedMessage(key, edits.value[key]?.[lang] ?? baseValue(key, lang)))
    }
  }
  applied.clear()
  for (const key of Object.keys(edits.value)) applied.add(key)
}

function enterMode() {
  closeCommandPalette()
  mode.value = true
}
function leave() {
  mode.value = false
  dialogOpen.value = false
}
const openSearch = () => openEditor(null)
function openPublish() {
  openEditor(null)
  view.value = 'publish'
}

function onKeydown(event: KeyboardEvent) {
  if (!mode.value) return
  if (event.altKey && event.code === 'KeyK') {
    event.preventDefault()
    event.stopImmediatePropagation()
    openSearch()
  } else if (event.key === 'Escape' && !dialogOpen.value && !document.querySelector('[role="dialog"]')) {
    leave()
  }
}

let stopPicker: (() => void) | null = null
let unregister: (() => void) | null = null

onMounted(() => {
  unregister = registerPaletteExtension(() => [{
    id: 'copy-editor',
    label: 'Developer',
    items: [{ id: 'copy-editor-mode', label: 'Edit UI copy: text selection mode', icon: 'i-ph-cursor-text', onSelect: enterMode }],
  }])
  stopPicker = startPicker(keys => openEditor(keys[0] ?? null, keys), () => !mode.value || dialogOpen.value)
  window.addEventListener('keydown', onKeydown, true)
  applyEdits()
})
onBeforeUnmount(() => {
  unregister?.()
  stopPicker?.()
  window.removeEventListener('keydown', onKeydown, true)
})

watch(edits, applyEdits, { deep: true })
// A locale file loaded later replaces its messages: put the edits back on top.
watch(locale, () => setTimeout(applyEdits, 0), { flush: 'post' })
</script>
