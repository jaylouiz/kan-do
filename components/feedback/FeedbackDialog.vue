<!--
@component FeedbackDialog
@description In-app feedback (#227, Direction A; screenshot #247): one UModal, three steps. Form (title, description,
optional element, optional screenshot, automatic context line), the annotate step (only after a capture), then
"Prüfen und senden", which shows exactly what is sent.
@usage Mounted once in pages/tasks.vue; opened from the command palette through useFeedback().open() (desktop only).
@responsibility
- Form: title (required, ≤ 120), description (≤ 4000), "Element auswählen" (hides the dialog while picking), draft discard
- Screenshot: "Screenshot hinzufügen" hides the dialog while the window is captured, then opens the annotate step
- Review: the exact issue body and image, each context item removable; the primary action is the only way anything leaves
- With a feedback token whose user may write to the repo: "Als Issue senden"; otherwise (absent, rejected, read only):
  "Auf GitHub öffnen" with a prefilled link
- The repository is public: the form says the report becomes a public GitHub issue, and on the browser path (no
  token) that sending needs the user's own GitHub account; the review intro repeats both. After the link opens, a
  toast on the board says to paste the screenshot (clipboard) and send the issue there
- Calm inline errors with "Erneut versuchen"; the draft survives every one of them
- Escape/X close and keep the draft; focus returns to the board (the palette is gone)
-->
<template>
  <UModal
    :open="isOpen"
    :title="stepTitle"
    :content="contentProps"
    :ui="{ content: step === 'annotate' ? MODAL_WIDTH.lg : MODAL_WIDTH.md, body: 'min-h-0 overflow-y-auto overscroll-contain' }"
    @update:open="handleOpenChange"
    @after:leave="onDialogLeft"
  >
    <template #description>
      <span class="sr-only">{{ t('feedback.description') }}</span>
    </template>

    <template #body>
      <form v-if="step === 'form'" class="flex flex-col gap-5" data-testid="feedback-form" @submit.prevent="toReview">
        <UFormField :label="t('feedback.titleLabel')" required>
          <UInput
            v-model="draft.title"
            :maxlength="limits.title"
            class="w-full"
            data-testid="feedback-title"
            autofocus
          />
        </UFormField>

        <UFormField :label="t('feedback.descriptionLabel')">
          <UTextarea
            v-model="draft.description"
            :maxlength="limits.description"
            :rows="5"
            autoresize
            class="w-full"
            data-testid="feedback-description"
          />
        </UFormField>

        <div class="flex flex-col gap-2">
          <div v-if="draft.element" class="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2" data-testid="feedback-element">
            <p class="min-w-0 text-sm">
              <span class="font-medium">{{ t('feedback.elementLabel') }}:</span>
              <span class="ml-1 text-toned">{{ elementName }}</span>
              <span class="block truncate font-mono text-xs text-toned">{{ draft.element.selector }}</span>
            </p>
            <UButton color="neutral" variant="ghost" size="sm" data-testid="feedback-element-remove" @click="draft.element = null">
              {{ t('feedback.removeElement') }}
            </UButton>
          </div>
          <UButton
            v-else
            color="neutral"
            variant="soft"
            icon="i-ph-cursor-click"
            class="self-start"
            data-testid="feedback-pick-element"
            @click="startPick"
          >
            {{ t('feedback.pickElement') }}
          </UButton>
          <p v-if="!draft.element" class="text-xs text-muted">{{ t('feedback.pickElementHint') }}</p>
        </div>

        <div v-if="captureAvailable" class="flex flex-col gap-2" data-testid="feedback-screenshot">
          <template v-if="flat || rawShot">
            <p class="text-sm font-medium">{{ t('feedback.screenshot.label') }}</p>
            <FeedbackImage
              v-if="flat"
              :bitmap="flat.bitmap"
              :label="t('feedback.screenshot.previewFinal')"
              max-height-class="max-h-40"
              data-testid="feedback-screenshot-thumb"
            />
            <FeedbackImage
              v-else-if="rawShot"
              :bitmap="rawShot"
              :annotations="annotations"
              :label="t('feedback.screenshot.preview', { n: annotations.length }, annotations.length)"
              max-height-class="max-h-40"
              data-testid="feedback-screenshot-thumb"
            />
            <div class="flex items-center gap-2">
              <UButton v-if="rawShot" color="neutral" variant="soft" size="sm" data-testid="feedback-screenshot-edit" @click="toAnnotate">
                {{ t('feedback.screenshot.edit') }}
              </UButton>
              <UButton color="neutral" variant="ghost" size="sm" data-testid="feedback-screenshot-remove" @click="removeScreenshot">
                {{ t('feedback.screenshot.remove') }}
              </UButton>
            </div>
          </template>
          <template v-else>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-ph-camera"
              class="self-start"
              :loading="capturePending"
              data-testid="feedback-add-screenshot"
              @click="startCapture"
            >
              {{ t('feedback.screenshot.add') }}
            </UButton>
            <p class="text-xs text-muted">{{ t('feedback.screenshot.hint') }}</p>
          </template>
          <p v-if="captureFailure" class="text-sm text-error-700" role="alert" data-testid="feedback-screenshot-failed">
            {{ captureFailure === 'too_large' ? t('feedback.screenshot.tooLarge') : t('feedback.screenshot.failed') }}
          </p>
        </div>

        <p class="text-sm text-toned" data-testid="feedback-public-note">
          {{ t('feedback.public') }}
          <template v-if="fallbackKnown">{{ t('feedback.publicAccount') }}</template>
        </p>

        <p class="flex items-center gap-2 text-xs text-muted" data-testid="feedback-context-line">
          <span>{{ t('feedback.contextLine', { summary: contextSummary }) }}</span>
          <UButton color="neutral" variant="link" size="xs" :disabled="!titleValid" class="p-0" @click="toReview">
            {{ t('feedback.contextReview') }}
          </UButton>
        </p>
      </form>

      <FeedbackAnnotator v-else-if="step === 'annotate'" />

      <div v-else class="flex flex-col gap-5" data-testid="feedback-review">
        <p ref="introRef" tabindex="-1" class="text-sm text-toned outline-none" data-testid="feedback-review-intro">{{ t(canSend ? 'feedback.review.intro' : 'feedback.review.introBrowser', { repo: FEEDBACK_REPO }) }}</p>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">{{ t('feedback.review.contextHeading') }}</legend>
          <UCheckbox
            v-if="draft.element"
            v-model="draft.include.element"
            :label="t('feedback.review.itemElement', { name: elementName })"
            color="neutral"
            data-testid="feedback-include-element"
          />
          <UCheckbox
            v-if="draft.element?.taskId && draft.include.element"
            v-model="draft.include.taskTitle"
            :label="t('feedback.review.itemTaskTitle')"
            :description="t('feedback.review.itemTaskTitleHint')"
            class="ml-6"
            color="neutral"
            data-testid="feedback-include-task-title"
          />
          <UCheckbox
v-model="draft.include.environment" :label="t('feedback.review.itemEnvironment')" color="neutral"
            data-testid="feedback-include-environment" />
          <UCheckbox
v-model="draft.include.version" :label="t('feedback.review.itemVersion')" color="neutral"
            data-testid="feedback-include-version" />
          <UCheckbox
v-if="logTail" v-model="draft.include.log" :label="t('feedback.review.itemLog')" color="neutral"
            data-testid="feedback-include-log" />
          <UCheckbox
            v-if="flat"
            v-model="draft.include.screenshot"
            :label="t('feedback.review.itemScreenshot')"
            color="neutral"
            data-testid="feedback-include-screenshot"
          />
        </fieldset>

        <section v-if="flat && draft.include.screenshot" class="flex flex-col gap-2" data-testid="feedback-review-image">
          <h3 class="text-sm font-medium">{{ t('feedback.screenshot.label') }}</h3>
          <FeedbackImage :bitmap="flat.bitmap" :label="t('feedback.screenshot.previewFinal')" max-height-class="max-h-72" />
          <p class="text-sm text-toned" data-testid="feedback-delivery">{{ deliveryText }}</p>
        </section>

        <section>
          <h3 class="mb-1 text-sm font-medium">{{ t('feedback.review.previewHeading') }}</h3>
          <p class="mb-2 text-sm text-toned">{{ draft.title.trim() }}</p>
          <!-- tabindex: a scrollable region must be reachable by keyboard -->
          <pre
            role="region"
            :aria-label="t('feedback.review.previewHeading')"
            class="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap text-toned"
            tabindex="0"
            data-testid="feedback-body-preview"
          >{{ body }}</pre>
        </section>

        <!-- Without a token the intro already names the browser path; only a refused token needs its own line -->
        <p v-if="tokenState === 'rejected'" class="text-sm text-toned" data-testid="feedback-fallback-note">
          {{ t('feedback.fallback.rejected') }}
          <ULink to="/settings/github" class="underline" @click="close">{{ t('feedback.fallback.accessLink') }}</ULink>
        </p>
        <p v-if="fallbackKnown && prefilled.trimmed.length" class="text-sm text-toned" data-testid="feedback-trimmed-note">
          {{ t('feedback.fallback.trimmed', { parts: trimmedParts }) }}
        </p>
        <p v-if="fallbackKnown && prefilled.overflow" class="text-sm text-toned">{{ t('feedback.fallback.overflow') }}</p>

        <p v-if="problem" class="text-sm text-error-700" role="alert" data-testid="feedback-problem">
          {{ problemText }}
          <ULink v-if="problem === 'rejected'" to="/settings/github" class="underline" @click="close">{{ t('feedback.fallback.accessLink') }}</ULink>
        </p>
        <p v-if="clipboardFailed" class="text-sm text-error-700" role="alert" data-testid="feedback-clipboard-failed">{{ t('feedback.problem.clipboardFailed') }}</p>
        <p v-if="sending" class="text-sm text-muted" role="status">{{ sendingText }}</p>
      </div>
    </template>

    <template #footer>
      <template v-if="step === 'form'">
        <UButton v-if="hasDraft" color="neutral" variant="ghost" class="mr-auto" data-testid="feedback-discard" @click="discard">
          {{ t('feedback.discardDraft') }}
        </UButton>
        <UButton v-else-if="canUndoDiscard" color="neutral" variant="ghost" class="mr-auto" data-testid="feedback-undo-discard" @click="undoDiscard">
          {{ t('common.undo') }}
        </UButton>
        <UButton color="neutral" variant="ghost" data-testid="feedback-cancel" @click="close">{{ t('common.cancel') }}</UButton>
        <UButton size="lg" color="primary" :disabled="!titleValid" data-testid="feedback-next" @click="toReview">{{ t('feedback.next') }}</UButton>
      </template>
      <template v-else-if="step === 'annotate'">
        <UButton color="neutral" variant="ghost" data-testid="annotate-back" @click="toForm">{{ t('feedback.annotate.back') }}</UButton>
        <UButton size="lg" color="primary" data-testid="annotate-done" @click="finishAnnotate">{{ t('feedback.annotate.done') }}</UButton>
      </template>
      <template v-else>
        <UButton color="neutral" variant="ghost" :disabled="sending" data-testid="feedback-back" @click="toForm">{{ t('common.back') }}</UButton>
        <UButton size="lg" v-if="canSend" color="primary" :loading="sending" data-testid="feedback-send" @click="send">
          {{ sendLabel }}
        </UButton>
        <UButton
          size="lg"
          v-else color="primary" icon="i-ph-arrow-square-out" :disabled="tokenState === 'unknown'" :loading="tokenState === 'unknown'"
          data-testid="feedback-open-browser" @click="openInBrowser">
          {{ t('feedback.review.openOnGithub') }}
        </UButton>
      </template>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MODAL_WIDTH } from '~/utils/modalSizes'
import { useFeedback } from '~/composables/useFeedback'
import FeedbackAnnotator from '~/components/feedback/FeedbackAnnotator.vue'
import FeedbackImage from '~/components/feedback/FeedbackImage.vue'
import { FEEDBACK_REPO } from '~/lib/feedback/types'

defineOptions({ name: 'FeedbackDialog' })

const { t } = useI18n()
const {
  isOpen, step, draft, sending, problem, tokenState, titleValid, hasDraft, canUndoDiscard, body, prefilled, canSend, contextSummary, limits, logTail,
  close, discard, undoDiscard, startPick, onDialogLeft, toReview, toForm, send, openInBrowser,
  rawShot, flat, annotations, capturePending, captureFailure, captureAvailable, sendPhase, sendsWithoutImage, screenshotDelivery, clipboardFailed,
  startCapture, toAnnotate, removeScreenshot, finishAnnotate,
} = useFeedback()

const stepTitle = computed(() => {
  if (step.value === 'annotate') return t('feedback.annotate.title')
  return step.value === 'form' ? t('feedback.title') : t('feedback.review.title')
})

/** One line on what happens to the image (review step). */
const deliveryText = computed(() => {
  if (screenshotDelivery.value === 'upload') return t('feedback.review.delivery.upload')
  return t(canSend.value ? 'feedback.review.delivery.clipboardIssue' : 'feedback.review.delivery.clipboardUrl')
})

const sendLabel = computed(() => {
  if (sendsWithoutImage.value) return t('feedback.review.sendWithoutImage')
  return problem.value && problem.value !== 'uploadDenied' ? t('feedback.review.retry') : t('feedback.review.send')
})

const sendingText = computed(() => {
  if (sendPhase.value === 'uploading') return t('feedback.review.uploading')
  return sendPhase.value === 'creating' ? t('feedback.review.creating') : t('feedback.review.sending')
})

// Moving to the other step removes the focused button: put focus on the new step so keyboard and
// screen-reader users land at its start (the review intro is read first, never the send button).
const introRef = ref<HTMLElement | null>(null)
watch(step, async (value) => {
  await nextTick()
  if (value === 'review') introRef.value?.focus({ preventScroll: true })
  else if (value === 'annotate') document.querySelector<HTMLElement>('[data-testid="annotate-tool-rect"]')?.focus({ preventScroll: true })
  else document.querySelector<HTMLElement>('[data-testid="feedback-title"]')?.focus({ preventScroll: true })
})

// The fallback notes only make sense once the token check answered; before that the review is neutral.
const fallbackKnown = computed(() => !canSend.value && tokenState.value !== 'unknown')

const elementName = computed(() => draft.element?.chain[0] ?? draft.element?.testId ?? draft.element?.selector ?? '')

const trimmedParts = computed(() => [...new Set(prefilled.value.trimmed)]
  .map(part => t(part === 'log' ? 'feedback.fallback.trimmedLog' : 'feedback.fallback.trimmedContext'))
  .join(', '))

const problemText = computed(() => {
  switch (problem.value) {
    case 'offline': return t('feedback.problem.offline')
    case 'blocked': return t('feedback.problem.blocked')
    case 'server': return t('feedback.problem.server')
    case 'rejected': return t('feedback.fallback.rejected')
    case 'uploadDenied': return t('feedback.problem.uploadDenied')
    default: return t('feedback.problem.unexpected')
  }
})

/** Keeps the browser from restoring focus itself: `onDialogLeft` decides (board, never <body>). */
const contentProps = {
  'data-testid': 'feedback-dialog',
  onCloseAutoFocus: (event: Event) => event.preventDefault(),
}

/** Escape, overlay click and X only close: the draft stays for the session. */
const handleOpenChange = (value: boolean) => {
  if (!value) close()
}
</script>
