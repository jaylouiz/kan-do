<!--
@component TopicEditorHost
@kind compound
@category overlay
@description Where the shared TopicEditor appears (#430). At >=768px a muted inline panel under the row it belongs to
(settings list row, task-sheet property row); below, a bottom drawer. Opened from inside the task sheet's drawer
(`nested`) it is a second, nested drawer: vaul scales the sheet back and its top edge stays visible above the editor
("one thing at a time"); over the settings page it is a plain drawer.
@usage `<TopicEditorHost :key="name" :topic="name" kind="topic" @close="..." @saved="..." />`; the parent re-keys by the
name and closes the host on `close` (the editor emits `saved` before `close`)
@avoid Only places the shared TopicEditor (inline panel or overlay); it holds no form of its own.
@responsibility
- Pick inline or drawer from the viewport; inside the task sheet follow the sheet's own frozen variant (#199)
- Keep the drawer open only while mounted; closing it (overlay, swipe, Escape) emits `close`
- A drawer unmounted mid-edit (the sheet closes, the viewport crosses 768px) drops the unsaved edit, nothing is saved half-way
-->
<template>
  <div v-if="desktop" class="rounded-lg bg-muted/60 p-4" data-testid="topic-editor-inline">
    <TopicEditor :topic="topic" :kind="kind" @close="emit('close')" @saved="(name: string) => emit('saved', name)" />
  </div>
  <UDrawer
    v-else
    :open="true"
    direction="bottom"
    :nested="nested"
    :title="t(kind === 'topic' ? 'topic.editor.titleTopic' : 'topic.editor.titleActivity')"
    :description="topic"
    :ui="{ overlay: 'bg-inverted/40', content: 'topic-editor-drawer', header: 'px-4 pb-1', description: 'sr-only' }"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <template #body>
      <div class="px-1 pb-2" data-testid="topic-editor-drawer">
        <TopicEditor :topic="topic" :kind="kind" @close="emit('close')" @saved="(name: string) => emit('saved', name)" />
      </div>
    </template>
  </UDrawer>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import TopicEditor from '~/components/topic/TopicEditor.vue'
import { useOverlayIsDesktop } from '~/composables/useIsDesktop'
import type { NameKind } from '~/lib/topicNames'

defineOptions({ name: 'TopicEditorHost' })

withDefaults(defineProps<{ topic: string; kind?: NameKind; nested?: boolean }>(), { kind: 'topic', nested: false })
const emit = defineEmits<{ close: []; saved: [name: string] }>()

const { t } = useI18n()

// Inside the task sheet the sheet's frozen variant decides, so a resize while open cannot disagree with its layout
const desktop = useOverlayIsDesktop()
</script>

<style>
.topic-editor-drawer {
  max-height: 78dvh;
}
</style>
