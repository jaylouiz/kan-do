<!--
@component TaskDetailNotes
@kind component
@category input
@description Notes section of the task detail: rendered Markdown in read mode, a plain textarea while editing
@usage Used by TaskDetailContent; inline in the flow, directly after the property rows and time (#386)
@avoid Only the notes of the task detail; other long text uses a plain textarea.
@responsibility
- Read mode renders the notes as sanitized Markdown (utils/renderMarkdown); edit mode stays the textarea
- Written notes use `interactive-display` so links sit beside the edit trigger, not inside role=button (#208); empty notes have no links and keep the plain trigger. The trigger element is replaced when notes flip empty/written; InlineEditable restores keyboard focus to the new one
- Empty notes keep the muted placeholder trigger with the dotted rule; written notes use the soft hover fill (a dotted rule under every rendered line would be noise)
- Save with Cmd+Enter (macOS) or Ctrl+Enter, the hint names the key of the current platform
-->
<template>
  <section
    aria-labelledby="notes-heading"
    class="task-detail-section"
    data-testid="task-notes"
  >
    <SectionHeader id="notes-heading" :text="t('task.field.notes')" tag="h3" class="mb-0" />

    <div>
      <InlineEditable
        data-private
        :model-value="notes"
        :label="t('task.field.notes')"
        :value-text="plainText"
        :placeholder="t('task.detail.notesEmpty')"
        :affordance="notes ? 'fill' : 'rule'"
        :container-class="notes ? '-ms-2' : undefined"
        multiline
        :interactive-display="!!notes"
        @save="(val) => emit('save', val as string)"
      >
        <template #display>
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized by renderMarkdown (DOMPurify, small tag allow-list) -->
          <div v-if="notes" class="task-notes-markdown min-w-0 flex-1 py-1" data-testid="task-notes-rendered" v-html="html" />
          <span v-else class="text-muted not-italic">{{ t('task.detail.notesEmpty') }}</span>
        </template>
        <template #edit="{ value, setValue, finishEdit, commitEdit, cancelEdit }">
          <UTextarea
            :model-value="(value as string) || ''"
            autofocus
            :rows="5"
            class="w-full"
            :placeholder="t('task.detail.notesPlaceholder')"
            data-testid="task-notes-input"
            @update:model-value="(val) => setValue(val)"
            @blur="finishEdit"
            @keydown="(event: KeyboardEvent) => { if (isSubmitShortcut(event)) commitEdit(); }"
            @keydown.esc.stop="cancelEdit"
          />
          <div class="mt-1 text-right text-xs text-muted" data-testid="task-notes-hint">
            {{ t('task.detail.notesHint', { shortcut: submitShortcut }) }}
          </div>
        </template>
      </InlineEditable>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SectionHeader from '~/components/ui/SectionHeader.vue';
import InlineEditable from '~/components/ui/inline/InlineEditable.vue';
import { renderMarkdown } from '~/utils/renderMarkdown';
import { isSubmitShortcut, usePlatformShortcut } from '~/composables/usePlatformShortcut';

defineOptions({ name: 'TaskDetailNotes' });

const props = withDefaults(defineProps<{
  /** Notes as Markdown source; empty shows the placeholder */
  notes?: string | null;
}>(), {
  notes: null,
});

const emit = defineEmits<{
  save: [value: string];
}>();

const { t } = useI18n();
const { submitShortcut } = usePlatformShortcut();

const html = computed(() => (props.notes ? renderMarkdown(props.notes) : ''));

/** The trigger's accessible name speaks the text, not the markup ("**fett**" is read as "fett"). */
const plainText = computed(() => {
  if (!props.notes || typeof DOMParser === 'undefined') return undefined;
  return new DOMParser().parseFromString(html.value, 'text/html').body.textContent?.trim() || undefined;
});
</script>
