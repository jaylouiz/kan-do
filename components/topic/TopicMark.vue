<!--
@component TopicMark
@description The mark before a topic's name (#431): a 12px hue dot, or the Phosphor fill glyph (16px) in the hue when a
symbol is set (muted gray when it has no hue). A topic with neither hue nor symbol renders nothing, so no gap appears and
the card looks as it did. Decorative: `aria-hidden`, the name carries the meaning; never a pointer target (the card is a
drag item, #430 known issue 4).
@usage Card topic line, the sheet's Thema row, picker options, the settings list, the editor preview, the statistics dialog
@responsibility
- Resolve the mark from the topic name (and the task, for the source colour) through `useTopicColor().markOf`
- Or show an explicit `hue` / `symbol` (the editor previews an unsaved choice)
- Colour comes from the `--topic-<hue>` tokens (assets/css/main.css) through one custom property, never a palette class
-->
<template>
  <span
    v-if="shown.hue || shownSymbol"
    class="topic-mark"
    :style="{ '--topic-mark': shown.hue ? `var(--topic-${shown.hue})` : 'var(--ui-text-muted)' }"
    data-testid="topic-mark"
    :data-hue="shown.hue ?? undefined"
    :data-symbol="shownSymbol?.key"
    aria-hidden="true"
  >
    <UIcon v-if="shownSymbol" :name="shownSymbol.icon" class="topic-mark__glyph" />
    <span v-else class="topic-mark__dot" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTopicColor } from '~/composables/useTopicColor'
import { symbolOf, type TopicHue } from '~/lib/topicStyles'
import type { Task } from '~/types/task'

defineOptions({ name: 'TopicMark' })

const props = defineProps<{
  topic?: string | null
  /** The task the topic belongs to: its own source colour is used, a Todoist task never borrows a Notion one. */
  task?: Pick<Task, 'source' | 'topic' | 'topicColorCode'> | null
  /** Explicit hue and symbol (editor preview); both given means the resolver is not asked. */
  hue?: TopicHue | null
  symbol?: string | null
}>()

const { markOf } = useTopicColor()
const explicit = computed(() => props.hue !== undefined || props.symbol !== undefined)
const shown = computed(() => explicit.value
  ? { hue: props.hue ?? null, symbol: props.symbol ?? null }
  : markOf(props.topic, props.task))
const shownSymbol = computed(() => symbolOf(shown.value.symbol))
</script>

<style scoped>
.topic-mark {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  color: var(--topic-mark);
  pointer-events: none;
}

.topic-mark__dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background-color: currentcolor;
}

.topic-mark__glyph {
  width: 1rem;
  height: 1rem;
}
</style>
