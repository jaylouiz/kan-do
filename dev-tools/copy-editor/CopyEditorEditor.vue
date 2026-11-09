<!--
@component CopyEditorEditor
@description The editor pane of the live copy editor (#59, dev only): the designer writes one language (DE or EN),
the other is translated by the agent at Publish or written by hand. Shows what blocks a save (decided terms,
placeholder mismatch) and what only warns (proposed terms).
@usage Right pane of CopyEditorDialog for one i18n key.
@responsibility Local form state for one key; saving and reverting go through `edits.ts`. No network.
-->
<template>
  <form class="flex flex-col gap-3 p-4" data-testid="copy-editor-form" @submit.prevent="save">
    <p class="font-mono text-xs break-all text-muted" data-testid="copy-editor-key">{{ keyName }}</p>

    <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Language you write">
      <span class="text-sm text-muted">You write</span>
      <UButton
        v-for="lang in LANGS"
        :key="lang"
        type="button"
        size="xs"
        color="neutral"
        :variant="written === lang ? 'solid' : 'outline'"
        :aria-pressed="written === lang"
        :data-testid="`copy-editor-write-${lang}`"
        @click="switchWritten(lang)"
      >
        {{ lang.toUpperCase() }}
      </UButton>
    </div>

    <UFormField :label="written.toUpperCase()" :hint="`Was: ${baseValue(keyName, written)}`">
      <UTextarea v-model="text" :rows="3" autoresize class="w-full" data-testid="copy-editor-text" @keydown.meta.enter.prevent="save" @keydown.ctrl.enter.prevent="save" />
    </UFormField>

    <div class="flex flex-col gap-2 rounded-lg bg-muted p-3" data-testid="copy-editor-other">
      <template v-if="otherKind === 'self'">
        <UFormField :label="second.toUpperCase()" :hint="`Was: ${baseValue(keyName, second)}`">
          <UTextarea v-model="otherText" :rows="3" autoresize class="w-full" :data-testid="`copy-editor-other-text`" />
        </UFormField>
        <UButton type="button" size="xs" color="neutral" variant="link" class="self-start" @click="otherKind = 'agent'">Let the agent translate {{ second.toUpperCase() }}</UButton>
      </template>
      <template v-else>
        <p class="text-sm" data-testid="copy-editor-agent">
          <span class="font-medium">{{ second.toUpperCase() }}</span> · {{ entry?.other === 'draft' ? 'agent draft, review it under Publish' : 'agent translates at Publish' }}
        </p>
        <p v-if="entry?.other === 'draft'" class="text-sm text-default" data-private>{{ currentValue(keyName, second) }}</p>
        <p v-else class="text-sm text-muted">Now: {{ baseValue(keyName, second) }}</p>
        <ul v-if="entry?.draftProblems?.length" class="list-disc pl-5 text-sm text-error">
          <li v-for="problem in entry.draftProblems" :key="problem">Draft rejected: {{ problem }}</li>
        </ul>
        <UButton type="button" size="xs" color="neutral" variant="link" class="self-start" :data-testid="`copy-editor-write-other`" @click="writeOtherMyself">Write {{ second.toUpperCase() }} myself</UButton>
      </template>
    </div>

    <UAlert v-if="check.blocking.length" color="error" variant="subtle" icon="i-ph-warning-circle" title="Cannot save" data-testid="copy-editor-blocking">
      <template #description>
        <ul class="list-disc pl-4"><li v-for="message in check.blocking" :key="message">{{ message }}</li></ul>
      </template>
    </UAlert>
    <UAlert v-if="check.warnings.length" color="warning" variant="subtle" icon="i-ph-warning" title="Heads up" data-testid="copy-editor-warning">
      <template #description>
        <ul class="list-disc pl-4"><li v-for="message in check.warnings" :key="message">{{ message }}</li></ul>
      </template>
    </UAlert>

    <div class="flex flex-wrap items-center gap-2">
      <UButton type="submit" color="primary" data-testid="copy-editor-save">Save edit</UButton>
      <UButton v-if="entry" type="button" color="neutral" variant="outline" data-testid="copy-editor-revert" @click="revert">Revert</UButton>
      <p v-if="savedNote" role="status" class="text-sm text-muted">{{ savedNote }}</p>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { baseValue, checkText, currentValue, edits, otherLang, revertEdit, saveEdit, type Lang } from './edits'

defineOptions({ name: 'CopyEditorEditor' })

const props = defineProps<{ keyName: string }>()

const LANGS: Lang[] = ['de', 'en']
const entry = computed(() => edits.value[props.keyName])

const written = ref<Lang>('de')
const text = ref('')
const otherKind = ref<'agent' | 'self'>('agent')
const otherText = ref('')
const savedNote = ref('')
const second = computed(() => otherLang(written.value))

/** A fresh form for the key: the saved edit when there is one, else the German text with the agent on English. */
function reset() {
  const saved = entry.value
  written.value = saved?.written ?? 'de'
  text.value = currentValue(props.keyName, written.value)
  otherKind.value = saved?.other === 'self' ? 'self' : 'agent'
  otherText.value = currentValue(props.keyName, otherLang(written.value))
  savedNote.value = ''
}
watch(() => props.keyName, reset, { immediate: true })

function switchWritten(lang: Lang) {
  written.value = lang
  text.value = currentValue(props.keyName, lang)
  otherKind.value = 'agent'
  otherText.value = currentValue(props.keyName, otherLang(lang))
  savedNote.value = ''
}

function writeOtherMyself() {
  otherText.value = currentValue(props.keyName, second.value)
  otherKind.value = 'self'
}

/** The live check of what is typed; the save itself runs the same rules again. */
const check = computed(() => {
  const own = checkText(props.keyName, written.value, text.value, otherKind.value === 'self' ? otherText.value : undefined)
  if (otherKind.value !== 'self') return own
  const theirs = checkText(props.keyName, second.value, otherText.value, text.value)
  return { blocking: [...own.blocking, ...theirs.blocking.map(m => `${second.value}: ${m}`)], warnings: [...own.warnings, ...theirs.warnings] }
})

function save() {
  const result = saveEdit({
    key: props.keyName,
    written: written.value,
    text: text.value,
    other: otherKind.value === 'self' ? { kind: 'self', text: otherText.value } : { kind: 'agent' },
  })
  savedNote.value = result.blocking.length ? '' : (edits.value[props.keyName] ? 'Saved. The app shows it now.' : 'Back to the original.')
}

function revert() {
  revertEdit(props.keyName)
  reset()
  savedNote.value = 'Reverted.'
}
</script>
