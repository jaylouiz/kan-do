<!--
@component CopyEditorBar
@description The mode bar of the live copy editor (#59, dev only): status line, Copy (⌥K), the Publish entry with the
number of collected edits, and Leave (Esc). Bottom centre on desktop; wraps at 390px.
@usage Rendered by CopyEditorHost while text selection mode is on.
@responsibility Show the mode and its three actions. No state of its own: the host passes the handlers.
-->
<template>
  <section
    data-kando-copy-editor
    aria-label="UI copy editor"
    class="fixed inset-x-4 bottom-4 z-40 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-default bg-elevated px-3 py-2 shadow-lg"
  >
    <p role="status" class="text-sm text-default">
      {{ message || 'Text selection mode · click any outlined text' }}
    </p>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <UButton size="sm" color="neutral" variant="outline" icon="i-ph-magnifying-glass" aria-keyshortcuts="Alt+K" data-testid="copy-editor-search" @click="emit('search')">
        Copy <UKbd value="alt" size="md" /><UKbd value="K" size="md" />
      </UButton>
      <UButton size="sm" color="neutral" variant="outline" icon="i-ph-git-pull-request" data-testid="copy-editor-publish" @click="emit('publish')">
        Publish as PR<span v-if="count > 0"> · {{ count }}</span>
      </UButton>
      <UButton size="sm" color="neutral" variant="ghost" :icon="ICONS.close" aria-keyshortcuts="Escape" data-testid="copy-editor-leave" @click="emit('leave')">
        Leave <UKbd value="escape" size="md" />
      </UButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
defineOptions({ name: 'CopyEditorBar' })

defineProps<{
  /** Edits not yet in a PR. */
  count: number
  /** A one-off line that replaces the hint (for example "No UI copy here"). */
  message: string
}>()

const emit = defineEmits<{ search: [], publish: [], leave: [] }>()
</script>
