<!--
@component DayCloseDialog
@kind block
@category overlay
@description Optional, quiet closing step for the day (#98, #237): one sheet with the day in one look, what got done, what stays on the board for tomorrow, and a copyable summary.
@usage Mounted once in pages/tasks.vue; opened through useDayClose().open() (Mehr panel row, the Erledigt CTA, command palette).
Hosted by ResponsiveOverlay (modal at >=768px, drawer below; the same shell as TaskSheet, but not route-bound). The footer markup exists once and has no per-variant look: the theme floor makes both buttons 44px on a phone (Fertig, the one primary, `lg`: 48px) and desktop keeps `md` / `lg` (#551, #552).
@avoid Not for a plain confirmation (UModal, ResponsiveOverlay) and not the first-start-of-day recap (NewDayRecap).
@responsibility
- Shell only: title, scrolling body (DayCloseBody), footer "Zusammenfassung kopieren" (neutral, first) and "Fertig" (primary, last)
- Escape, overlay click and swipe down only close the dialog: nothing is archived, moved, deleted or stored
- "Fertig" is the one action with an effect (useDayClose.finish): the Jetzt task goes back to Offen with its timer stopped, tasks deselected in the "Für morgen" list go to the trash
- Copy writes plain markdown in the UI locale to the clipboard; the button itself confirms ("Kopiert" with a check for 3 s,
  width kept by stacking both icon + label states) and an in-dialog live region announces it; failures go through useErrorHandler
- Focus returns to the trigger, or to the board when the trigger is gone (palette)
-->
<template>
  <ResponsiveOverlay
    :open="isOpen"
    :title="t('dayClose.title')"
    :content-props="contentProps"
    :desktop-ui="DESKTOP_UI"
    :mobile-ui="MOBILE_UI"
    @update:open="handleOpenChange"
    @after-leave="handleAfterLeave"
  >
    <template #description>
      <span class="sr-only">{{ t('dayClose.description') }}</span>
    </template>
    <template #body>
      <!-- The button state is visual only, so the confirmation is also announced from inside -->
      <p class="sr-only" role="status" data-testid="day-close-status">{{ announcement }}</p>
      <DayCloseBody />
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        :disabled="isEmpty"
        data-testid="day-close-copy"
        @click="copySummary"
      >
        <!-- Both states share one grid cell, so the button keeps the width of the longer one -->
        <span class="grid">
          <span class="col-start-1 row-start-1 flex items-center justify-center gap-1.5" :class="{ invisible: copied }">
            <UIcon name="i-ph-copy" class="size-5 shrink-0" />{{ t('dayClose.copy') }}
          </span>
          <span class="col-start-1 row-start-1 flex items-center justify-center gap-1.5" :class="{ invisible: !copied }">
            <UIcon name="i-ph-check" class="size-5 shrink-0" />{{ t('dayClose.copiedButton') }}
          </span>
        </span>
      </UButton>
      <UButton size="lg" color="primary" data-testid="day-close-done-button" @click="finish">
        {{ t('dayClose.done') }}
      </UButton>
    </template>
  </ResponsiveOverlay>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MODAL_WIDTH } from '~/utils/modalSizes'
import { buildDaySummaryMarkdown } from '~/utils/dayClose'
import { useDayClose, useDayCloseData } from '~/composables/useDayClose'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { useErrorHandler } from '~/composables/useErrorHandler'
import DayCloseBody from '~/components/board/DayCloseBody.vue'
import ResponsiveOverlay from '~/components/ui/ResponsiveOverlay.vue'

defineOptions({ name: 'DayCloseDialog' })

const { t } = useI18n()
const { handleError } = useErrorHandler()
const { locale, formatDuration } = useLocaleFormat()
const { isOpen, close, finish, restoreFocus } = useDayClose()
const { done, inFlight } = useDayCloseData()

const DESKTOP_UI = { content: MODAL_WIDTH.md, body: 'min-h-0 overflow-y-auto overscroll-contain' }
const MOBILE_UI = {
  content: 'max-h-9/10',
  header: 'px-4 pb-2',
  body: 'min-h-0 overflow-y-auto overscroll-contain px-4 py-4',
  footer: 'flex-row items-center justify-end gap-2 border-t border-default p-4',
}

const COPIED_MS = 3000
const announcement = ref('')
/** Copy button shows "Kopiert" while set; the announcement clears on the same timer. */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(copiedTimer))

const isEmpty = computed(() => done.value.length === 0 && inFlight.value.length === 0)

/** ResponsiveOverlay forwards only real changes (its echo guard), so a `false` here is a dismissal. */
const handleOpenChange = (value: boolean) => {
  if (!value) close()
}

const handleAfterLeave = () => {
  restoreFocus()
}

/** Keeps the browser from restoring focus itself: restoreFocus() decides (trigger, else the board). */
const contentProps = {
  onCloseAutoFocus: (event: Event) => event.preventDefault(),
}

async function copySummary() {
  const markdown = buildDaySummaryMarkdown({
    labels: {
      heading: t('dayClose.markdown.heading', {
        date: new Intl.DateTimeFormat(locale.value, { dateStyle: 'full' }).format(new Date()),
      }),
      done: t('dayClose.markdown.done'),
      nothingDone: t('dayClose.markdown.nothingDone'),
      total: time => t('dayClose.markdown.total', { time }),
      inFlight: t('dayClose.markdown.inFlight'),
      nothingInFlight: t('dayClose.markdown.nothingInFlight'),
      columns: {
        open: t('board.columns.open'),
        progress: t('board.columns.progress'),
        waiting: t('board.columns.waiting'),
      },
    },
    formatDuration: seconds => formatDuration(seconds, 'spaced'),
    done: done.value,
    inFlight: inFlight.value,
  })

  try {
    await navigator.clipboard.writeText(markdown)
  }
  catch (error) {
    handleError(error instanceof Error ? error : 'Clipboard write failed', 'clipboard')
    return
  }
  copied.value = true
  announcement.value = t('dayClose.copied')
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = false
    announcement.value = ''
  }, COPIED_MS)
}
</script>
