<!--
@component TopicEditor
@kind component
@category form-structure
@description The one editor every entry point opens (#430, #431): Name, Farbe (nine hues plus none, radio swatches) and
Symbol (a button showing the current mark; a popover with 24 glyphs plus none). An activity has the Name only. A name a
source owns (Notion schema or any non-Local task) is disabled with the reason; Farbe and Symbol stay editable and say they
apply only in kan-do. A new name that already exists merges into it and the target's style stays. Saving is local and
immediate: no loading or error state.
@usage Hosted by TopicEditorHost (settings list row, task-sheet picker edit mode)
@avoid The one topic editor, hosted by TopicEditorHost; never a second editor for the same job.
@responsibility
- Save through `useTopicManagement().rename` (every store, one pass) and `useTopicStylesStore().setStyle`
- Name is trimmed; an empty name or nothing changed cannot be saved; the editor closes after saving
- The key of the editor is the *name*: the host re-keys after a rename instead of editing the old name
- Focus starts in the Name (the first colour when the name is gated); Escape closes the editor only (the task sheet vetoes its own dismissal, `data-topic-editor`)
- Hue and symbol groups are `role="radiogroup"` with arrow keys; the symbol popover closes on pick or Escape and keeps the editor open
@accessibility The gate hint is `aria-describedby` of the disabled Name, the merge note is `role="status"`
-->
<template>
  <form class="space-y-4" data-testid="topic-editor" data-topic-editor @submit.prevent="onSave" @keydown.esc.stop.prevent="emit('close')">
    <div class="space-y-1.5">
      <label :for="nameId" class="block text-xs font-medium text-muted">{{ t('topic.editor.name') }}</label>
      <UInput
        :id="nameId"
        ref="nameInput"
        v-model="name"
        class="w-full"
        size="md"
        :disabled="nameLocked"
        :aria-describedby="nameLocked ? gateId : undefined"
        autocomplete="off"
        data-private
        data-testid="topic-name-input"
      />
      <p v-if="nameLocked" :id="gateId" class="flex items-start gap-1.5 text-sm text-muted" data-testid="topic-name-gate">
        <UIcon name="i-ph-cloud" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{{ t('topic.editor.nameGate') }}</span>
      </p>
      <p v-else-if="mergeWith" class="text-sm text-muted" role="status" data-testid="topic-merge-note" data-private>
        {{ t(kind === 'topic' ? 'topic.editor.mergeTopic' : 'topic.editor.mergeActivity', { name: mergeWith }) }}
      </p>
    </div>

    <template v-if="kind === 'topic'">
      <fieldset class="space-y-1.5">
        <legend class="mb-1.5 text-xs font-medium text-muted">{{ t('topic.editor.color') }}</legend>
        <div role="radiogroup" :aria-label="t('topic.editor.color')" class="flex flex-wrap gap-1.5" data-testid="topic-hue-group">
          <button
            v-for="(option, index) in hueOptions"
            :key="option.key ?? 'none'"
            :ref="(el) => setHueRef(el, index)"
            type="button"
            role="radio"
            class="topic-swatch"
            :aria-checked="hue === option.key"
            :aria-label="option.label"
            :tabindex="hueTabbable === index ? 0 : -1"
            :data-testid="`topic-hue-${option.key ?? 'none'}`"
            @click="hue = option.key"
            @keydown="(event) => onHueKey(event)"
          >
            <span v-if="option.key" class="topic-swatch__dot" :style="{ backgroundColor: `var(--topic-${option.key})` }" />
            <span v-else class="topic-swatch__dot topic-swatch__dot--none"><UIcon name="i-ph-prohibit" class="size-3" /></span>
          </button>
        </div>
        <p v-if="notionHue && hue === null" class="text-sm text-muted" data-testid="topic-color-hint">
          {{ t('topic.editor.colorInherited', { hue: hueLabel(notionHue) }) }}
        </p>
        <p v-else-if="notionHue && hue !== notionHue" class="text-sm text-muted" data-testid="topic-color-hint">
          {{ t('topic.editor.colorLocalOnly', { hue: hueLabel(notionHue) }) }}
        </p>
      </fieldset>

      <div class="space-y-1.5">
        <span class="block text-xs font-medium text-muted">{{ t('topic.editor.symbol') }}</span>
        <UPopover v-model:open="pickerOpen" :content="{ side: 'bottom', align: 'start', sideOffset: 6 }" :ui="{ content: 'w-64 p-2' }">
          <button
            type="button"
            class="topic-symbol-trigger"
            :aria-label="t('topic.editor.symbolButton', { value: symbolLabel })"
            aria-haspopup="dialog"
            data-testid="topic-symbol-trigger"
          >
            <span class="topic-symbol-well">
              <TopicMark v-if="effectiveHue || symbol" :hue="effectiveHue" :symbol="symbol" />
              <span v-else class="topic-symbol-empty" aria-hidden="true" />
            </span>
            <span class="text-sm" aria-hidden="true">{{ symbolLabel }}</span>
            <UIcon name="i-ph-caret-down" class="size-4 text-muted" aria-hidden="true" />
          </button>
          <template #content>
            <div role="radiogroup" :aria-label="t('topic.editor.symbol')" class="topic-symbol-grid" data-testid="topic-symbol-group">
              <button
                v-for="(option, index) in symbolOptions"
                :key="option.key ?? 'none'"
                :ref="(el) => setSymbolRef(el, index)"
                type="button"
                role="radio"
                class="topic-symbol-option"
                :aria-checked="symbol === option.key"
                :aria-label="option.label"
                :tabindex="symbolTabbable === index ? 0 : -1"
                :data-testid="`topic-symbol-${option.key ?? 'none'}`"
                @click="pickSymbol(option.key)"
                @keydown="(event) => onSymbolKey(event)"
              >
                <TopicMark v-if="option.key" :hue="effectiveHue" :symbol="option.key" />
                <span v-else class="topic-symbol-empty" aria-hidden="true" />
              </button>
            </div>
          </template>
        </UPopover>
      </div>
    </template>

    <p class="text-sm text-muted" data-testid="topic-editor-count">{{ countLine }}</p>

    <div class="flex items-center justify-end gap-2">
      <UButton type="button" color="neutral" variant="ghost" :label="t('topic.editor.cancel')" data-testid="topic-cancel" @click="emit('close')" />
      <UButton
        size="lg"
        type="submit"
        color="primary"
        :disabled="!canSave"
        :label="mergeWith ? t('topic.editor.merge') : t('topic.editor.save')"
        data-testid="topic-save"
      />
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TopicMark from '~/components/topic/TopicMark.vue'
import { useTopicColor } from '~/composables/useTopicColor'
import { useTopicManagement } from '~/composables/useTopicManagement'
import { useTopicStylesStore } from '~/store/topicStyles'
import { HUES, TOPIC_SYMBOLS, symbolOf, type TopicHue } from '~/lib/topicStyles'
import { renameVerdict, trimName, type NameKind } from '~/lib/topicNames'
import { onRadioKeydown } from '~/utils/radioArrowKeys'

defineOptions({ name: 'TopicEditor' })

const props = withDefaults(defineProps<{ topic: string; kind?: NameKind }>(), { kind: 'topic' })
const emit = defineEmits<{ close: []; saved: [name: string] }>()

const { t } = useI18n()
const management = useTopicManagement()
const styles = useTopicStylesStore()
const { sourceHueOf } = useTopicColor()
const nameId = useId()
const gateId = useId()

const start = styles.styleOf(props.topic)
const name = ref(props.topic)
const hue = ref<TopicHue | null>(start.hue)
const symbol = ref<string | null>(start.symbol)
const pickerOpen = ref(false)
const nameInput = ref<{ inputRef?: HTMLInputElement | null } | null>(null)

const nameLocked = computed(() => management.isSourceOwned(props.kind, props.topic))
const nameChanged = computed(() => !nameLocked.value && renameVerdict(props.topic, name.value) === 'ok')
const mergeWith = computed(() => (nameChanged.value ? management.mergeTarget(props.kind, props.topic, name.value) : null))
const inheritedHue = computed(() => (props.kind === 'topic' ? sourceHueOf(props.topic) : null))
const effectiveHue = computed(() => hue.value ?? inheritedHue.value)
// The Notion hints only for a name Notion owns: its colour is what "keine" returns to
const notionHue = computed(() => (nameLocked.value ? inheritedHue.value : null))
const count = computed(() => management.countOf(props.kind, props.topic))
const styleChanged = computed(() => props.kind === 'topic' && (hue.value !== start.hue || symbol.value !== start.symbol))
const dirty = computed(() => nameChanged.value || (!mergeWith.value && styleChanged.value))
const canSave = computed(() => dirty.value && (nameLocked.value || trimName(name.value) !== ''))

/** How far the edit reaches, plus (topics) that colour and symbol stay in kan-do. */
const countLine = computed(() => {
  const reach = count.value === 0
    ? t(props.kind === 'topic' ? 'topic.editor.unusedTopic' : 'topic.editor.unusedActivity')
    : `${t(nameChanged.value ? 'topic.editor.appliesToAll' : 'topic.editor.appliesTo', { n: count.value }, count.value)}.`
  return props.kind === 'topic' ? `${reach} ${t('topic.editor.stayLocal')}` : reach
})

const hueLabel = (key: TopicHue) => t(`topic.hue.${key}`)
const hueOptions = computed(() => [
  { key: null as TopicHue | null, label: t('topic.editor.colorNone') },
  ...HUES.map(key => ({ key: key as TopicHue | null, label: hueLabel(key) })),
])
const symbolOptions = computed(() => [
  { key: null as string | null, label: t('topic.editor.symbolNone') },
  ...TOPIC_SYMBOLS.map(item => ({ key: item.key as string | null, label: t(item.labelKey) })),
])
const symbolLabel = computed(() => {
  const current = symbolOf(symbol.value)
  return current ? t(current.labelKey) : t('topic.editor.symbolNone')
})

// Roving tabindex: the selected radio (else the first) is the one Tab stops on; arrows move and select.
const hueTabbable = computed(() => Math.max(0, hueOptions.value.findIndex(option => option.key === hue.value)))
const symbolTabbable = computed(() => Math.max(0, symbolOptions.value.findIndex(option => option.key === symbol.value)))
const hueRefs: HTMLElement[] = []
const symbolRefs: HTMLElement[] = []
const setHueRef = (el: unknown, index: number) => { if (el instanceof HTMLElement) hueRefs[index] = el }
const setSymbolRef = (el: unknown, index: number) => { if (el instanceof HTMLElement) symbolRefs[index] = el }

function onHueKey(event: KeyboardEvent) {
  const next = onRadioKeydown(event, hueRefs)
  if (next !== null) hue.value = hueOptions.value[next]?.key ?? null
}

function onSymbolKey(event: KeyboardEvent) {
  const next = onRadioKeydown(event, symbolRefs, 5)
  if (next !== null) symbol.value = symbolOptions.value[next]?.key ?? null
}

function pickSymbol(key: string | null) {
  symbol.value = key
  pickerOpen.value = false
}

// Focus the selected glyph when the popover opens, so the arrow keys work at once
watch(pickerOpen, async (open) => {
  if (!open) return
  await nextTick()
  symbolRefs[symbolTabbable.value]?.focus()
})

// The editor takes focus where the edit starts: the Name, or the first colour when Notion owns the name
onMounted(() => {
  void nextTick(() => requestAnimationFrame(() => {
    if (!nameLocked.value) nameInput.value?.inputRef?.focus({ preventScroll: true })
    else hueRefs[hueTabbable.value]?.focus({ preventScroll: true })
  }))
})

function onSave() {
  if (!canSave.value) return
  let finalName = props.topic
  if (nameChanged.value) {
    const result = management.rename(props.kind, props.topic, name.value)
    if (!result.ok) return
    finalName = result.name
    // A merge keeps the target's colour and symbol; a plain rename already moved ours to the new name
    if (props.kind === 'topic' && !result.merged && styleChanged.value) styles.setStyle(finalName, { hue: hue.value, symbol: symbol.value })
  } else if (styleChanged.value) {
    styles.setStyle(finalName, { hue: hue.value, symbol: symbol.value })
  }
  emit('saved', finalName)
  emit('close')
}
</script>

<style scoped>
/* Swatches: 28px, 40px on touch widths (#431). The ring marks the selection; focus is the project's solid ink ring. */
.topic-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}

.topic-swatch[aria-checked='true'] {
  border-color: var(--ui-text-highlighted);
}

.topic-swatch:focus-visible,
.topic-symbol-trigger:focus-visible,
.topic-symbol-option:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.topic-swatch__dot {
  display: grid;
  place-items: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 50%;
}

.topic-swatch__dot--none {
  border: 1px dashed var(--ui-border-accented);
  color: var(--ui-text-muted);
}

.topic-symbol-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 2.5rem;
  padding: 0.25rem 0.75rem 0.25rem 0.5rem;
  border: 1px solid var(--ui-border-accented);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
  color: var(--ui-text);
  cursor: pointer;
}

.topic-symbol-trigger:hover {
  background: var(--ui-bg-muted);
}

.topic-symbol-well {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: calc(var(--ui-radius) * 0.75);
  background: var(--ui-bg-muted);
}

.topic-symbol-empty {
  width: 0.5rem;
  height: 0.5rem;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 50%;
}

.topic-symbol-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.125rem;
}

.topic-symbol-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.5rem;
  border-radius: var(--ui-radius);
  color: var(--ui-text-muted);
  cursor: pointer;
}

.topic-symbol-option:hover {
  background: var(--ui-bg-muted);
}

.topic-symbol-option[aria-checked='true'] {
  background: var(--ui-bg-accented);
}

@media (--phone) {
  .topic-swatch {
    width: 2.5rem;
    height: 2.5rem;
  }

  .topic-swatch__dot {
    width: 1.5rem;
    height: 1.5rem;
  }
}
</style>
