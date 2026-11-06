# ADR 006: i18n routing and locale detection

## Status

Accepted

## Context

kan-do ships as a static web build (`ssr: false`) and as a Tauri desktop app that loads the `nuxt generate` output from disk through a custom scheme. There is no server to redirect requests or read cookies. The UI was hardcoded German; it now supports German (default, fallback) and English without a visible language switcher, so the locale has to be derived from the environment.

## Decision

- **Module and versions**: `@nuxtjs/i18n` is pinned to `10.6.0` (brings `vue-i18n` 11.x) and `@intlify/eslint-plugin-vue-i18n` to `4.5.1`, both exactly, so message syntax and lint rules do not shift under a caret range. Dependency installs use `npx npm@11.19.0 install ...` because the local npm 11.6 drops `@emnapi` lockfile entries that CI needs.
- **Routing**: `strategy: 'no_prefix'`. Without a server, locale-prefixed routes add URL churn and break deep links, and Tauri has nothing to redirect them.
- **Detection**: the module's `detectBrowserLanguage` is disabled (`false`). It is cookie-based, cookies in the Tauri custom-scheme WebView are unreliable, and it cannot express the precedence below. Instead, `plugins/i18n-locale.client.ts` resolves the locale before first render using the pure function `resolveLocale` in `utils/localeResolution.ts`.
- **Precedence** (first match wins; invalid values are ignored; all storage access is wrapped in try/catch):

| # | Source | Persisted | Notes |
|---|--------|-----------|-------|
| 1 | `?lang=de\|en` | yes | Removed from the URL after applying, through a one-shot `router.beforeEach` guard because Nuxt's router undoes a plain `history.replaceState`. Also works in production builds. |
| 2 | `KANDO_LOCALE` via `runtimeConfig.public.localeOverride` | no | Read only when `import.meta.dev`, so it is never applied in a production build (the value is still serialized into `runtimeConfig.public`). Forced for that run only. |
| 3 | localStorage `kando-locale` | n/a | Written by sources 1 and 4. |
| 4 | `navigator.languages`, first `de*`/`en*` entry | yes | In Tauri the WebView reports the OS language. |
| 5 | `de` | yes | |

  `?seed=clear` also removes `kando-locale` (dev/stub builds only).
- **Message syntax**: vue-i18n's own (`{name}` interpolation, `a | b` plural branches, count passed as `t(key, count)` or `t(key, named, count)`), not ICU, because vue-i18n does not parse ICU plurals. Markup goes through `<i18n-t>` slots; HTML in messages is lint-forbidden.
- **Durations**: formatted from i18n plural messages (`utils/localeFormat.ts`), not `Intl.DurationFormat`. Support in older WebKitGTK (Tauri on Linux) is not guaranteed, and messages let each existing German formatter keep byte-identical output.
- **Files**: one bundled file per locale, loaded at startup before first render, `i18n/locales/de.json` and `en.json`, with options in `i18n/i18n.config.ts`.

## Consequences

- Persisting the detected locale means a later OS-language change is not picked up in production. The stored locale can be changed with `?lang=de|en`, or cleared via `?seed=clear` in dev/stub builds (`?seed` is unavailable in other builds) or by clearing site data. This follows the product rule "reuse the language from an earlier session".
- `KANDO_LOCALE=en npm run dev` (or `tauri:dev`) lets developers force a locale without touching storage; removing it restores normal behaviour.
- E2E runs must pin the browser locale (`use.locale: 'de-DE'` in `tests/e2e/playwright.config.ts`), otherwise headless Chromium (en-US) would detect English.
- Outside component setup, code uses `translate()` from `lib/i18n.ts`; the parity test (`tests/i18n/locale-parity.test.ts`, `npm run i18n:check`) and ESLint `no-raw-text` / `no-missing-keys` / `no-html-messages` guard the locale files and templates. Raw strings in TS are covered by review only.
- Data stays untranslated: Notion/Todoist values, the `TaskStatus` enum, seed data, the German auto-detect heuristics of the Notion mapping wizard, and duration parsing.
- The `UApp` locale (`@nuxt/ui/locale`) and `<html lang>` follow the active locale, so Nuxt UI built-in strings and `UCalendar` become German in the default locale. Since `@nuxt/ui` 4.12, `UApp` picks up the `@nuxtjs/i18n` locale automatically (no explicit `locale` prop in `app.vue`); `<html lang>` is still set via `useHead`.
