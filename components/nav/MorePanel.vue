<!--
@component MorePanel
@kind block
@category navigation
@description Content of the Mehr popover behind the app bar's ⋯ (#470): the board controls and the pages that are not places
@usage Rendered inside the UPopover of AppNav; reads stores and composables only, no props
@avoid Only the popover behind AppNav's ⋯; the places (Heute, Statistik) are the pill's segments, not rows here.
@responsibility
- Order on the board: Ansicht (Karten stapeln + group-by chips) -> Tag abschließen -> Papierkorb (n), Einstellungen, App-Update -> sync footer
- Ansicht and Tag abschließen exist only while the board is the current place; the rest and the sync footer on every page
- The page the pill shows as its third segment (#583: Einstellungen on /settings*, Papierkorb on /trash*) is not listed here; the row returns when the page leaves the pill. App-Update stays on /settings/updates (a different page). The panel closes on every route change, so a row never appears or disappears while it is open
- App-Update only in the desktop app (`isTauri()`, absent in the web build, never disabled)
- Sync footer: a failing source shows its worst problem (title, hint, "Verbindung reparieren") above "Jetzt synchronisieren" + last sync; silent while every source is healthy
- While a sync runs (manual or background) the row's second line reads "Wird synchronisiert…" (spinner from the button's `loading`), so the accessible name carries the state, and a sibling `role="status"` announces it (#647)
- Board, desktop only: "Befehle" with the palette shortcut hint opens the command palette (U7 of kd#17: the hint was tooltip-only; the palette has no phone entry). AppNav closes the panel and returns focus to ⋯ first, like `dayClose`
- Keyboard: ↑/↓ move focus to the previous/next enabled control (clamped, no wrap), Home/End to the first/last; Tab order and roles stay (a popover, not role=menu)
- Emits `close` when a navigation row is chosen and `dayClose` for "Tag abschließen": AppNav closes the panel and returns focus to ⋯ first, then opens the dialog
- Sync status (moved from DESIGN.md, kd#176): a source that cannot sync puts a status dot on ⋯ (error for a rejected token, else warning; the 700 step, and ⋯'s accessible name says "Verbindungsproblem"), and this panel names the worst problem above the resync row with the fix; never a dialog on its own. A healthy sync is silent: no dot, no extra line
-->
<template>
  <div ref="panelEl" class="more-panel w-72 max-w-full p-2" data-testid="more-panel" @keydown="onKeydown">
    <template v-if="onBoard">
      <template v-if="!isPhone">
      <UButton
        icon="i-ph-command"
        color="neutral"
        variant="ghost"
        block
        class="justify-start"
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="more-commands"
        @click="emit('commands')"
      >
        <span class="flex w-full items-center justify-between gap-2">
          <span>{{ t('nav.commands') }}</span>
          <span class="inline-flex items-center gap-0.5" aria-hidden="true"><UKbd value="meta" /><UKbd value="k" /></span>
        </span>
      </UButton>
      <USeparator class="my-1" />
      </template>
      <section :aria-labelledby="viewHeadingId" class="space-y-3 p-2">
        <h2 :id="viewHeadingId" class="text-xs font-medium text-muted">{{ t('nav.view') }}</h2>
        <UFormField :help="t('board.sync.stackHelp')">
          <USwitch
            :model-value="groupingEnabled"
            :label="t('board.sync.stackCards')"
            data-testid="more-stack"
            @update:model-value="setGroupingEnabled"
          />
        </UFormField>
        <div v-if="groupingEnabled" class="space-y-2">
          <div role="group" :aria-label="t('board.sync.groupBy')" class="flex flex-wrap gap-1.5">
            <ChoiceChip
              v-for="option in groupingOptions"
              :key="option.value"
              :picked="effectiveGroupKey === option.value"
              :aria-pressed="effectiveGroupKey === option.value"
              @click="setGroupingKey(option.value)"
            >
              {{ option.label }}
            </ChoiceChip>
          </div>
          <p class="text-xs text-muted max-md:text-sm">{{ t('board.sync.stackHint') }}</p>
        </div>
      </section>
      <USeparator class="my-1" />
      <UButton
        icon="i-ph-sun-horizon"
        color="neutral"
        variant="ghost"
        block
        class="justify-start"
        data-testid="more-day-close"
        @click="emit('dayClose')"
      >
        {{ t('nav.dayClose') }}
      </UButton>
      <USeparator class="my-1" />
    </template>

    <UButton
      v-if="thirdItem?.to !== '/trash'"
      to="/trash"
      :icon="ICONS.delete"
      color="neutral"
      variant="ghost"
      block
      class="justify-start"
      data-testid="more-trash"
      @click="emit('close')"
    >
      {{ trashCount > 0 ? t('nav.trashCount', { n: trashCount }) : t('nav.trash') }}
    </UButton>
    <UButton
      v-if="!thirdItem?.to.startsWith('/settings')"
      to="/settings"
      icon="i-ph-gear"
      color="neutral"
      variant="ghost"
      block
      class="justify-start"
      data-testid="more-settings"
      @click="emit('close')"
    >
      {{ t('nav.settings') }}
    </UButton>
    <UButton
      v-if="isDesktopApp"
      to="/settings/updates"
      icon="i-ph-arrow-circle-up"
      color="neutral"
      variant="ghost"
      block
      class="justify-start"
      data-testid="more-update"
      @click="emit('close')"
    >
      {{ t('nav.appUpdate') }}
    </UButton>

    <USeparator class="my-1" />
    <div class="space-y-2" data-testid="more-sync-footer">
      <div v-if="worstProblem" class="space-y-2 p-2" :data-testid="`sync-problem-${worstProblem.source}`">
        <p class="flex items-start gap-2 text-sm font-medium text-highlighted">
          <UIcon :name="PROBLEM_ICONS[worstProblem.status]" class="mt-0.5 size-4 shrink-0" :class="problemTone" aria-hidden="true" />
          <span>{{ problemTitle(worstProblem) }}</span>
        </p>
        <p class="text-sm text-muted">{{ problemHint(worstProblem) }}</p>
        <UButton
          v-if="repairRouteOf(worstProblem.source)"
          :to="repairRouteOf(worstProblem.source)!"
          icon="i-ph-wrench"
          color="neutral"
          variant="soft"
          size="sm"
          block
          :data-testid="`sync-repair-${worstProblem.source}`"
          @click="emit('close')"
        >
          {{ t('board.sync.repair', { source: integrationLabel(worstProblem.source) }) }}
        </UButton>
      </div>
      <UButton
        icon="i-ph-arrow-clockwise"
        color="neutral"
        variant="ghost"
        block
        class="justify-start"
        :loading="isLoading"
        :disabled="isLoading"
        :aria-busy="isLoading"
        data-testid="more-sync"
        @click="resync"
      >
        <span class="flex flex-col items-start text-left">
          <span>{{ t('nav.syncNow') }}</span>
          <span class="text-xs font-normal text-muted">{{ isLoading ? t('nav.syncing') : lastSyncText }}</span>
        </span>
      </UButton>
    </div>
    <!-- A button's children are presentational, so the start of a sync is announced from a live region; it sits outside the footer's space-y stack, else the button is no longer :last-child and gains an 8px bottom margin (#647) -->
    <p role="status" class="sr-only" data-testid="more-sync-status"><template v-if="isLoading">{{ t('nav.syncing') }}</template></p>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, ref, useId } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import ChoiceChip from '~/components/ui/ChoiceChip.vue'
import { useAppNav } from '~/composables/useAppNav'
import { useBoardGrouping } from '~/composables/useBoardGrouping'
import { useManualSync } from '~/composables/useManualSync'
import { useTrash } from '~/composables/useTrash'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { integrationLabel, repairRouteOf } from '~/lib/taskSources'
import type { SourceProblem } from '~/lib/integrationHealth'
import { isTauri } from '~/utils/isTauri'
import { BREAKPOINT_QUERIES } from '~/lib/breakpoints';

defineOptions({ name: 'MorePanel' })

const emit = defineEmits<{
  /** A navigation row was chosen: the panel closes */
  close: []
  /** "Tag abschließen" was chosen: the host closes the panel, returns focus to ⋯, then opens the dialog */
  dayClose: []
  /** "Befehle" was chosen: the host closes the panel, returns focus to ⋯, then opens the command palette */
  commands: []
}>()

const { t } = useI18n()
const viewHeadingId = useId()
const { onBoard, thirdItem } = useAppNav()
const boardStore = useBoardStore()
const health = useIntegrationHealthStore()
const { groupingOptions, effectiveGroupKey, setGroupingEnabled, setGroupingKey } = useBoardGrouping()
const { resync, lastSyncText, isLoading } = useManualSync()
const { count: trashCount } = useTrash()

/** App-Update exists only in the desktop app (same predicate as middleware/desktop-only.ts) */
const isDesktopApp = isTauri()

/** Phone layout has no keyboard: the palette row is desktop only (same query as AppNav) */
const isPhone = useMediaQuery(BREAKPOINT_QUERIES.phone)

const panelEl = ref<HTMLElement | null>(null)
const CONTROLS = 'button:not([disabled]), a[href]'

/** ↑/↓/Home/End move focus through the panel's enabled controls in DOM order (clamped, no wrap) */
function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
  const controls = Array.from(panelEl.value?.querySelectorAll<HTMLElement>(CONTROLS) ?? [])
  if (controls.length === 0) return
  const at = controls.indexOf(document.activeElement as HTMLElement)
  const last = controls.length - 1
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? last
      : event.key === 'ArrowDown' ? Math.min(at + 1, last) : Math.max(at - 1, 0)
  event.preventDefault()
  controls[next]?.focus()
}

const groupingEnabled = computed(() => boardStore.grouping.enabled)

// Connected integrations that cannot sync, worst first (#319); the footer names the first one
const worstProblem = computed(() => health.problemsOf(boardStore.connectedIntegrations)[0] ?? null)

const PROBLEM_ICONS = { broken: 'i-ph-warning-circle', offline: 'i-ph-wifi-slash', degraded: 'i-ph-warning' } as const

// The 500 step of warning and error is below 3:1 (WCAG 1.4.11): the icon takes the 700 step
const problemTone = computed(() => (worstProblem.value?.status === 'broken' ? 'text-error-700' : 'text-warning-700'))

const problemTitle = (problem: SourceProblem) => {
  const named = { source: integrationLabel(problem.source) }
  if (problem.status === 'offline') return t('board.sync.sourceOffline', named)
  return problem.status === 'broken' ? t('board.sync.sourceBroken', named) : t('board.sync.sourceDegraded', named)
}

const problemHint = (problem: SourceProblem) => {
  const named = { source: integrationLabel(problem.source) }
  if (problem.status === 'offline') return t('board.sync.offlineHint', named)
  return problem.status === 'broken' ? t('board.sync.brokenHint', named) : t('board.sync.degradedHint', named)
}
</script>
