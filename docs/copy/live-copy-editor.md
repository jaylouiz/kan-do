# Live copy editor (dev tool, #59)

For the product designer: change UI copy in the running dev app and get a pull request, without a terminal.

**Use it.** `npm run dev`, open the board, press Cmd/Ctrl+K and run **Edit UI copy: text selection mode**. Text that comes from an i18n key gets an outline on hover; click it (or press Alt+K and search every key in both languages) to open the editor. Write one language; the other is translated by the agent when you press **Translate** in the Publish view, or write it yourself (**Write EN myself**). The app shows saved edits at once and keeps them over a page reload. **Push PR** pushes a `copy/...` branch and opens a PR; the edits stay visible until you **Clear published**. Leave with Esc or the bar's Leave.

**Needs** a local, set up checkout: `git` with push rights to `origin`, `gh` logged in (without it the branch is pushed and the PR is left to you), the `claude` CLI logged in for the translation (`KANDO_COPY_AGENT_CMD` names another command), `node_modules` installed (the `i18n:check` runs from it).

**Rules it enforces.** Only existing keys of `i18n/locales/de.json` and `en.json` change. A string that uses an avoid form of a `decided` term in `docs/copy/terms.json` cannot be saved; a `proposed` one warns. `{placeholders}` and plural branches must match in both languages. Task titles and notes (`data-private`) are data, not copy, and are never offered.

**How it is kept out of production.** `__COPY_EDITOR__` (`nuxt.config.ts`) is true in `nuxt dev` and in builds with `KANDO_COPY_EDITOR=1` (only `scripts/e2e-server.mjs` sets it, so the E2E specs can drive the tool); every other build drops `dev-tools/copy-editor/` and the recorder plugin. The two routes (`POST /api/dev/copy/translate`, `/publish`, `server/copy-editor/`) are registered through `nitro.handlers` in `nuxt dev` only, never in a build. They answer only on localhost with a JSON body and the `x-kando-copy-editor` header. `tests/config/copy-editor-build-output.test.ts` proves a flag-free build has none of it (`npm run generate`, then that test; CI does both).

**Publish never touches your checkout.** It fetches `origin/main` into a temporary detached worktree, writes the two locale files there, runs `npx vitest run tests/i18n`, commits on `copy/<date>-<key>`, pushes only that branch (`--no-verify`: the personal pre-push hook would run the whole suite in a throwaway tree for two JSON files; CI runs everything on the PR) and removes the worktree and the local branch.

**How a text finds its key.** `plugins/copy-editor-recorder.client.ts` hooks vue-i18n's `postTranslation` and remembers which key rendered which string, so interpolated and plural strings map exactly (a reverse lookup in the locale files cannot). Two keys with the same text are offered as a choice.
