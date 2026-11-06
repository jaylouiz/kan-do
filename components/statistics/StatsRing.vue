<!--
@component StatsRing
@description Hand-built SVG ring (DESIGN.md "Ink ring"): segments share one circle in the ink ramp, a neutral track, an optional tick for the user's usual value. No chart library.
@usage Verdict (in-timebox share), the Q3 estimate ring and the Q4 time donut on the Statistik page
@responsibility
- Draw up to six segments (percent of the circle, ramp step) separated by a small gap
- Carry the numbers as a text alternative (`role="img"` + `aria-label`); the centre slot is decoration and hidden from assistive tech
-->
<template>
  <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :viewBox="`0 0 ${size} ${size}`" :width="size" :height="size" role="img" :aria-label="label" class="-rotate-90">
      <circle :cx="center" :cy="center" :r="radius" fill="none" :stroke-width="thickness" stroke="var(--ui-bg-accented)" />
      <circle
        v-for="arc in arcs"
        :key="arc.step"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke-width="thickness"
        pathLength="100"
        :stroke="arc.color"
        :stroke-dasharray="`${arc.length} ${100 - arc.length}`"
        :stroke-dashoffset="-arc.start"
      />
      <g v-if="tick !== null" :transform="`rotate(${(tick / 100) * 360} ${center} ${center})`">
        <line
          :x1="center + radius - thickness / 2 - 3"
          :x2="center + radius + thickness / 2 + 3"
          :y1="center"
          :y2="center"
          stroke-width="3"
          stroke-linecap="round"
          stroke="var(--ui-text-highlighted)"
        />
      </g>
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { inkColor } from '~/lib/inkRamp'

defineOptions({ name: 'StatsRing' })

export interface RingSegment {
  /** Share of the circle, percent (0-100). */
  value: number
  /** Step of the ink ramp (0 = darkest). */
  step: number
}

const props = withDefaults(defineProps<{
  segments: RingSegment[]
  /** Text alternative that states the numbers. */
  label: string
  size?: number
  thickness?: number
  /** Position of the user's usual value on the circle, percent; `null` = no tick. */
  tick?: number | null
}>(), { size: 120, thickness: 14, tick: null })

const center = computed(() => props.size / 2)
const radius = computed(() => (props.size - props.thickness) / 2 - (props.tick !== null ? 4 : 0))
const GAP = 0.8

const arcs = computed(() => {
  const shown = props.segments.filter(s => s.value > 0)
  const gap = shown.length > 1 ? GAP : 0
  let at = 0
  return shown.map((s) => {
    const arc = { step: s.step, color: inkColor(s.step), start: at + gap / 2, length: Math.max(0.5, Math.min(100, s.value) - gap) }
    at += s.value
    return arc
  })
})
</script>
