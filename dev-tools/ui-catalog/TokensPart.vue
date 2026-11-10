<!--
@component UiCatalogTokensPart
@description The Tokens part of `/ui` (#65): colours, type, radii, shadows, spacing, z-index, motion, breakpoints and icon sizes, read from the real sources.
@usage <UiCatalogTokensPart :group="view.group" /> inside `pages/ui.vue`.
@responsibility
- Read the stylesheets as text (`assets/css/*.css`, Tailwind's theme, Nuxt UI's runtime CSS) and the app config (`useAppConfig().ui`), group what they define (tokens.ts) and show each token with its value and where it is defined
- Show what the browser resolves for each token (`getComputedStyle` on `:root`) next to the authored value
- List only what the code defines: an empty group says so, nothing is typed in here
- One group at a time (kd#127): `group` names the section to show (`roles`, `palettes`, a token group id, `components`); without it the part lists the sections as cards with their token count, and `*` shows every section (the one-page view)
- Chrome is English (epic #58 D2); light only; rows wrap instead of scrolling, so it reads at 390 px
-->
<template>
  <section id="tokens" aria-labelledby="tokens-title" class="space-y-10">
    <div>
      <h2 id="tokens-title" tabindex="-1" class="font-display text-2xl text-highlighted outline-none" data-kd-view-title>Tokens</h2>
      <p v-if="!group || group === '*'" class="mt-1 max-w-3xl text-sm text-muted">
        Generated from the stylesheets and the app config, never typed. {{ catalog.tokens.length }} custom properties from
        {{ cssFileCount }} files in <code class="font-mono">assets/css</code>, Tailwind's theme, Nuxt UI's runtime CSS and <code class="font-mono">app.config.ts</code>.
        {{ catalog.scopedCount }} more are set on a single component selector and not listed.
      </p>
    </div>

    <ul v-if="!group" class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Token groups">
      <li v-for="section in sections" :key="section.id" class="relative rounded-lg border border-default bg-default p-4">
        <NuxtLink :to="{ path: '/ui', query: { v: `tokens.${section.id}` } }" class="inline-flex min-h-6 items-center font-display text-lg text-highlighted after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-primary">
          {{ section.title }}
        </NuxtLink>
        <p class="mt-1 text-sm text-muted">{{ section.hint }}</p>
        <p class="mt-2 text-xs text-muted">{{ section.count }} {{ section.unit }}</p>
      </li>
    </ul>

    <section v-if="shows('roles')" aria-labelledby="tokens-roles" class="space-y-3">
      <h3 id="tokens-roles" class="font-display text-xl text-highlighted">{{ tokenSectionTitle('roles') }}</h3>
      <p class="text-sm text-muted">
        <code class="font-mono">ui.colors</code> in <code class="font-mono">app.config.ts</code> maps each role to a palette; every Nuxt UI component takes its colour from the role.
      </p>
      <ul class="space-y-4">
        <li v-for="role in appConfig.colorRoles" :key="role.role">
          <p class="text-sm text-highlighted">
            <code class="font-mono">{{ role.role }}</code> → <code class="font-mono">{{ role.palette }}</code>
            <span v-if="FROZEN_PALETTES.includes(role.palette)" class="text-muted"> · frozen (DESIGN.md)</span>
          </p>
          <ul class="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-11">
            <li v-for="step in roleSteps(role.role)" :key="step" class="min-w-0">
              <span class="block h-8 rounded-sm border border-default" :style="{ background: `var(--ui-color-${role.role}-${step})` }" />
              <span class="block text-xs text-muted">{{ step }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <section v-if="shows('palettes')" aria-labelledby="tokens-palettes" class="space-y-3">
      <h3 id="tokens-palettes" class="font-display text-xl text-highlighted">{{ tokenSectionTitle('palettes') }}</h3>
      <p class="text-sm text-muted">Colour ramps the app defines itself in the Tailwind theme (<code class="font-mono">@theme</code> in <code class="font-mono">assets/css/main.css</code>).</p>
      <div v-for="ramp in ramps" :key="ramp.name" class="space-y-1.5">
        <p class="text-sm text-highlighted">
          <code class="font-mono">{{ ramp.name }}</code>
          <span v-if="FROZEN_PALETTES.includes(ramp.name)" class="text-muted"> · frozen (DESIGN.md)</span>
          <span class="text-muted"> · {{ ramp.steps[0]?.file }}:{{ ramp.steps[0]?.line }}</span>
        </p>
        <ul class="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-11">
          <li v-for="token in ramp.steps" :key="token.name" class="min-w-0">
            <span class="block h-8 rounded-sm border border-default" :style="{ background: `var(${token.name})` }" />
            <span class="block text-xs text-highlighted">{{ stepOf(token.name) }}</span>
            <span class="block text-xs break-all text-muted">{{ token.value }}</span>
          </li>
        </ul>
      </div>
    </section>

    <section v-for="tokenGroup in shownGroups" :key="tokenGroup.id" :aria-labelledby="`tokens-${tokenGroup.id}`" class="space-y-3">
      <h3 :id="`tokens-${tokenGroup.id}`" class="font-display text-xl text-highlighted">{{ tokenGroup.title }}</h3>
      <p class="max-w-3xl text-sm text-muted">{{ tokenGroup.hint }}</p>
      <ul v-if="tokenGroup.tokens.length" class="grid grid-cols-1 gap-x-10 lg:grid-cols-2 2xl:grid-cols-3">
        <UiCatalogTokenRow v-for="token in tokenGroup.tokens" :key="token.name" :token="token" :resolved="resolved[token.name]" />
      </ul>
      <p v-else class="text-sm text-default">No {{ tokenGroup.title.toLowerCase() }} tokens are defined in the scanned sources.</p>
      <template v-if="tokenGroup.id === 'zIndex'">
        <p class="text-sm text-default">
          {{ catalog.zIndexLiterals.length }} literal <code class="font-mono">z-index</code> declarations sit in <code class="font-mono">assets/css</code> (numeric values only; Tailwind <code class="font-mono">z-*</code> utilities in templates are not scanned):
        </p>
        <ul class="text-xs text-muted">
          <li v-for="decl in catalog.zIndexLiterals" :key="`${decl.file}:${decl.line}`" class="break-words">
            <code class="font-mono text-default">{{ decl.value }}</code> · {{ decl.context.filter(c => !c.startsWith('@')).join(' ') || 'root' }} · {{ decl.file }}:{{ decl.line }}
          </li>
        </ul>
      </template>
    </section>

    <section v-if="shows('components')" aria-labelledby="tokens-components" class="space-y-3">
      <h3 id="tokens-components" class="font-display text-xl text-highlighted">{{ tokenSectionTitle('components') }}</h3>
      <p class="text-sm text-muted">
        What <code class="font-mono">app.config.ts</code> sets per Nuxt UI component: default variants, and the slots and variants it overrides.
      </p>
      <ul class="grid grid-cols-1 gap-x-10 lg:grid-cols-2 2xl:grid-cols-3">
        <li v-for="component in appConfig.components" :key="component.name" class="border-b border-default py-2.5">
          <code class="font-mono text-sm text-highlighted">{{ component.name }}</code>
          <p class="text-sm break-words text-default">{{ component.defaultVariants || 'no default variants set' }}</p>
          <p class="text-xs break-words text-muted">
            <template v-if="component.slots.length">slots: {{ component.slots.join(', ') }}</template>
            <template v-if="component.slots.length && component.variants.length"> · </template>
            <template v-if="component.variants.length">variants: {{ component.variants.join(', ') }}</template>
          </p>
        </li>
      </ul>
      <p v-if="!appConfig.components.length" class="text-sm text-default">app.config.ts sets no component defaults.</p>
      <template v-if="appConfig.radius.length">
        <p class="text-sm text-default"><code class="font-mono">ui.radius</code> in <code class="font-mono">app.config.ts</code>:</p>
        <p class="text-xs text-muted">{{ appConfig.radius.map(r => `${r.key} ${r.value}`).join(' · ') }}</p>
      </template>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppConfig } from '#imports'
import tailwindTheme from 'tailwindcss/theme.css?raw'
import nuxtUiCss from '@nuxt/ui/runtime/index.css?raw'
import UiCatalogTokenRow from './TokenRow.vue'
import { tokenSectionTitle } from './catalogNav'
import { buildTokenCatalog, splitRamps, summarizeAppConfig, type Token, type TokenGroupId } from './tokens'

defineOptions({ name: 'UiCatalogTokensPart' })

const props = defineProps<{
  /** The section to show; none lists the sections, `*` shows them all. */
  group?: string
}>()

/** Palettes DESIGN.md freezes: a change needs a recorded decision. */
const FROZEN_PALETTES = ['custom-ink']
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

const cssFiles = import.meta.glob('../../assets/css/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const ownSources = Object.entries(cssFiles)
  .map(([path, css]) => ({ file: path.replace('../../', ''), css }))
  // main.css holds `@theme` and the `:root` defaults and comes last, like the cascade: the partials sit above it
  .sort((a, b) => Number(a.file.endsWith('/main.css')) - Number(b.file.endsWith('/main.css')) || a.file.localeCompare(b.file))
const cssFileCount = ownSources.length

const catalog = buildTokenCatalog([
  { file: 'tailwindcss/theme.css', css: tailwindTheme, vendor: 'tailwind' },
  { file: '@nuxt/ui runtime/index.css', css: nuxtUiCss },
  ...ownSources,
])
const appConfig = summarizeAppConfig(useAppConfig().ui as Record<string, unknown>)

const GROUPS: { id: TokenGroupId, title: string, hint: string }[] = [
  { id: 'colors', title: tokenSectionTitle('colors'), hint: 'Slots Nuxt UI components read (text, background, border) and the app\'s own colour tokens, with the swatch the browser paints.' },
  { id: 'typography', title: tokenSectionTitle('typography'), hint: 'Font stacks, the size scale and its line heights, weights, tracking and the app\'s line-height steps.' },
  { id: 'radius', title: tokenSectionTitle('radius'), hint: 'The base radius Nuxt UI derives its steps from, Tailwind\'s steps and the app\'s own.' },
  { id: 'shadows', title: tokenSectionTitle('shadows'), hint: 'Elevation of cards, stacks, sheets and overlays.' },
  { id: 'spacing', title: tokenSectionTitle('spacing'), hint: 'The spacing unit and the dimension tokens of cards, columns, stacks and the app bar. Values under a media query are listed beneath their token.' },
  { id: 'zIndex', title: tokenSectionTitle('zIndex'), hint: 'Stacking tokens.' },
  { id: 'motion', title: tokenSectionTitle('motion'), hint: 'Durations and easings.' },
  { id: 'breakpoints', title: tokenSectionTitle('breakpoints'), hint: 'Tailwind\'s responsive steps. The app switches layout at 768 px (`md`); that step is written once for CSS and JS in `lib/breakpoints.ts`.' },
  { id: 'iconSizes', title: tokenSectionTitle('iconSizes'), hint: 'Icon size tokens.' },
  { id: 'other', title: tokenSectionTitle('other'), hint: 'Root-level custom properties that fit none of the groups above.' },
]

const colorTokens = catalog.tokens.filter(t => t.group === 'colors')
const { ramps, rest } = splitRamps(colorTokens)
const groups = computed(() => GROUPS
  .map(group => ({ ...group, tokens: group.id === 'colors' ? rest : catalog.tokens.filter(t => t.group === group.id) }))
  // keep the always-listed groups the issue names (empty ones say so), hide "other" when empty
  .filter(group => group.id !== 'other' || group.tokens.length))

const shows = (id: string) => props.group === '*' || props.group === id
const shownGroups = computed(() => groups.value.filter(tokenGroup => shows(tokenGroup.id)))

/** Every section with what it holds, for the group cards and the page title. */
const sections = computed(() => [
  { id: 'roles', title: tokenSectionTitle('roles'), hint: 'Which palette each role (primary, error, neutral) takes its colour from.', count: appConfig.colorRoles.length, unit: 'roles' },
  { id: 'palettes', title: tokenSectionTitle('palettes'), hint: 'Colour ramps the app defines itself in the Tailwind theme.', count: ramps.length, unit: 'ramps' },
  ...groups.value.map(tokenGroup => ({ id: tokenGroup.id as string, title: tokenGroup.title, hint: tokenGroup.hint, count: tokenGroup.tokens.length, unit: 'tokens' })),
  { id: 'components', title: tokenSectionTitle('components'), hint: 'Default variants and the slots and variants app.config.ts overrides per Nuxt UI component.', count: appConfig.components.length, unit: 'components' },
])

const stepOf = (name: string) => name.slice(name.lastIndexOf('-') + 1)

/** Role ramps exist as `--ui-color-<role>-<step>` once Nuxt UI has generated them; only steps the browser knows are drawn. */
const definedVars = ref<Set<string>>(new Set())
const resolved = ref<Record<string, string>>({})
const roleSteps = (role: string) => STEPS.filter(step => definedVars.value.has(`--ui-color-${role}-${step}`))

onMounted(() => {
  const style = getComputedStyle(document.documentElement)
  const values: Record<string, string> = {}
  for (const token of catalog.tokens as Token[]) values[token.name] = style.getPropertyValue(token.name).trim()
  resolved.value = values
  const known = new Set<string>()
  for (const role of appConfig.colorRoles) {
    for (const step of STEPS) {
      const name = `--ui-color-${role.role}-${step}`
      if (style.getPropertyValue(name).trim()) known.add(name)
    }
  }
  definedVars.value = known
})
</script>
