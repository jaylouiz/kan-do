<!--
@component FeedbackImage
@description Shows a screenshot of the feedback dialog on a `<canvas>` (#247, ADR 014). The image only ever
lives in an `ImageBitmap`; it is never turned into an `<img>` with a blob or data source, so the CSP keeps
`img-src 'self'`.
@usage <FeedbackImage :bitmap="flat.bitmap" :label="t('feedback.screenshot.previewFinal')" />
@responsibility
- Draws the bitmap (and optional marks) at its own pixel size; CSS scales it to the width of the dialog
- `role="img"` with a text alternative from the caller
-->
<template>
  <canvas
    ref="canvasRef"
    role="img"
    :aria-label="label"
    class="block h-auto rounded-lg ring ring-default"
    :class="maxHeightClass ? `w-auto max-w-full ${maxHeightClass}` : 'w-full'"
  />
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { drawAnnotations, readAnnotationColors, type Annotation } from '~/lib/feedback/flattenCanvas'

defineOptions({ name: 'FeedbackImage' })

interface Props {
  bitmap: ImageBitmap
  label: string
  annotations?: readonly Annotation[]
  /** Caps the height (thumbnail in the form); the image keeps its ratio. */
  maxHeightClass?: string
}

const props = withDefaults(defineProps<Props>(), { annotations: () => [], maxHeightClass: '' })

const canvasRef = ref<HTMLCanvasElement | null>(null)

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = props.bitmap.width
  canvas.height = props.bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(props.bitmap, 0, 0)
  drawAnnotations(ctx, props.annotations, readAnnotationColors(), props.bitmap.width)
}

onMounted(draw)
watch(() => [props.bitmap, props.annotations], draw)
</script>
