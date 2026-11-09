<!--
@component UiCatalogTokenRow
@description One design token of the `/ui` Tokens part (#65): a preview, the token's name, its authored and resolved value and where it is defined.
@usage <UiCatalogTokenRow :token="token" :resolved="computedValue" />
@responsibility
- Draw the preview that fits the token's group (colour swatch, type sample, radius, shadow); other groups show text only
- Name the definition (file and line), a trailing source comment and the values under a media query
- Stay dev-only: lives in `dev-tools/`, never imported from shipped code (the route is removed at build time, lib/devPages.ts)
-->
<template>
  <li class="flex gap-3 border-b border-default py-2.5">
    <div v-if="hasPreview" class="flex h-10 w-16 shrink-0 items-center justify-center" aria-hidden="true">
      <span v-if="token.group === 'colors'" class="block size-9 rounded-md border border-default" :style="{ background: `var(${token.name})` }" />
      <span v-else-if="token.group === 'radius'" class="block size-9 border-2 border-default bg-elevated" :style="{ borderRadius: `var(${token.name})` }" />
      <span v-else-if="token.group === 'shadows'" class="block size-9 rounded-md bg-default" :style="shadowStyle" />
      <span v-else class="text-lg text-highlighted" :style="typeStyle">Aa</span>
    </div>
    <div class="min-w-0 flex-1">
      <code class="block font-mono text-sm break-all text-highlighted">{{ token.name }}</code>
      <p class="text-sm break-words text-default">
        {{ token.value }}
        <span v-if="showResolved" class="text-muted"> = {{ resolved }}</span>
      </p>
      <p class="text-xs break-words text-muted">
        {{ token.file }}:{{ token.line }}<template v-if="token.note"> · {{ token.note }}</template>
        <template v-if="token.replaces"> · replaces {{ token.replaces.value }} from {{ token.replaces.file }}</template>
      </p>
      <p v-for="r in token.responsive" :key="`${r.file}:${r.line}`" class="text-xs break-words text-muted">
        {{ r.when }}: {{ r.value }} ({{ r.file }}:{{ r.line }})
      </p>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Token } from './tokens'

defineOptions({ name: 'UiCatalogTokenRow' })

const props = defineProps<{
  token: Token
  /** The value the browser computes for the property on `:root` (var() chains and calc() resolved); empty before mount. */
  resolved?: string
}>()

/** Type tokens get a sample; companion tokens like `--text-xs--line-height` (a second `--`) are text only. */
const sample = computed(() => props.token.group === 'typography' && !props.token.name.includes('--', 2))

const hasPreview = computed(() => ['colors', 'radius', 'shadows'].includes(props.token.group) || sample.value)

const showResolved = computed(() => !!props.resolved && props.resolved !== props.token.value)

/** Drop shadows (`drop-shadow(...)`) are filters, everything else a box-shadow. */
const shadowStyle = computed(() => (props.token.value.startsWith('drop-shadow(') ? { filter: `var(${props.token.name})` } : { boxShadow: `var(${props.token.name})` }))

const typeStyle = computed(() => {
  const name = props.token.name
  if (name.startsWith('--font-weight-')) return { fontWeight: `var(${name})` }
  if (name.startsWith('--font-')) return { fontFamily: `var(${name})` }
  if (name.startsWith('--text-')) return { fontSize: `var(${name})`, lineHeight: 1 }
  if (name.startsWith('--tracking-')) return { letterSpacing: `var(${name})` }
  if (name.startsWith('--leading-') || name.startsWith('--lh-')) return { lineHeight: `var(${name})` }
  return {}
})
</script>
