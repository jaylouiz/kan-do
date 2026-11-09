---
paths:
  - "catalog/**"
  - "dev-tools/ui-catalog/**"
  - "pages/ui.vue"
  - "tests/e2e/ui-catalog.spec.ts"
  - "tests/e2e/snapshots/ui-catalog.styles.json"
  - "scripts/ui-manifest.mjs"
---
# `/ui` Components engine (#66, epic #58 D2/D3)

- **One entry per component**: `catalog/<category>/<Name>.catalog.ts`, `export default { ... } satisfies CatalogEntry` (`catalog/types.ts`). Plain data, a type-only import (Node 24 loads it for `scripts/ui-manifest.mjs`), no helper call. The folder is the manifest category, the file name the component name; `entryProblems` (`dev-tools/ui-catalog/validateEntry.ts`, run by `tests/devtools/ui-catalog/entries.test.ts`) enforces it, also unknown state labels, repeated ids and i18n keys missing in `de.json`/`en.json`.
- **Text lives once**: an app component's description, usage and avoid stay in its doc block (the entry has none); a Nuxt UI component (`source: 'nuxt-ui'`) has no doc block, so its entry carries them and `npm run ui:manifest` writes its manifest row. Alternatives are component names with a manifest row.
- **Variants**: Nuxt UI components declare `matrix.axes` and `theme`; the values come from the merged theme (`#build/ui/<theme>.ts` + `app.config.ts`), never retyped. App components list named `variants`. `states` use the labels of `CATALOG_STATES` (loading, empty, error, disabled, focus, long-text, icon-only, selected, open); an overlay example sets `open: true`. Sample copy is `{ $t: 'key' }`, so the language toggle switches it.
- **A category slice lands** by adding its entries and its category to `LANDED_CATEGORIES` (`validateEntry.ts`): from then on a manifest component of that category without an entry fails the test.
- **Dev-only**: `catalog/` is imported only from `dev-tools/ui-catalog/` (a test greps for it); never from `components/`, `composables/` or app code. The build-output test (`tests/config/ui-catalog-build-output.test.ts`) lists the strings that must not reach a production build.
- **Style fingerprint**: `tests/e2e/ui-catalog.spec.ts` records the computed styles of every sample (`tests/e2e/helpers/fingerprint.ts`) in `tests/e2e/snapshots/ui-catalog.styles.json`. A theme token, `app.config.ts` or component style change moves it on purpose: `PORT=<free> npm run test:e2e -- tests/e2e/ui-catalog.spec.ts --update-snapshots`, then commit the JSON (record against the production build, as CI runs it, never `nuxt dev`). It is part of the gate's `design` specs.
