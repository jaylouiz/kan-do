<!--
@component TopicEditor
@kind component
@category input
@description The one editor every entry point opens (#430, #431): Name, Farbe (nine hues plus none, radio swatches) and
Symbol (a button showing the current mark; it opens a grid of 24 glyphs plus none below itself, in the editor's own flow). An activity has the Name only. A name a
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
- Hue and symbol groups are `SwatchRadioGroup` (`role="radiogroup"`, arrow keys); the symbol grid closes on pick or Escape, keeps the editor open and hands focus back to its button
- The symbol grid is inline, never a popover (kd#135, agent-decided): a popover sat over the count line and the actions of its own form (below the button at 1280, flipped over Name and Farbe at 390), and no side is free of the form once the sheet is short or scrolled. In the flow it pushes them down, and opening it scrolls the actions back into view where the scroll region has the room. Seven capped columns in a white well under the button: four rows instead of five, one compact block in every host, and the glyphs keep the contrast they have on a card (yellow 3.4:1; 2.9:1 on the muted panel). Rejected: `side: 'top'` (covers Name and Farbe, flips back over the actions when there is no room above), a side placement (no room at 390, covers Speichern at 1280), a grid that is always open (25 glyphs at rest in a form mostly opened to rename), `UCollapsible` (its height animation runs while the focus and the scroll have to land)
@accessibility The gate hint is `aria-describedby` of the disabled Name, the merge note is `role="status"`; the symbol button is a disclosure (`aria-expanded`, `aria-controls`)
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
        :disabled="nameLocked"
        :aria-describedby="nameLocked ? gateId : undefined"
        autocomplete="off"
        data-private
        data-testid="topic-name-input"
      />
      <p v-if="nameLocked" :id="gateId" class="flex items-start gap-1.5 text-body text-muted" data-testid="topic-name-gate">
        <UIcon name="i-ph-cloud" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{{ t('topic.editor.nameGate') }}</span>
      </p>
      <p v-else-if="mergeWith" class="text-body text-muted" role="status" data-testid="topic-merge-note" data-private>
        {{ t(kind === 'topic' ? 'topic.editor.mergeTopic' : 'topic.editor.mergeActivity', { name: mergeWith }) }}
      </p>
    </div>

    <template v-if="kind === 'topic'">
      <fieldset class="space-y-1.5">
        <legend class="mb-1.5 text-xs font-medium text-muted">{{ t('topic.editor.color') }}</legend>
        <SwatchRadioGroup
          ref="hueGroup"
          :model-value="hue"
          :options="hueOptions"
          :label="t('topic.editor.color')"
          variant="swatch"
          item-testid="topic-hue"
          class="flex flex-wrap gap-1.5"
          data-testid="topic-hue-group"
          @update:model-value="(key) => (hue = key as TopicHue | null)"
        >
          <template #option="{ option }">
            <span v-if="option.key" class="topic-swatch__dot" :style="{ backgroundColor: `var(--topic-${option.key})` }" />
            <span v-else class="topic-swatch__dot topic-swatch__dot--none"><UIcon name="i-ph-prohibit" class="size-3" /></span>
          </template>
        </SwatchRadioGroup>
        <p v-if="notionHue && hue === null" class="text-body text-muted" data-testid="topic-color-hint">
          {{ t('topic.editor.colorInherited', { hue: hueLabel(notionHue) }) }}
        </p>
        <p v-else-if="inheritedHue && hue === null" class="text-body text-muted" data-testid="topic-color-hint">
          {{ t('topic.editor.colorInheritedFromTasks', { hue: hueLabel(inheritedHue) }) }}
        </p>
        <p v-else-if="notionHue && hue !== notionHue" class="text-body text-muted" data-testid="topic-color-hint">
          {{ t('topic.editor.colorLocalOnly', { hue: hueLabel(notionHue) }) }}
        </p>
      </fieldset>

      <div class="space-y-1.5" @keydown.esc="onPickerEscape">
        <span class="block text-xs font-medium text-muted">{{ t('topic.editor.symbol') }}</span>
        <UButton
          ref="symbolTrigger"
          type="button"
          color="neutral"
          variant="soft"
          :label="symbolLabel"
          trailing-icon="i-ph-caret-down"
          :ui="{ trailingIcon: pickerOpen ? 'rotate-180 transition-transform duration-(--duration-base)' : 'transition-transform duration-(--duration-base)' }"
          :aria-label="t('topic.editor.symbolButton', { value: symbolLabel })"
          :aria-expanded="pickerOpen"
          :aria-controls="pickerOpen ? gridId : undefined"
          data-testid="topic-symbol-trigger"
          @click="pickerOpen = !pickerOpen"
        >
          <template #leading>
            <span class="topic-symbol-well">
              <TopicMark v-if="effectiveHue || symbol" :hue="effectiveHue" :symbol="symbol" />
              <span v-else class="topic-symbol-empty" aria-hidden="true" />
            </span>
          </template>
        </UButton>
        <SwatchRadioGroup
          v-if="pickerOpen"
          :id="gridId"
          ref="symbolGroup"
          v-model="symbol"
          :options="symbolOptions"
          :label="t('topic.editor.symbol')"
          variant="glyph"
          :columns="SYMBOL_COLUMNS"
          item-testid="topic-symbol"
          class="topic-symbol-grid"
          data-testid="topic-symbol-group"
          @pick="closePicker"
        >
          <template #option="{ option }">
            <TopicMark v-if="option.key" :hue="effectiveHue" :symbol="option.key" />
            <span v-else class="topic-symbol-empty" aria-hidden="true" />
          </template>
        </SwatchRadioGroup>
      </div>
    </template>

    <p class="text-body text-muted" data-testid="topic-editor-count">{{ countLine }}</p>

    <div ref="actionsRow" class="flex scroll-mb-4 items-center justify-end gap-2">
      <UButton type="button" color="neutral" variant="soft" :label="t('topic.editor.cancel')" data-testid="topic-cancel" @click="emit('close')" />
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
import SwatchRadioGroup from '~/components/ui/SwatchRadioGroup.vue'

defineOptions({ name: 'TopicEditor' })

const props = withDefaults(defineProps<{ topic: string; kind?: NameKind }>(), { kind: 'topic' })
const emit = defineEmits<{ close: []; saved: [name: string] }>()

const { t } = useI18n()
const management = useTopicManagement()
const styles = useTopicStylesStore()
const { sourceHueOf } = useTopicColor()
const nameId = useId()
const gateId = useId()
const gridId = useId()

/** Columns of the symbol grid: 25 cells in four rows, and seven 40 px cells still fit the narrowest drawer (320 px). */
const SYMBOL_COLUMNS = 7

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
// The Notion hints only for a name Notion owns: its colour is what "keine" returns to. Any other inherited hue (a task's
// own colour) gets its own hint, so "keine" next to a coloured mark is explained (#144)
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

const hueGroup = ref<InstanceType<typeof SwatchRadioGroup> | null>(null)
const symbolGroup = ref<InstanceType<typeof SwatchRadioGroup> | null>(null)

const symbolTrigger = ref<{ $el?: HTMLElement } | null>(null)
const actionsRow = ref<HTMLElement | null>(null)

// The grid opens in the editor's own flow (kd#135): it pushes the count line and the actions down instead of covering
// them. Bring the actions back into view where the scroll region has the room, then focus the selected glyph, so the
// arrow keys work at once (the focus call itself keeps the glyph in view when the editor is taller than the region).
watch(pickerOpen, async (open) => {
  if (!open) return
  await nextTick()
  actionsRow.value?.scrollIntoView({ block: 'nearest' })
  symbolGroup.value?.focusSelected()
})

/** A pick or Escape closes the grid; focus returns to its button, never to the page. */
function closePicker() {
  pickerOpen.value = false
  symbolTrigger.value?.$el?.focus({ preventScroll: true })
}

/** Escape closes the open grid only; with the grid closed it bubbles to the form and closes the editor. */
function onPickerEscape(event: KeyboardEvent) {
  if (!pickerOpen.value) return
  event.stopPropagation()
  event.preventDefault()
  closePicker()
}

// The editor takes focus where the edit starts: the Name, or the first colour when Notion owns the name
onMounted(() => {
  void nextTick(() => requestAnimationFrame(() => {
    if (!nameLocked.value) nameInput.value?.inputRef?.focus({ preventScroll: true })
    else hueGroup.value?.focusSelected({ preventScroll: true })
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

.topic-symbol-well {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-sm);
  background: var(--ui-bg-muted);
}

.topic-symbol-empty {
  /* "none": a slashed circle, a mark in its own right (a dashed ring read as a disabled placeholder, #114) */
  width: 1rem;
  height: 1rem;
  border: 1px solid var(--ui-border-accented);
  border-radius: 50%;
  background: linear-gradient(
    to top right,
    transparent calc(50% - 0.5px),
    var(--ui-text-muted) calc(50% - 0.5px),
    var(--ui-text-muted) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
}

.topic-symbol-grid {
  display: grid;
  /* 7 = SYMBOL_COLUMNS in the script (ArrowUp/Down move by this many cells). Tracks are capped, so the grid is one
     compact block under its button in every host (a wide settings row as the 320 px drawer, where they shrink) */
  grid-template-columns: repeat(7, minmax(0, 2.75rem));
  gap: 0.125rem;
  /* A white well in a hairline, like the Name field: on the muted inline panel the yellow glyph would fall to 2.9:1,
     on white it keeps the 3.4:1 it has on a card (WCAG 1.4.11); it also holds the grid together as one control */
  width: fit-content;
  max-width: 100%;
  padding: 0.25rem;
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
  box-shadow: inset 0 0 0 1px var(--ui-border);
}

@media (--phone) {
  .topic-swatch__dot {
    width: 1.5rem;
    height: 1.5rem;
  }
}
</style>
