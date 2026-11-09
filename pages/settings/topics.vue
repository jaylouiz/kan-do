<!--
@component SettingsTopicsPage
@description "Themen und Aktivitäten" (/settings/topics, #430, #431): the home of topic management. Every topic and
activity as a hairline row (mark, name, task count, "aus Notion" / "ungenutzt"), used or not, in two `UTabs` (the shared tab look, #557). A row opens the
shared TopicEditor: an inline panel under the row at >=768px, a bottom drawer at 390px. One row is open at a time.
@usage Einstellungen -> "Themen und Aktivitäten", the task sheet picker's "Themen verwalten" row
@responsibility
- List `useTopicManagement().topics` / `.activities` with task counts and the source/unused note
- Open one editor at a time (a rename re-keys it by the new name); Escape and Abbrechen close it and return focus to its row
- Web and desktop; same sub-page pattern as /settings/updates: one flat column, no cards
- Empty list: one calm sentence that says where topics come from
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <div ref="root" class="space-y-6">
        <UTabs
          v-model="kind"
          :items="tabs"
          :ui="{ trigger: 'touch-target', content: 'pt-6' }"
          @update:model-value="open = null"
        >
          <template #trailing="{ item }"><span class="text-muted">{{ item.count }}</span></template>
          <template #content>
            <div class="space-y-6" data-testid="topics-panel">
              <p class="text-sm text-muted">{{ t(kind === 'topic' ? 'settings.topics.introTopics' : 'settings.topics.introActivities') }}</p>

              <ul v-if="list.length" class="divide-y divide-default" data-testid="topics-list">
                <ListRow
                  v-for="name in list"
                  :key="name"
                  :ref="(el) => setRowRef(name, el)"
                  action
                  hover="surface"
                  :expanded="open === name"
                  :label="t('settings.topics.editRow', { name })"
                  button-testid="topics-row-button"
                  data-testid="topics-row"
                  @click="toggle(name)"
                >
                  <span class="flex items-center gap-3">
                    <span class="grid size-6 shrink-0 place-items-center"><TopicMark v-if="kind === 'topic'" :topic="name" /></span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-default" data-private>{{ name }}</span>
                      <span class="block text-sm text-muted" data-testid="topics-row-meta">{{ metaOf(name) }}</span>
                    </span>
                    <UIcon :name="open === name ? 'i-ph-caret-up' : 'i-ph-pencil-simple'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                  </span>
                  <template #after>
                    <div v-if="open === name" class="mb-3 ml-9 w-full max-md:ml-0">
                      <TopicEditorHost :key="`${kind}:${name}`" :topic="name" :kind="kind" @close="close" @saved="onSaved" />
                    </div>
                  </template>
                </ListRow>
              </ul>
              <p v-else class="text-sm text-muted" data-testid="topics-empty">
                {{ t(kind === 'topic' ? 'settings.topics.emptyTopics' : 'settings.topics.emptyActivities') }}
              </p>
            </div>
          </template>
        </UTabs>
      </div>
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TopicMark from '~/components/topic/TopicMark.vue'
import ListRow from '~/components/ui/ListRow.vue'
import TopicEditorHost from '~/components/topic/TopicEditorHost.vue'
import { useTopicManagement } from '~/composables/useTopicManagement'
import type { NameKind } from '~/lib/topicNames'

defineOptions({ name: 'SettingsTopicsPage' })
definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  titleKey: 'settings.topics.pageTitle',
  descriptionKey: 'settings.topics.pageDescription',
})

const { t } = useI18n()
const { topics, activities, countOf, isSourceOwned } = useTopicManagement()

const root = ref<HTMLElement | null>(null)
const kind = ref<NameKind>('topic')
const open = ref<string | null>(null)
const rowRefs = new Map<string, { focus: () => void }>()
let focusAfter: string | null = null

// UTabs has no label prop for its list: name the tablist here so a screen reader announces "Art" with the tabs
onMounted(() => root.value?.querySelector('[data-slot="list"]')?.setAttribute('aria-label', t('settings.topics.tabsLabel')))

const list = computed(() => (kind.value === 'topic' ? topics.value : activities.value))
const tabs = computed(() => [
  { value: 'topic' as const, label: t('settings.topics.tabTopics'), count: topics.value.length },
  { value: 'activity' as const, label: t('settings.topics.tabActivities'), count: activities.value.length },
])

const setRowRef = (name: string, el: unknown) => {
  if (el && typeof (el as { focus?: unknown }).focus === 'function') rowRefs.set(name, el as { focus: () => void })
  else rowRefs.delete(name)
}

function metaOf(name: string): string {
  const count = countOf(kind.value, name)
  const parts = [t('settings.topics.taskCount', { n: count }, count)]
  if (isSourceOwned(kind.value, name)) parts.push(t('settings.topics.fromNotion'))
  else if (count === 0) parts.push(t('settings.topics.unused'))
  return parts.join(' · ')
}

function toggle(name: string) {
  open.value = open.value === name ? null : name
}

/** Remembers where focus returns to: the row of the renamed (or merged-into) name. */
function onSaved(name: string) {
  focusAfter = name
}

function close() {
  const name = focusAfter ?? open.value
  focusAfter = null
  open.value = null
  // Focus returns to the row once the list has settled (a rename re-sorts it)
  void nextTick(() => name && rowRefs.get(name)?.focus())
}
</script>
