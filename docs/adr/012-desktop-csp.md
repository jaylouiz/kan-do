# ADR 012: Desktop Content Security Policy

## Status

Accepted (#228 phase 1, part of epic #221). Phases 2 (Developer ID signing and notarization) and 3 (CI release job) of #228 are separate and not covered here. Builds on ADR 007 (secrets stay in Rust), ADR 009 (the updater runs in Rust) and ADR 010 (feedback goes through `github_request`).

## Context

`app.security.csp` was `null`: the Tauri webview ran any script and could reach any host. The desktop app holds API tokens (Keychain, ADR 007) and the user's task data, so a compromised page or dependency should not be able to run injected script or send data anywhere but the hosts the app already uses. The CSP applies to the Tauri bundle only; the web build is unchanged.

Only requests that originate in the webview are subject to the CSP. That is why the list below is short: everything that goes through Rust is absent on purpose.

## Decision

`src-tauri/tauri.conf.json` `app.security.csp` is a directive map. Tauri adds `sha256-` hashes for the inline scripts of the bundled HTML (the import map and the `window.__NUXT__` config) to `script-src` at build time, so `script-src` stays `'self'`. `app.security.dangerousDisableAssetCspModification` is `["style-src"]` (the list form, never `true`): Tauri leaves `style-src` alone and still hashes `script-src`.

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Everything not listed below is same-origin only. |
| `script-src` | `'self'` | No inline or `eval` script. Tauri hashes the two inline scripts of the generated HTML. |
| `style-src` | `'self' 'unsafe-inline'` | **Known trade-off.** Nuxt UI injects its colour `<style id="nuxt-ui-colors">` through `innerHTML` at runtime and other libraries add `<style>` elements; a build with `'self'` alone blocks them and drops the theme. The content is not user-controlled; the damage a style injection can do is far below script injection. Tauri would add a nonce to every `<style>` of the HTML, and a nonce or hash in `style-src` makes browsers ignore `'unsafe-inline'`, which would drop Nuxt UI's runtime `nuxt-ui-colors` style. So `dangerousDisableAssetCspModification` excludes `style-src` (and only it: `true` would also stop the `script-src` hashing and the bundle would not start). The generated HTML has no inline `<style>` today, so this is preventive; `tests/config/csp-build-output.test.ts` watches that. |
| `font-src` | `'self'` | Figtree and the other faces are local files under `/fonts`. No `data:` (nothing inlines fonts). |
| `img-src` | `'self'` | The board background is a bundled file (`plants.svg`, emitted as an asset, not inlined) and icons are bundled by `@nuxt/icon`. No `data:` or `blob:`: the feedback screenshot (#247, ADR 014) is native and lives in `ArrayBuffer`/`ImageBitmap`/`<canvas>`/`Blob` only, with no `<img>` source, so it needs neither (a Vitest guard enforces it). If the built bundle ever blocks the canvas path, add `blob:` only, never `data:`, in `csp` and `devCsp` and update the CSP test in the same change. |
| `connect-src` | `'self' ipc: http://ipc.localhost https://api.todoist.com` | `ipc:` / `http://ipc.localhost` is Tauri's command channel; it also carries Notion, because `integrations/NotionClientAPI.ts` uses `@tauri-apps/plugin-http` in the desktop app. `api.todoist.com` is the one webview-side `fetch` (`@doist/todoist-api-typescript`, `integrations/TodoistIntegration.ts`). |
| `object-src` | `'none'` | No plugins. |
| `base-uri` | `'none'` | The app never needs a `<base>`; blocks base-tag injection. |
| `frame-ancestors` | `'none'` | Never framed. |
| `form-action` | `'none'` | The app has no native form post. |

**GitHub and release hosts are Rust-side and intentionally absent.** `api.github.com` (#223 `github_request`, #227 feedback), the release asset hosts and the signed-storage redirect (#225 updater) are called by reqwest / `tauri-plugin-updater` in Rust, and the page never calls `fetch` for them. Adding them to `connect-src` "to be safe" would let a compromised page reach GitHub from the webview and defeat the write-only token design of ADR 007. If a webview-side GitHub call ever appears, that is a bug against #223/#227, not a CSP entry. `https://api.notion.com` is likewise absent: Notion goes through the http plugin, whose host allow-list is `src-tauri/capabilities/default.json`.

**`devCsp`** (`tauri dev` only) is the same policy plus `script-src 'unsafe-inline'` (the Nuxt dev server's HTML carries inline scripts and Tauri does not hash assets it does not serve) and `http://localhost:* ws://localhost:*` in `connect-src` (the dev server and the Vite HMR socket, whose port is not the dev URL's). The wildcard is a port wildcard on localhost only. Production never contains these.

**`devCsp` is inert while `build.devUrl` is set.** With a `devUrl`, Tauri embeds no assets and attaches the CSP only to responses of its own asset protocol, while the page is served by `localhost:3000` (`tauri-codegen` `context.rs`). So `tauri dev` enforces no CSP at all. `devCsp` is kept: it is harmless and takes effect if `devUrl` is ever dropped. The built bundle is the only valid CSP check; a clean `tauri dev` run says nothing about the policy.

### Icons: nothing may be fetched from api.iconify.design

`@nuxt/icon` falls back to `https://api.iconify.design` at runtime for any icon that is not in the client bundle. Two sources of that were found while testing the built output (and also affected the web build offline):

- Nuxt UI's own icons (select chevron, modal/alert close, command palette search, checkbox check, calendar arrows, loading) default to Lucide, which is not installed. `app.config.ts` `ui.icons` now maps every key the app's components use to Phosphor, the design system's set (DESIGN.md); the two `i-lucide-*` icons in `SyncWarningModal` became Phosphor.
- The client-bundle scan only reads `.vue` files by default, so icons named in `.ts` files (`i-ph-play`, `i-ph-pause`, `i-ph-timer` in `utils/taskMenuOptions.ts` and composables) were never bundled. `nuxt.config.ts` `icon.clientBundle.scan.globInclude` now includes the source folders' `.ts` files and `app.config.ts`.

- `app.config.ts` `ui.icons` maps **every** Nuxt UI default key (43 in @nuxt/ui 4.12), not only the ones the app uses today; `tests/config/nuxt-ui-icons.test.ts` pins the key list to the installed `@nuxt/ui` version, so a bump forces a review of new keys.

`tests/config/icons-bundled.test.ts` is an allow-list: it fails when any source file in the repo (it walks it; build, test, doc and Rust folders are skipped) names an icon from a collection other than `ph` or `simple-icons`. `nuxt.config.ts` `globInclude` must cover the same folders.

### Known, benign report: the Todoist SDK's `eval` probe

`@doist/todoist-api-typescript` bundles zod 4, which tests `new Function("")` inside a `try`/`catch` and falls back to its interpreted path when it throws. Under this CSP that probe is blocked: one `script-src` violation report (and, in WKWebView, one console line) when the SDK is loaded. Behaviour is unaffected. `'unsafe-eval'` must not be added to silence it; the smoke check below treats exactly this one report as expected.

## How to add a webview host

1. Confirm the call really originates in the webview. Rust-side calls need no CSP entry.
2. Add the host to `connect-src` in **both** `csp` and `devCsp`, and, if it is called through the http plugin, to `src-tauri/capabilities/default.json` (`http:default` `allow`). The CSP is the page-level gate, the capability is the IPC-level gate; a host needs the entry that matches how it is reached.
3. Update the table above and `tests/config/tauri-csp.test.ts` (the expected `connect-src` list is asserted exactly).
4. Smoke the built bundle. `tauri dev` is not a check: it enforces no CSP (see `devCsp` above).

## Verification

- `tests/config/tauri-csp.test.ts` pins the shape: no `null`, no `*`, no `unsafe-eval`, `connect-src` exactly as above, no GitHub or Notion host, only `style-src` with `'unsafe-inline'`, `dangerousDisableAssetCspModification` exactly `["style-src"]`, the dev-only additions.
- `tests/config/csp-build-output.test.ts` reads the generated `.output/public/index.html`: no inline `<style>`, no inline event handler, exactly the two executable inline scripts named above, only same-origin references. It is skipped without a build and is therefore not part of the skip-free run of `npm run verify`; run `npm run generate && npx vitest tests/config/csp-build-output.test.ts`.
- The static build (`npm run generate`) was served with this CSP as a header (plus the sha256 of its two inline scripts, as Tauri injects them) and driven with Playwright over the board, the task sheet, the command palette, a drag and drop, every settings page, `/welcome`, `/statistics` and `/styleguide`: the only violation report is the zod probe above. Chromium, not WKWebView, so the real-bundle smoke on the Mac stays a manual check in the PR.
- `tauri build --debug --no-bundle` accepts the config and embeds the policy and the generated hashes in the binary.
- A Playwright run of the static build served under the CSP header is not automated (it needs the built site served and per-hash script handling); the manual smoke above stays the behaviour check.
- Not run by an agent: launching the built app. It shares the Keychain service `com.julius.kan-do` and the data folder with the user's real app.

## Consequences

- A new external host in the webview fails closed until it is added here; the failure is visible only in the built app, hence the manual smoke.
- `style-src 'unsafe-inline'` remains until Nuxt UI's runtime colour style can be nonce- or hash-carried; revisit if that becomes possible.
- Nuxt UI components render Phosphor icons on both web and desktop; a new Nuxt UI component that uses an icon key not mapped in `app.config.ts` would fall back to Lucide and be caught by the smoke (blocked request).

## Residual risk: the Todoist host

`https://api.todoist.com` in `connect-src` is the one webview-reachable host that is not Tauri IPC. The Todoist token is readable by the webview (`secret_get`, ADR 007), so injected script that gets past `script-src` could send task data to any Todoist account. Accepted: `@doist/todoist-api-typescript` is a webview-side `fetch`. Mitigation path: move Todoist behind a Rust command like GitHub (the direction of ADR 007) and drop the host from `connect-src`. Todoist OAuth stays web only (ADR 007, #260), so it adds no host.

## Desktop-only exceptions to web/desktop parity

PRODUCT.md requires parity unless noted. The desktop app deliberately differs in these ways; each is documented in its own ADR and listed in PRODUCT.md:

- Data folder, backups and conflict safety: ADR 008, ADR 011 (#222, #224).
- Self-updater and the log file: ADR 009 (#225).
- What's new after an update: `release-notes/README.md`, ADR 009 (#226).
- In-app feedback to GitHub issues (context, element pick, native screenshot): ADR 010 (#227), ADR 014 (#247).
- API tokens in the macOS Keychain: ADR 007 (#223).
- This CSP: it applies to the Tauri bundle only.
