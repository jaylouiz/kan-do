<!--
@component SettingsPage
@description "Einstellungen" (/settings, #394, #691): three groups behind a tab strip (`UTabs`, the shared tab look of DESIGN.md "Components", as /settings/topics),
one shown at a time, the active one in the URL as `?tab=board|sources|manage` (default board, unknown value = board):
Board (the Fokus option), Aufgabenquellen (the former "Aufgaben-Quellen" page, #324: every source with its health, the default
for new tasks, repair / configure / connect / disconnect) and Verwaltung (hairline rows to Themen und Aktivitäten, Daten &
Speicher, and on desktop Updates and GitHub-Zugriff).
`/settings/sources` redirects here.
@usage Board gear, command palette "Einstellungen", the sync popover's "Verbindung reparieren"
@responsibility
- "Fokus": one switch row, "Jetzt-Karte im Fokus" (`settingsStore.focusEnabled`); takes effect on the board at once; on phone the 36×20 switch has a 44 px hit area (an invisible `::after`, kd#27)
- List Lokal (always) and the connected integrations as hairline rows; the default carries the "Standard" badge
- "Als Standard festlegen" changes the default at once (`boardStore.setDefaultSource`)
- Repair of a broken Notion (rejected token, missing config) opens the Notion setup at the token step
  (`force-setup`, so a new token can be entered); a merely degraded one opens it in settings mode.
  "Notion-Einstellungen" goes to /settings/notion, "Trennen" opens the disconnect dialog of #320
  (`useSourceConnections` does the work)
- "Weitere Verbindungen": Notion with "Verbinden" while disconnected (today's Notion setup, then `connectSource`),
  Todoist as "bald verfügbar"
- "Verwaltung": `ListRow` link rows (`to`, kd#179; #683 sizing), every sub-page has one; a tab click `router.replace`s the query, so back from a sub-page returns to the tab it was opened from
- Known trade-off: the Board tab holds only Fokus (accepted by the UX decision)
- No visible page header (#670): the app bar's third segment reads "Einstellungen"; the layout keeps the title as an sr-only h1
- Same sub-page pattern as /settings/updates: one flat column, no cards
-->
<template>
  <div>
    <NuxtLayout name="sub-page">
      <div class="space-y-8">
        <UTabs
          ref="tabsRef"
          :model-value="tab"
          :items="tabItems"
          :content="false"
          class="w-full"
          data-testid="settings-tabs"
          @update:model-value="onTabChange"
        />

        <section
          :aria-label="t(`settings.tabs.${tab}`)"
          class="space-y-6"
          :data-testid="`settings-panel-${tab}`"
        >
          <p class="text-sm text-muted" data-testid="settings-tab-lead">{{ t(`settings.tabs.lead.${tab === 'manage' && !isDesktop ? 'manageWeb' : tab}`) }}</p>

          <div v-if="tab === 'board'" class="space-y-1" data-testid="focus-settings">
            <div class="flex items-center gap-4 py-4">
              <div class="min-w-0 flex-1">
                <label id="focus-label" class="block text-default" for="focus-switch">{{ t('settings.focus.label') }}</label>
                <p id="focus-help" class="text-sm text-muted">{{ t('settings.focus.help') }}</p>
              </div>
              <USwitch
                id="focus-switch"
                :model-value="settingsStore.focusEnabled"
                aria-describedby="focus-help"
                :ui="{ base: 'relative max-md:after:absolute max-md:after:-inset-3.5' }"
                data-testid="focus-switch"
                @update:model-value="settingsStore.setFocusEnabled"
              />
            </div>
          </div>

          <template v-else-if="tab === 'sources'">
            <section aria-labelledby="sources-connected-heading" class="space-y-1">
              <h2 id="sources-connected-heading" class="section-heading">
                {{ t('sources.page.connectedHeading') }}
              </h2>
              <p class="text-sm text-muted" data-testid="sources-lead">
                {{ t('sources.page.lead') }} {{ t('sources.page.help') }}
              </p>
              <ul class="divide-y divide-default pt-2" data-testid="sources-connected">
                <SourceRow
                  v-for="row in connected"
                  :key="row.id"
                  :row="row"
                  @set-default="onSetDefault"
                  @repair="onRepair"
                  @open-settings="onOpenSettings"
                  @disconnect="onDisconnect"
                />
              </ul>
            </section>

            <section aria-labelledby="sources-more-heading" class="space-y-1">
              <h2 id="sources-more-heading" class="section-heading">
                {{ t('sources.page.moreHeading') }}
              </h2>
              <ul class="divide-y divide-default" data-testid="sources-more">
                <li
                  v-for="row in more"
                  :key="row.id"
                  class="flex flex-wrap items-center gap-x-4 gap-y-3 py-4"
                  :data-testid="`source-more-${row.id}`"
                >
                  <UIcon :name="row.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
                  <p class="min-w-0 flex-1 basis-40 text-default">{{ row.name }}</p>
                  <UButton
                    v-if="row.state === 'connectable'"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    :aria-label="t('sources.row.connectNamed', { source: row.name })"
                    :loading="isConnecting"
                    :data-testid="`source-connect-${row.id}`"
                    @click="onConnect"
                  >
                    {{ t('sources.row.connect') }}
                  </UButton>
                  <span v-else class="text-sm text-muted">{{ t('sources.page.soon') }}</span>
                </li>
              </ul>
            </section>
          </template>

          <ul v-else class="divide-y divide-default" data-testid="settings-subpages">
            <ListRow v-for="link in manageLinks" :key="link.to" :to="link.to" button-testid="settings-subpage-link">
              <span class="flex items-center gap-4">
                <UIcon :name="link.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span data-testid="settings-subpage-link-label">{{ link.label }}</span>
                  <span class="text-sm text-muted">{{ link.description }}</span>
                </span>
                <UIcon :name="ICONS.goOn" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              </span>
            </ListRow>
          </ul>
        </section>
      </div>

      <!-- Notion setup, one instance: connect and the repair of a broken connection run it from the first
           step (force-setup, a broken token lands on the token step); a degraded repair uses settings mode -->
      <NotionSetupModal v-model:open="isSetupOpen" :force-setup="isSetupForced" @complete="onSetupComplete" />
      <!-- Disconnect (#320): the dialog states what leaves the board and what is discarded -->
      <DisconnectSourceDialog v-model:open="isDisconnectOpen" :source="disconnectTarget" />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateTo } from 'nuxt/app'
import { useRoute, useRouter } from 'vue-router'
import SourceRow from '~/components/settings/SourceRow.vue'
import DisconnectSourceDialog from '~/components/settings/DisconnectSourceDialog.vue'
import NotionSetupModal from '~/components/notion/setup/NotionSetupModal.vue'
import { useBoardStore } from '~/store/board'
import { useSettingsStore } from '~/store/settings'
import { useSourceList } from '~/composables/useSourceList'
import { useSourceConnections } from '~/composables/useSourceConnections'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useErrorHandler } from '~/composables/useErrorHandler'
import { isTauri } from '~/utils/isTauri'
import ListRow from '~/components/ui/ListRow.vue'
import { ICONS } from '~/lib/icons'
import { isIntegrationSourceId } from '~/lib/taskSources'
import type { IntegrationSourceId, SourceId } from '~/types/taskSource'

defineOptions({ name: 'SettingsPage' })

definePageMeta({
  layout: false,
  pageWidth: 'narrow', // one 672 px column on the app bar's axis (#673)
  titleKey: 'settings.page.title',
  pageHeader: false, // the app bar's third segment reads "Einstellungen" (#670)
})

const { t } = useI18n()
const boardStore = useBoardStore()
const settingsStore = useSettingsStore()
const { connected, more } = useSourceList()
const { connectSource } = useSourceConnections()
const { fetchSource } = useIntegrationManager()
const { handleError } = useErrorHandler()

// The Keychain and updater pages exist on desktop only.
const isDesktop = isTauri()

// The active group lives in the URL (`?tab=`): back from a sub-page re-opens the same tab, a link can point at one
const TAB_IDS = ['board', 'sources', 'manage'] as const
type TabId = (typeof TAB_IDS)[number]
const route = useRoute()
const router = useRouter()
const tab = computed<TabId>(() => {
  const q = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
  return TAB_IDS.find((id) => id === q) ?? 'board'
})
const tabItems = computed(() =>
  TAB_IDS.map((id) => ({
    value: id,
    label: t(`settings.tabs.${id}`),
  })),
)
const onTabChange = (value: string | number) => {
  void router.replace({ query: { ...route.query, tab: String(value) } })
}

const manageLinks = computed(() => [
  { to: '/settings/topics', icon: 'i-ph-tag', label: t('settings.subpages.topics.label'), description: t('settings.subpages.topics.description') },
  { to: '/settings/data', icon: 'i-ph-database', label: t('settings.subpages.data.label'), description: t(isDesktop ? 'settings.subpages.data.descriptionDesktop' : 'settings.subpages.data.descriptionWeb') },
  ...(isDesktop
    ? [
        { to: '/settings/updates', icon: 'i-ph-arrow-circle-up', label: t('settings.subpages.updates.label'), description: t('settings.subpages.updates.description') },
        { to: '/settings/github', icon: 'i-ph-key', label: t('settings.subpages.github.label'), description: t('settings.subpages.github.description') },
      ]
    : []),
])

// UTabs has no prop for its list: name the tablist so a screen reader announces the group switch
const tabsRef = ref<{ $el: HTMLElement } | null>(null)
onMounted(() => {
  const list = tabsRef.value?.$el?.querySelector('[data-slot="list"]')
  list?.setAttribute('aria-label', t('settings.tabs.label'))
})

type SetupPurpose = 'connect' | 'repair'

const isSetupOpen = ref(false)
const isSetupForced = ref(false)
const setupPurpose = ref<SetupPurpose>('connect')
const isConnecting = ref(false)
const isDisconnectOpen = ref(false)
const disconnectTarget = ref<IntegrationSourceId | null>(null)

// A board that never onboarded has no sources to manage: the welcome flow picks the first one
onMounted(() => {
  if (!boardStore.isOnboarded) void navigateTo('/welcome')
})

const onSetDefault = (id: SourceId) => {
  boardStore.setDefaultSource(id)
}

const openSetup = (purpose: SetupPurpose, forced: boolean) => {
  setupPurpose.value = purpose
  isSetupForced.value = forced
  isSetupOpen.value = true
}

// A broken connection needs its credentials again: the token step, never the mapping a dead token cannot serve
const onRepair = (id: SourceId) => {
  if (id !== 'notion') return
  const row = connected.value.find((r) => r.id === id)
  openSetup('repair', row?.repairNeedsCredentials ?? false)
}

const onOpenSettings = (id: SourceId) => {
  if (id === 'notion') void navigateTo('/settings/notion')
}

const onDisconnect = (id: SourceId) => {
  if (!isIntegrationSourceId(id)) return
  disconnectTarget.value = id
  isDisconnectOpen.value = true
}

const onConnect = () => {
  openSetup('connect', true)
}

const onSetupComplete = () => (setupPurpose.value === 'repair' ? onRepairComplete() : onConnectComplete())

/** The setup saved new credentials or mapping: fetch so the status line reflects the repaired connection. */
const onRepairComplete = async () => {
  try {
    await fetchSource('notion')
  } catch {
    // The failure is recorded in the source's health; the row shows "Verbindung prüfen" again
  }
}

/** Notion is configured: add it on top of the board (no default change); its first fetch merges per source. */
const onConnectComplete = async () => {
  isConnecting.value = true
  try {
    // A refused connect (busy, already connected) changes nothing; a failed first fetch keeps the connection
    // and the row then reads "Verbindung prüfen"
    await connectSource('notion')
  } catch (error) {
    handleError(error as Error, 'notion_setup')
  } finally {
    isConnecting.value = false
  }
}
</script>
