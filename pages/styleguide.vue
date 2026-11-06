<!--
@component StyleGuide
@description Design-system reference — tokens, components, and patterns in one place
@usage /styleguide in development
@responsibility
- Document the three-layer SSOT: primitives → semantic aliases → component defaults
- Showcase every UI component for visual regression reference
- Allow developers to spot inconsistencies without navigating multiple workflows
-->

<template>
  <div>
    <!-- Sticky section navigation -->
    <div class="pt-safe px-safe sticky top-0 z-20 border-b border-default bg-page/90 backdrop-blur-sm">
      <UContainer>
        <nav class="flex gap-1 overflow-x-auto py-2" style="scrollbar-width: none;">
          <a
            v-for="nav in navSections"
            :key="nav.id"
            :href="`#${nav.id}`"
            :class="[
              'shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
              activeSection === nav.id
                ? 'bg-muted font-medium text-highlighted'
                : 'text-muted hover:bg-muted hover:text-default'
            ]"
            @click.prevent="scrollToSection(nav.id)"
          >
            {{ nav.label }}
          </a>
        </nav>
      </UContainer>
    </div>

    <UContainer class="space-y-16 py-8">

      <!-- Header -->
      <section>
        <h1 class="font-display mb-1 text-3xl">Stil-Leitfaden</h1>
        <p class="text-muted">Design-Token, Komponenten und Muster — drei Schichten, eine Quelle der Wahrheit.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge variant="soft" color="neutral" size="sm">
            <code class="font-mono text-xs">assets/css/main.css</code>
            <span class="ml-1 text-muted">Primitives &amp; Aliase</span>
          </UBadge>
          <UBadge variant="soft" color="neutral" size="sm">
            <code class="font-mono text-xs">nuxt.config.ts</code>
            <span class="ml-1 text-muted">Farbslots registrieren</span>
          </UBadge>
          <UBadge variant="soft" color="neutral" size="sm">
            <code class="font-mono text-xs">app.config.ts</code>
            <span class="ml-1 text-muted">Komponenten-Defaults</span>
          </UBadge>
        </div>
      </section>

      <!-- ─────────────────────────────────────────
           1. TOKENS
           ───────────────────────────────────────── -->
      <section id="tokens" class="scroll-mt-16">
        <h2 class="font-display mb-8 text-2xl">Design-Tokens</h2>

        <!-- 1a · Semantic Surfaces -->
        <div class="mb-10">
          <h3 class="font-display mb-1 text-xl">Semantische Oberflächen</h3>
          <p class="mb-4 text-sm text-muted">Licht/dunkel-adaptive Tokens. Definiert in <code class="font-mono text-xs">main.css :root</code> als Overrides der Nuxt UI Defaults.</p>

          <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
            <!-- Background surfaces -->
            <div>
              <p class="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Hintergründe</p>
              <table class="w-full border-separate border-spacing-0 overflow-hidden rounded-lg text-sm">
                <thead>
                  <tr class="bg-muted">
                    <th class="border-b border-default px-3 py-2 text-left font-medium">Token</th>
                    <th class="border-b border-default px-3 py-2 text-left font-medium">Vorschau</th>
                    <th class="border-b border-default px-3 py-2 text-left font-medium">Utility</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="surface in bgSurfaces" :key="surface.token">
                    <td class="border-b border-default px-3 py-2">
                      <code class="font-mono text-xs">{{ surface.token }}</code>
                    </td>
                    <td class="border-b border-default px-3 py-2">
                      <div :class="`h-6 w-16 rounded border border-default ${surface.utility}`" />
                    </td>
                    <td class="border-b border-default px-3 py-2">
                      <code class="font-mono text-xs text-muted">{{ surface.utility }}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Text hierarchy -->
            <div>
              <p class="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Text-Hierarchie</p>
              <table class="w-full border-separate border-spacing-0 overflow-hidden rounded-lg text-sm">
                <thead>
                  <tr class="bg-muted">
                    <th class="border-b border-default px-3 py-2 text-left font-medium">Token</th>
                    <th class="border-b border-default px-3 py-2 text-left font-medium">Beispiel</th>
                    <th class="border-b border-default px-3 py-2 text-left font-medium">Utility</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="text in textHierarchy" :key="text.token">
                    <td class="border-b border-default px-3 py-2">
                      <code class="font-mono text-xs">{{ text.token }}</code>
                    </td>
                    <td :class="`border-b border-default px-3 py-2 ${text.utility}`">
                      Beispieltext
                    </td>
                    <td class="border-b border-default px-3 py-2">
                      <code class="font-mono text-xs text-muted">{{ text.utility }}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 1b · Semantic Color Roles -->
        <div class="mb-10">
          <h3 class="font-display mb-1 text-xl">Semantische Farbrollen</h3>
          <p class="mb-4 text-sm text-muted">Gemappt in <code class="font-mono text-xs">app.config.ts → ui.colors</code>. Alle Nuxt UI Komponenten leiten ihre Farbe von diesen Rollen ab.</p>

          <table class="mb-6 w-full border-separate border-spacing-0 overflow-hidden rounded-lg text-sm">
            <thead>
              <tr class="bg-muted">
                <th class="border-b border-default px-3 py-2 text-left font-medium">Rolle</th>
                <th class="border-b border-default px-3 py-2 text-left font-medium">Swatch</th>
                <th class="border-b border-default px-3 py-2 text-left font-medium">Palette</th>
                <th class="border-b border-default px-3 py-2 text-left font-medium">Verwendung</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="role in colorRoles" :key="role.role">
                <td class="border-b border-default px-3 py-2">
                  <UBadge :color="role.role as any" variant="soft" size="sm">{{ role.role }}</UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex gap-0.5">
                    <div
                      v-for="shade in ['200','400','500','700']"
                      :key="shade"
                      class="size-5  rounded-sm"
                      :style="{ background: `var(--ui-color-${role.role}-${shade})` }"
                    />
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <code class="font-mono text-xs text-muted">{{ role.palette }}</code>
                </td>
                <td class="border-b border-default px-3 py-2 text-muted">{{ role.description }}</td>
              </tr>
            </tbody>
          </table>

          <!-- Shade scales for all semantic colors -->
          <div class="space-y-3">
            <p class="text-xs font-medium tracking-widest text-muted uppercase">Farbstufen 50–900</p>
            <div v-for="color in semanticColors" :key="color">
              <div class="mb-1 flex items-center gap-2">
                <span class="w-16 shrink-0 text-xs text-muted">{{ color }}</span>
                <div class="grid flex-1 grid-cols-10 gap-1">
                  <div
                    v-for="shade in shades"
                    :key="shade"
                    class="overflow-hidden rounded border border-default"
                  >
                    <div class="h-7" :style="{ background: `var(--ui-color-${color}-${shade})` }" />
                    <div class="text-2xs bg-elevated p-0.5  text-center text-muted">
                      <code>{{ shade }}</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 1c · Primitive Palettes -->
        <div class="mb-10">
          <h3 class="font-display mb-1 text-xl">Primitive Farbpaletten</h3>
          <p class="mb-4 text-sm text-muted">Eigene Farbpaletten, registriert in <code class="font-mono text-xs">main.css → @theme static</code>. Bilden die Grundlage für alle Farbrollen.</p>
          <div class="space-y-4">
            <div v-for="palette in colorPalettes" :key="palette.name">
              <div class="mb-1.5 flex items-center gap-2">
                <span class="text-sm font-medium">{{ palette.name }}</span>
                <code class="font-mono text-xs text-muted">{{ palette.varPrefix }}-*</code>
                <UBadge :color="palette.badgeColor as any" variant="soft" size="xs">{{ palette.role }}</UBadge>
              </div>
              <div class="grid grid-cols-10 gap-1">
                <div
                  v-for="shade in palette.shades"
                  :key="shade"
                  class="overflow-hidden rounded border border-default"
                >
                  <div class="h-8" :style="{ background: `var(${palette.varPrefix}-${shade})` }" />
                  <div class="text-2xs bg-elevated p-0.5  text-center text-muted">
                    <code>{{ shade }}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 1d · Typography -->
        <div class="mb-10">
          <h3 class="font-display mb-1 text-xl">Typografie</h3>
          <p class="mb-4 text-sm text-muted">Zwei Schriften und eine Zeilenhöhen-Skala. Konfiguriert in <code class="font-mono text-xs">main.css :root</code>.</p>

          <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
            <!-- Font stacks -->
            <div class="rounded-lg border border-default bg-elevated p-4">
              <div class="space-y-4">
                <div>
                  <p class="text-2xs mb-2 font-medium tracking-widest text-muted uppercase">
                    Display · <code class="font-mono normal-case">--font-display</code> · Figtree 600
                  </p>
                  <p class="font-display text-3xl">Aufgaben im Fluss</p>
                  <p class="font-display text-2xl">Klare Köpfe, leere Listen</p>
                  <p class="font-display text-xl">Heute erledigen, morgen genießen</p>
                </div>
                <div>
                  <p class="text-2xs mb-2 font-medium tracking-widest text-muted uppercase">
                    Sans · <code class="font-mono normal-case">--font-sans</code> · Figtree
                  </p>
                  <p class="text-lg">Fließtext groß — Figtree 300–900</p>
                  <p class="text-base">Fließtext normal</p>
                  <p class="text-sm text-muted">Hinweistext, Metadaten</p>
                  <p class="text-xs text-muted">Etiketten, Badges, Codes</p>
                  <p class="text-2xs text-muted">Mikro-Beschriftungen (2xs · 0.625 rem)</p>
                </div>
              </div>
            </div>

            <!-- Line height scale -->
            <div class="rounded-lg border border-default bg-elevated p-4">
              <p class="text-2xs mb-3 font-medium tracking-widest text-muted uppercase">Zeilenhöhen</p>
              <div class="space-y-4">
                <div v-for="lh in lineHeights" :key="lh.name">
                  <div class="mb-1 flex items-baseline gap-2">
                    <code class="font-mono text-xs text-muted">{{ lh.var }}</code>
                    <span class="text-2xs text-muted">{{ lh.value }}</span>
                  </div>
                  <p class="rounded bg-muted/40 px-2 py-1 text-base" :style="{ lineHeight: lh.value }">
                    {{ lh.sample }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 1e · Radius -->
        <div class="mb-10">
          <h3 class="font-display mb-1 text-xl">Radius</h3>
          <p class="mb-4 text-sm text-muted">Basiert auf <code class="font-mono text-xs">--ui-radius: 0.5rem</code>. Alle Nuxt UI Komponenten nutzen diesen Basiswert für ihre Varianten.</p>
          <div class="flex flex-wrap gap-4">
            <div v-for="r in radii" :key="r.name" class="flex flex-col items-center gap-2">
              <div
                :class="`size-16  border-2 border-primary/40 bg-primary/20 ${r.class}`"
              />
              <div class="text-center">
                <code class="block font-mono text-xs">{{ r.class }}</code>
                <span class="text-2xs text-muted">{{ r.value }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 1f · Shadows -->
        <div class="mb-2">
          <h3 class="font-display mb-1 text-xl">Schatten</h3>
          <p class="mb-4 text-sm text-muted">App-spezifisches Elevation-System. Definiert in <code class="font-mono text-xs">main.css :root → --shadow-*</code>.</p>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div v-for="shadow in shadowTokens" :key="shadow.var" class="flex flex-col gap-2">
              <div
                class="h-16 rounded-lg bg-elevated"
                :style="{ boxShadow: `var(${shadow.var})` }"
              />
              <div>
                <code class="text-2xs block font-mono text-muted">{{ shadow.var }}</code>
                <span class="text-xs text-muted">{{ shadow.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─────────────────────────────────────────
           2. UI-KIT
           ───────────────────────────────────────── -->
      <section id="ui-kit" class="scroll-mt-16">
        <h2 class="font-display mb-8 text-2xl">UI-Kit</h2>

        <!-- Buttons -->
        <div class="mb-8">
          <div class="mb-1 flex items-baseline gap-2"><h3 class="font-display text-xl">Button</h3><code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted">UButton</code></div>
          <p class="mb-3 text-sm text-muted">Nuxt UI Button — Varianten, Farben und Größen über <code class="font-mono text-xs">app.config.ts</code> konfiguriert.</p>
          <div class="rounded-lg border border-default bg-elevated p-4 flex flex-col gap-4">
            <div>
              <SectionHeader text="Varianten" />
              <div class="flex flex-wrap gap-3">
                <UButton>Solid</UButton>
                <UButton variant="outline">Outline</UButton>
                <UButton variant="soft">Soft</UButton>
                <UButton variant="ghost">Ghost</UButton>
                <UButton variant="link">Link</UButton>
              </div>
            </div>
            <div>
              <SectionHeader text="Farben" />
              <div class="flex flex-wrap gap-3">
                <UButton color="primary">Primär</UButton>
                <UButton color="success">Erfolg</UButton>
                <UButton color="warning">Warnung</UButton>
                <UButton color="error">Fehler</UButton>
                <UButton color="neutral">Neutral</UButton>
              </div>
            </div>
            <div>
              <SectionHeader text="Größen" />
              <div class="flex flex-wrap items-center gap-3">
                <UButton size="xs">xs</UButton>
                <UButton size="sm">sm</UButton>
                <UButton size="md">md</UButton>
                <UButton size="lg">lg</UButton>
                <UButton size="xl">xl</UButton>
              </div>
            </div>
            <div>
              <SectionHeader text="ExpandingButton" />
              <div class="flex flex-wrap gap-3">
                <ExpandingButton icon="i-ph-plus" color="primary" variant="soft">Aufgabe hinzufügen</ExpandingButton>
                <ExpandingButton icon="i-ph-gear" color="neutral" variant="ghost">Einstellungen</ExpandingButton>
              </div>
            </div>
          </div>
        </div>

        <!-- Card -->
        <div class="mb-8">
          <div class="mb-1 flex items-baseline gap-2"><h3 class="font-display text-xl">Card</h3><code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted">UCard</code></div>
          <p class="mb-3 text-sm text-muted">Nuxt UI Card — mit <code class="font-mono text-xs">header</code>, <code class="font-mono text-xs">default</code> und <code class="font-mono text-xs">footer</code> Slot. Eigene <code class="font-mono text-xs">task</code>-Variante in <code class="font-mono text-xs">app.config.ts</code>.</p>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <h4 class="font-display text-lg">Karten-Titel</h4>
                  <UButton size="xs" variant="soft" icon="i-ph-dots-three" />
                </div>
              </template>
              <p class="text-sm text-muted">Standard-Karte mit Header, Inhalt und Footer.</p>
              <template #footer>
                <div class="flex justify-end gap-2">
                  <UButton size="sm" variant="ghost" color="neutral">Abbrechen</UButton>
                  <UButton size="sm" color="primary">Speichern</UButton>
                </div>
              </template>
            </UCard>
            <UCard variant="subtle">
              <div class="flex items-start gap-3">
                <UIcon name="i-ph-sparkle" class="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h4 class="font-display mb-1 text-lg">Variante: subtle</h4>
                  <p class="text-sm text-muted">Reduziert, ohne Header/Footer — für Hinweise.</p>
                </div>
              </div>
            </UCard>
          </div>
        </div>

        <!-- InlineEditable -->
        <div class="mb-8">
          <div class="max-w-md">
            <h3 class="font-display mb-1 text-xl">InlineEditable</h3>
            <p class="mb-3 text-sm text-muted">Wechselt zwischen Anzeige- und Eingabemodus beim Klick.</p>
            <div class="rounded-lg border border-default bg-elevated p-4 space-y-2">
              <InlineEditable v-model="inlineEditableValue" placeholder="Klicke zum Bearbeiten" />
              <p class="text-xs text-muted">Wert: <code>{{ inlineEditableValue }}</code></p>
            </div>
          </div>
        </div>

        <!-- Form fields -->
        <div class="mb-2">
          <h3 class="font-display mb-1 text-xl">Formularfelder</h3>
          <p class="mb-3 text-sm text-muted">Nuxt UI Inputs — <code class="font-mono text-xs">disabled</code>-Styling und Erscheinungsbild zentralisiert in <code class="font-mono text-xs">app.config.ts</code>.</p>
          <div class="rounded-lg border border-default bg-elevated p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-3">
              <UFormField label="Eingabe">
                <UInput placeholder="Schreibe etwas…" />
              </UFormField>
              <UFormField label="Deaktiviert">
                <UInput placeholder="Deaktiviert" disabled />
              </UFormField>
              <UFormField label="Auswahl">
                <USelectMenu class="w-full" :items="['Option A', 'Option B', 'Option C']" />
              </UFormField>
              <UFormField label="Fortschritt">
                <UProgress :value="60" color="primary" />
              </UFormField>
            </div>
          </div>
        </div>
      </section>

      <!-- ─────────────────────────────────────────
           3. AUFGABEN-KOMPONENTEN
           ───────────────────────────────────────── -->
      <section id="aufgaben" class="scroll-mt-16">
        <h2 class="font-display mb-8 text-2xl">Aufgaben-Komponenten</h2>

        <!-- Badges & Timebox -->
        <div class="mb-8 flex flex-wrap gap-6">
          <div class="min-w-52 flex-1">
            <h3 class="font-display mb-1 text-xl">TaskPriorityBadge</h3>
            <p class="mb-3 text-sm text-muted">Prioritäts-Badge in drei Stufen (1–3).</p>
            <div class="rounded-lg border border-default bg-elevated p-4 flex flex-wrap gap-6">
              <div v-for="(label, prio) in ['Niedrig', 'Normal', 'Hoch']" :key="prio" class="flex flex-col items-center gap-1.5">
                <TaskPriorityBadge :priority="prio + 1" />
                <span class="text-xs text-muted">{{ label }}</span>
              </div>
            </div>
          </div>

          <div class="min-w-44 flex-1">
            <h3 class="font-display mb-1 text-xl">TaskTimebox</h3>
            <p class="mb-3 text-sm text-muted">Badge-Anzeige der geplanten Timebox, in jeder Spalte gleich (neutral soft).</p>
            <div class="rounded-lg border border-default bg-elevated p-4 flex flex-wrap gap-3">
              <TaskTimebox :time-box-seconds="1800" />
              <TaskTimebox :time-box-seconds="3600" />
              <TaskTimebox :time-box-seconds="7200" />
            </div>
          </div>
        </div>

        <!-- Timer -->
        <div class="mb-8">
          <h3 class="font-display mb-1 text-xl">TaskTimer</h3>
          <p class="mb-3 text-sm text-muted">Zeit-Anzeige für laufende und pausierte Timer.</p>
          <div class="rounded-lg border border-default bg-elevated p-4 flex flex-wrap gap-8">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted">Nicht gestartet</span>
              <TaskTimer :time-box-seconds="3600" :time-spent-seconds="0" :is-running="false" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted">Läuft (25%)</span>
              <TaskTimer :time-box-seconds="3600" :time-spent-seconds="900" :is-running="true" :show-remaining="true" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted">Überschritten</span>
              <TaskTimer :time-box-seconds="3600" :time-spent-seconds="4500" :is-running="false" :show-remaining="true" />
            </div>
          </div>
        </div>

        <!-- Progress -->
        <div class="mb-8">
          <h3 class="font-display mb-1 text-xl">Fortschritt</h3>
          <p class="mb-3 text-sm text-muted">Linearbalken und Kreis — beide zeigen den Anteil verbrauchter Timebox.</p>
          <div class="flex flex-wrap gap-6">
            <div class="min-w-48 flex-1">
              <SectionHeader text="TaskProgressBar" class="mb-2" />
              <div class="rounded-lg border border-default bg-elevated p-4 flex flex-col gap-4">
                <div>
                  <span class="text-xs text-muted">25%</span>
                  <TaskProgressBar :time-box-seconds="3600" :time-spent-seconds="900" :is-running="false" />
                </div>
                <div>
                  <span class="text-xs text-muted">75% (läuft)</span>
                  <TaskProgressBar :time-box-seconds="3600" :time-spent-seconds="2700" :is-running="true" />
                </div>
                <div>
                  <span class="text-xs text-muted">120% (überschritten)</span>
                  <TaskProgressBar :time-box-seconds="3600" :time-spent-seconds="4320" :is-running="false" />
                </div>
              </div>
            </div>
            <div class="min-w-48 flex-1">
              <SectionHeader text="TaskProgressCircular" class="mb-2" />
              <div class="rounded-lg border border-default bg-elevated p-4 flex flex-col gap-4">
                <div>
                  <span class="mb-2 block text-xs text-muted">Standardgrößen</span>
                  <div class="flex items-center gap-4">
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="900" :is-running="false" />
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="2700" :is-running="true" />
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="4320" :is-running="false" />
                  </div>
                </div>
                <div>
                  <span class="mb-2 block text-xs text-muted">Größen (24/36/56/80px)</span>
                  <div class="flex items-end gap-4">
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="1500" :size="24" :stroke-width="3" :show-label="false" />
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="1500" :size="36" :stroke-width="4" />
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="1500" :size="56" :stroke-width="5" />
                    <TaskProgressCircular :time-box-seconds="3600" :time-spent-seconds="1500" :size="80" :stroke-width="6" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Task Detail & Form -->
        <div class="mb-2 flex flex-wrap gap-6">
          <div class="min-w-52 flex-1">
            <h3 class="font-display mb-1 text-xl">TaskDetailModal</h3>
            <p class="mb-3 text-sm text-muted">Bettet TaskDetailContent in einen UModal ein.</p>
            <div class="rounded-lg border border-default bg-elevated p-4 flex gap-3 flex-wrap">
              <UButton icon="i-ph-arrow-square-out" variant="soft" @click="() => { showTaskDetailModal = true; }">Detail öffnen</UButton>
              <UButton icon="i-ph-arrow-square-out" variant="soft" color="neutral" @click="() => { showTaskSheet = true; }">Als Sheet öffnen</UButton>
            </div>
          </div>

          <div class="min-w-52 flex-1">
            <h3 class="font-display mb-1 text-xl">TaskForm</h3>
            <p class="mb-3 text-sm text-muted">Formular zum Erstellen einer neuen Aufgabe.</p>
            <div class="rounded-lg border border-default bg-elevated p-4">
              <div class="overflow-hidden rounded-lg bg-elevated" style="box-shadow: var(--shadow-task-hover);">
                <div class="flex items-center border-b border-default px-4 py-2.5">
                  <span class="text-base font-medium">Neue Aufgabe erstellen</span>
                </div>
                <div class="p-4">
                  <TaskForm :is-preview="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─────────────────────────────────────────
           4. BOARD
           ───────────────────────────────────────── -->
      <section id="board" class="scroll-mt-16">
        <h2 class="font-display mb-6 text-2xl">Board</h2>

        <div>
          <h3 class="font-display mb-1 text-xl">BoardColumn</h3>
          <p class="mb-3 text-sm text-muted">Kanban-Spalten mit TaskCard, TaskStack und Drag-and-Drop.</p>
          <div class="board-container">
            <DragDropProvider>
              <div class="board">
                <BoardColumn
                  headline="Offen"
                  :tasks="styleguideTasksOpen"
                  :task-status="TaskStatus.Open"
                  :static-mode="true"
                  :is-dragging="false"
                  :mute-others="false"
                  :grouping-enabled="true"
                  :grouping-key="'topic'"
                />
                <BoardColumn
                  headline="Jetzt"
                  :tasks="styleguideTasksProgress"
                  :task-status="TaskStatus.Progress"
                  :static-mode="true"
                  :is-dragging="false"
                  :mute-others="false"
                  :grouping-enabled="false"
                  :grouping-key="null"
                />
                <BoardColumn
                  headline="Wartet"
                  :tasks="styleguideTasksWaiting"
                  :task-status="TaskStatus.Waiting"
                  :static-mode="true"
                  :is-dragging="false"
                  :mute-others="false"
                  :grouping-enabled="false"
                  :grouping-key="null"
                />
                <BoardColumn
                  headline="Erledigt"
                  :tasks="styleguideTasksDone"
                  :task-status="TaskStatus.Done"
                  :static-mode="true"
                  :is-dragging="false"
                  :mute-others="false"
                  :grouping-enabled="false"
                  :grouping-key="null"
                />
              </div>
            </DragDropProvider>
          </div>
        </div>
      </section>

      <!-- ─────────────────────────────────────────
           5. DIALOGE
           ───────────────────────────────────────── -->
      <section id="dialoge" class="scroll-mt-16">
        <h2 class="font-display mb-6 text-2xl">Dialoge</h2>

        <!-- App modals -->
        <div class="mb-8">
          <h3 class="font-display mb-3 text-xl">Anwendungs-Dialoge</h3>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div class="rounded-lg border border-default bg-elevated p-4 flex flex-col gap-3">
              <div>
                <h4 class="font-medium">SyncWarningModal</h4>
                <p class="mt-1 text-sm text-muted">Warnung bei leerem Sync-Ergebnis.</p>
              </div>
              <UButton icon="i-ph-warning" variant="soft" color="warning" class="self-start" @click="() => { showSyncWarning = true; }">Öffnen</UButton>
            </div>
          </div>
        </div>

        <!-- Integration setup modals -->
        <div>
          <h3 class="font-display mb-3 text-xl">Integration-Setup</h3>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div class="rounded-lg border border-default bg-elevated p-4 flex flex-col gap-3">
              <div>
                <h4 class="font-medium">LocalSetupModal</h4>
                <p class="mt-1 text-sm text-muted">Lokaler Modus ohne externe Verbindung.</p>
              </div>
              <UButton icon="i-ph-desktop" variant="soft" class="self-start" @click="() => { showLocalSetup = true; }">Öffnen</UButton>
            </div>
            <div class="rounded-lg border border-default bg-elevated p-4 flex flex-col gap-3">
              <div>
                <h4 class="font-medium">NotionSetupModal</h4>
                <p class="mt-1 text-sm text-muted">Notion Integration mit Schritt-für-Schritt Wizard.</p>
              </div>
              <UButton icon="i-simple-icons-notion" variant="soft" class="self-start" @click="() => { showNotionSetup = true; }">Öffnen</UButton>
            </div>
          </div>
        </div>
      </section>

    </UContainer>

    <!-- ── Teleported modals ── -->
    <TaskDetailModal
      v-model="showTaskDetailModal"
      :task-id="sgDetailTask.id"
      @deleted="showTaskDetailModal = false"
    />

    <TaskSheet
      :open="showTaskSheet"
      :title="sgDetailTask.title"
      hide-title
      flush-body
      @update:open="showTaskSheet = $event"
    >
      <TaskDetailContent
        :task-id="sgDetailTask.id"
        :is-preview="true"
        @delete="() => {}"
        @close="showTaskSheet = false"
      />
    </TaskSheet>

    <SyncWarningModal
      v-model:open="showSyncWarning"
      source="notion"
      reason="empty_sync_with_local_data"
      :current-task-count="5"
      :fetched-count="0"
      :last-sync-timestamp="mockSyncDate"
      @action="() => {}"
    />



    <LocalSetupModal v-model:open="showLocalSetup" @complete="showLocalSetup = false" />
    <NotionSetupModal v-model:open="showNotionSetup" @complete="showNotionSetup = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { DragDropProvider } from '@dnd-kit/vue'
import BoardColumn from '~/components/board/BoardColumn.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import TaskDetailContent from '~/components/task/TaskDetailContent.vue'
import TaskDetailModal from '~/components/task/TaskDetailModal.vue'
import TaskSheet from '~/components/task/TaskSheet.vue'
import TaskForm from '~/components/task/TaskForm.vue'
import TaskPriorityBadge from '~/components/task/TaskPriorityBadge.vue'
import TaskTimebox from '~/components/task/TaskTimebox.vue'
import TaskTimer from '~/components/task/TaskTimer.vue'
import TaskProgressBar from '~/components/task/TaskProgressBar.vue'
import TaskProgressCircular from '~/components/task/TaskProgressCircular.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import ExpandingButton from '~/components/ui/ExpandingButton.vue'
import InlineEditable from '~/components/ui/inline/InlineEditable.vue'
import SyncWarningModal from '~/components/sync/SyncWarningModal.vue'
import LocalSetupModal from '~/components/local/LocalSetupModal.vue'
import NotionSetupModal from '~/components/notion/setup/NotionSetupModal.vue'

// No app bar here (#470): first run, developer pages and the empty redirect page
definePageMeta({ appNav: false })

defineOptions({ name: 'StyleGuidePage' })

// ── Store ──────────────────────────────────────────────────────────────────
const tasksStore = useTasksStore()

// ── Active nav section (IntersectionObserver) ──────────────────────────────
const activeSection = ref('')

onMounted(() => {
  if (!import.meta.client) return
  const observer = new IntersectionObserver(
    (entries) => {
      const entering = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (entering[0]) activeSection.value = entering[0].target.id
    },
    { rootMargin: '-10% 0px -85% 0px', threshold: 0 }
  )
  for (const { id } of navSections) {
    const el = document.getElementById(id)
    if (el) observer.observe(el)
  }
  onUnmounted(() => observer.disconnect())
})

function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' })
    history.replaceState(null, '', `#${id}`)
  }
}

// ── Modal states ───────────────────────────────────────────────────────────
const showTaskDetailModal = ref(false)
const showTaskSheet = ref(false)
const showSyncWarning = ref(false)
const showLocalSetup = ref(false)
const showNotionSetup = ref(false)

// ── Misc state ─────────────────────────────────────────────────────────────
const inlineEditableValue = ref('Bearbeitbarer Text')
const mockSyncDate = new Date(Date.now() - 5 * 60 * 1000)

// ── Navigation ─────────────────────────────────────────────────────────────
const navSections = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'ui-kit', label: 'UI-Kit' },
  { id: 'aufgaben', label: 'Aufgaben' },
  { id: 'board', label: 'Board' },
  { id: 'dialoge', label: 'Dialoge' },
]

// ── Token data ─────────────────────────────────────────────────────────────
const bgSurfaces = [
  { token: 'page', utility: 'bg-page' },
  { token: 'default', utility: 'bg-default' },
  { token: 'muted', utility: 'bg-muted' },
  { token: 'elevated', utility: 'bg-elevated' },
  { token: 'accented', utility: 'bg-accented' },
  { token: 'inverted', utility: 'bg-inverted' },
]

const textHierarchy = [
  { token: 'text', utility: 'text-default' },
  { token: 'muted', utility: 'text-muted' },
  { token: 'toned', utility: 'text-toned' },
  { token: 'dimmed', utility: 'text-dimmed' },
  { token: 'highlighted', utility: 'text-highlighted font-medium' },
  { token: 'inverted', utility: 'text-inverted bg-inverted px-1 rounded' },
]

const colorRoles = [
  { role: 'primary', palette: 'custom-ink', description: 'CTAs, aktive Navigation, Markenelemente' },
  { role: 'secondary', palette: 'custom-orange', description: 'Sekundäre Aktionen' },
  { role: 'success', palette: 'custom-teal', description: 'Erfolg, abgeschlossene Aufgaben' },
  { role: 'info', palette: 'sky', description: 'Info-Hinweise, Tooltips' },
  { role: 'warning', palette: 'custom-orange', description: 'Warnungen, ausstehende Zustände' },
  { role: 'error', palette: 'custom-raspberry', description: 'Fehler, Validierung, destruktive Aktionen' },
  { role: 'neutral', palette: 'stone', description: 'Text, Rahmen, deaktivierte Zustände' },
]

const semanticColors = ['primary', 'secondary', 'success', 'warning', 'error', 'info', 'neutral']
const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']

const colorPalettes = [
  { name: 'Ink', varPrefix: '--color-custom-ink', role: 'primary', badgeColor: 'primary', shades: ['50','100','200','300','400','500','600','700','800','900'] },
  { name: 'Teal', varPrefix: '--color-custom-teal', role: 'success', badgeColor: 'success', shades: ['50','100','200','300','400','500','600','700','800','900'] },
  { name: 'Orange', varPrefix: '--color-custom-orange', role: 'secondary / warning', badgeColor: 'warning', shades: ['50','100','200','300','400','500','600','700','800','900'] },
  { name: 'Raspberry', varPrefix: '--color-custom-raspberry', role: 'error', badgeColor: 'error', shades: ['50','100','200','300','400','500','600','700','800','900'] },
]

const lineHeights = [
  { name: 'tight', var: '--lh-tight', value: '1.15', sample: 'Display-Text, Spalten-Überschriften (Figtree 600)' },
  { name: 'snug', var: '--lh-snug', value: '1.3', sample: 'Kompakter UI-Text, Aufgabenkarten-Titel' },
  { name: 'body', var: '--lh-body', value: '1.55', sample: 'Fließtext, Notiz, Modal-Inhalt, längere Beschreibungen' },
]

const radii = [
  { name: 'xs', class: 'rounded-xs', value: '2px' },
  { name: 'sm', class: 'rounded-sm', value: '4px' },
  { name: 'md', class: 'rounded-md', value: '8px (base)' },
  { name: 'lg', class: 'rounded-lg', value: '12px' },
  { name: 'xl', class: 'rounded-xl', value: '16px' },
  { name: '2xl', class: 'rounded-2xl', value: '24px' },
  { name: 'full', class: 'rounded-full', value: '9999px' },
]

const shadowTokens = [
  { var: '--shadow-task', label: 'Task · Ruhend' },
  { var: '--shadow-task-hover', label: 'Task · Hover' },
  { var: '--shadow-task-strong', label: 'Task · Betont' },
  { var: '--shadow-task-drag-elevated', label: 'Task · Drag' },
  { var: '--shadow-badge', label: 'Badge' },
]

// ── Demo task data ─────────────────────────────────────────────────────────
const taskBase: Omit<Task, 'id' | 'status' | 'title'> = {
  source: 'local',
  externalId: null,
  notes: null,
  priority: 2,
  activity: 'Styleguide lesen',
  timeBoxSeconds: null,
  timeSpentSeconds: 0,
  topic: 'Fokus',
  topicColorCode: null,
  timerId: null,
  custom: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  isUnplanned: false,
}

const sgDetailTask: Task = {
  id: 'sg-detail-demo',
  source: 'local',
  externalId: null,
  title: 'Design System Review durchführen',
  status: TaskStatus.Progress,
  priority: 3,
  activity: 'Review',
  timeBoxSeconds: 3600,
  timeSpentSeconds: 900,
  topic: 'Design',
  topicColorCode: 'pink',
  timerId: null,
  notes: 'Dies ist eine Beispielaufgabe für den Styleguide.\n\n### Anforderungen\n- Farben prüfen\n- Typografie testen\n- Komponenten validieren',
  custom: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  isUnplanned: false,
}

const styleguideBoardTasks: Task[] = [
  { id: 'sg-open', title: 'Neue Aufgabe planen', status: TaskStatus.Open, ...taskBase },
  { id: 'sg-open-stack-1', title: 'Kurznotiz ergänzen', status: TaskStatus.Open, ...taskBase, topic: 'Stack Demo' },
  { id: 'sg-open-stack-2', title: 'Timebox festlegen', status: TaskStatus.Open, ...taskBase, topic: 'Stack Demo' },
  { id: 'sg-open-stack-3', title: 'Priorität prüfen', status: TaskStatus.Open, ...taskBase, topic: 'Stack Demo' },
  { id: 'sg-open-stack-4', title: 'Abhängigkeit klären', status: TaskStatus.Open, ...taskBase, topic: 'Stack Demo' },
  { id: 'sg-open-stack-5', title: 'Ersten Schritt definieren', status: TaskStatus.Open, ...taskBase, topic: 'Stack Demo' },
  {
    id: 'sg-progress',
    title: 'Mockups verfeinern',
    status: TaskStatus.Progress,
    ...taskBase,
    timeBoxSeconds: 1800,
    timeSpentSeconds: 600,
  },
  { id: 'sg-waiting', title: 'Feedback von Team einholen', status: TaskStatus.Waiting, ...taskBase },
  { id: 'sg-done', title: 'Daily vorbereiten', status: TaskStatus.Done, ...taskBase },
]

const styleguideTasksOpen = computed(() => styleguideBoardTasks.filter((t) => t.status === TaskStatus.Open))
const styleguideTasksProgress = computed(() => styleguideBoardTasks.filter((t) => t.status === TaskStatus.Progress))
const styleguideTasksWaiting = computed(() => styleguideBoardTasks.filter((t) => t.status === TaskStatus.Waiting))
const styleguideTasksDone = computed(() => styleguideBoardTasks.filter((t) => t.status === TaskStatus.Done))

const allStyleguideTasks = [sgDetailTask, ...styleguideBoardTasks]
allStyleguideTasks.forEach((t) => tasksStore.addTask(t))

onUnmounted(() => {
  allStyleguideTasks.forEach((t) => tasksStore.removeTask(t.id))
})
</script>
