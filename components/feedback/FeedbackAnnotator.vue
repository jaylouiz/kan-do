<!--
@component FeedbackAnnotator
@kind block
@category input
@description The annotate step of the feedback dialog (#247, ADR 014): the native snapshot on a canvas with
three tools (Rechteck, Pfeil, Schwärzen), undo last, clear all, and the toggle "Aufgabentexte schwärzen".
@usage Rendered by FeedbackDialog for `step === 'annotate'`; the strokes live in `useFeedback` (module memory).
@avoid Only the annotate step of FeedbackDialog; not a general drawing surface.
@responsibility
- Pointer drawing: client coordinates are mapped to bitmap pixels through `getBoundingClientRect` because the
  canvas is CSS-scaled to the modal; a redaction is an opaque fill, no blur
- Tool buttons carry icon and name (typography over decoration) with `aria-pressed`; the canvas is `role="img"` with a
  text alternative that names the number of marks
- Drawing needs a pointer; the keyboard path is to leave the step ("Zurück") or rely on the default mask
-->
<template>
  <div class="flex flex-col gap-4" data-testid="feedback-annotate">
    <div class="flex flex-wrap items-center justify-between gap-2" role="group" :aria-label="t('feedback.annotate.tools')">
      <div class="flex items-center gap-1">
        <UButton
          v-for="entry in tools"
          :key="entry.tool"
          :icon="entry.icon"
          :label="entry.label"
          size="sm"
          :aria-pressed="tool === entry.tool"
          :variant="tool === entry.tool ? 'soft' : 'ghost'"
          :class="tool === entry.tool ? 'ring ring-accented ring-inset' : ''"
          color="neutral"
          :data-testid="`annotate-tool-${entry.tool}`"
          @click="tool = entry.tool"
        />
      </div>
      <div class="flex items-center gap-1">
        <UTooltip :text="t('feedback.annotate.undo')">
          <UButton
            icon="i-ph-arrow-counter-clockwise"
            variant="ghost"
            color="neutral"
            :disabled="!annotations.length"
            :aria-label="t('feedback.annotate.undo')"
            data-testid="annotate-undo"
            @click="undoAnnotation"
          />
        </UTooltip>
        <UTooltip :text="t('feedback.annotate.clear')">
          <UButton
            :icon="ICONS.delete"
            variant="ghost"
            color="neutral"
            :disabled="!annotations.length"
            :aria-label="t('feedback.annotate.clear')"
            data-testid="annotate-clear"
            @click="clearAnnotations"
          />
        </UTooltip>
      </div>
    </div>

    <canvas
      v-if="rawShot"
      ref="canvasRef"
      role="img"
      :aria-label="t('feedback.screenshot.preview', { n: annotations.length }, annotations.length)"
      class="mx-auto block size-auto max-h-96 max-w-full cursor-crosshair touch-none rounded-lg ring ring-default"
      data-testid="annotate-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="cancelStroke"
    />

    <div class="flex flex-col gap-2">
      <UCheckbox
        :model-value="maskPrivate"
        :label="t('feedback.annotate.mask')"
        :description="t('feedback.annotate.maskHint')"
        color="neutral"
        data-testid="annotate-mask"
        @update:model-value="(value) => setMaskPrivate(value === true)"
      />
      <p v-if="captureFailure" class="text-sm text-error-700" role="alert" data-testid="annotate-capture-failed">
        {{ captureFailure === 'too_large' ? t('feedback.screenshot.tooLarge') : t('feedback.screenshot.failed') }}
      </p>
      <p class="text-xs text-muted" data-testid="annotate-hint">{{ t('feedback.annotate.drawHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFeedback } from '~/composables/useFeedback'
import { drawAnnotations, readAnnotationColors, toBitmapPoint, type Annotation, type AnnotationTool } from '~/lib/feedback/flattenCanvas'

defineOptions({ name: 'FeedbackAnnotator' })

const { t } = useI18n()
const { rawShot, annotations, maskPrivate, captureFailure, addAnnotation, undoAnnotation, clearAnnotations, setMaskPrivate } = useFeedback()

const tool = ref<AnnotationTool>('rect')
const tools = computed(() => [
  { tool: 'rect' as const, icon: 'i-ph-rectangle', label: t('feedback.annotate.rect') },
  { tool: 'arrow' as const, icon: ICONS.arrowTool, label: t('feedback.annotate.arrow') },
  { tool: 'redact' as const, icon: 'i-ph-eye-slash', label: t('feedback.annotate.redact') },
])

const canvasRef = ref<HTMLCanvasElement | null>(null)
/** The stroke being dragged; becomes a mark on pointer up. */
const stroke = ref<Annotation | null>(null)

function draw() {
  const canvas = canvasRef.value
  const bitmap = rawShot.value
  if (!canvas || !bitmap) return
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(bitmap, 0, 0)
  const marks = stroke.value ? [...annotations.value, stroke.value] : annotations.value
  drawAnnotations(ctx, marks, readAnnotationColors(), bitmap.width)
}

function pointAt(event: PointerEvent) {
  const canvas = canvasRef.value
  const bitmap = rawShot.value
  if (!canvas || !bitmap) return null
  return toBitmapPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), bitmap)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const point = pointAt(event)
  if (!point) return
  canvasRef.value?.setPointerCapture?.(event.pointerId)
  stroke.value = { tool: tool.value, x1: point.x, y1: point.y, x2: point.x, y2: point.y }
}

function onPointerMove(event: PointerEvent) {
  if (!stroke.value) return
  const point = pointAt(event)
  if (point) stroke.value = { ...stroke.value, x2: point.x, y2: point.y }
}

function onPointerUp(event: PointerEvent) {
  if (!stroke.value) return
  const point = pointAt(event)
  const finished = point ? { ...stroke.value, x2: point.x, y2: point.y } : stroke.value
  stroke.value = null
  addAnnotation(finished)
}

function cancelStroke() {
  stroke.value = null
}

watch([rawShot, annotations, stroke], draw)
onMounted(async () => {
  await nextTick()
  draw()
})
</script>
