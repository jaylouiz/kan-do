# Screenshots (issue-workflow profile partial)

<!-- Full text of the profile section "Screenshots" (`.claude/issue-workflow.md`); read when: a shot beyond the board or task sheet: phone browser chrome, desktop-only pages, motion, completion effects, WebKit; embedding shots in a PR or issue comment. -->

Tool, widths and entry URL: the profile. Special cases:
- phone browser chrome (Safari's toolbar and status bar tint, safe areas): the iOS simulator runs the local dev server, `xcrun simctl boot <device>`, `xcrun simctl openurl <device> "http://localhost:<port>/…"`, `xcrun simctl io <device> screenshot <file>` (kd#207; Playwright shows no browser bars)
- desktop-only pages (`/settings/data`, `/settings/github`): `desktop-pages-shots.spec.ts` (skill `desktop-verify`)
- seeking animations by hand (`getAnimations()`): set `currentTime = t` on each; it already includes the delay, so never add the delay again (2 min, round 2 of #858)
- motion (stack collapse and other script animations): `npm run motion:film` (paused, seeked filmstrips plus jump/pop checks; usage in `scripts/motion-film.mts`), in Design and Build alike; it has no nav or app-bar target (#616: use a seeked filmstrip there)
- completion effects at 390px (headless, #692): the mobile board shows one column page; focusing a card in Erledigt switches to that page (`focusin`). To replay a completion effect on that card, push its id into the board store's transient `confirmingTaskIds` (`store/board.ts`) through the page's Pinia instance; say in the round that the shot replays an already-done card. A real completion on desktop: the drag helpers in `.claude/rules/e2e.md`. Seek motion by timing (e.g. 150/350/600 ms) when `motion:film` has no target.
- WebKit (the desktop app's engine): Playwright WebKit screenshots never paint `backdrop-filter`, so they verify layout and the no-blur fallback only; check blur in Chromium, the real WKWebView look is the user's manual check (#615, 20 min lost)

## Embedding shots in a PR or an issue comment

From the profile section "Pull requests".
- screenshots: `gh pr create --attach '<scratchpad>.png#alt'` with `![alt](<same path, without #alt>)` in the body file (gh ≥ 2.99; absolute, space-free paths in both (copy the shots to `/tmp/kd-<n>/` first: a path with spaces, like the scratchpad under "Application Support", is not matched); paths inside a `--body-file` resolve against the file's own directory, so a relative mismatch leaves the local line and appends a second copy); never commit screenshots, open a screenshot branch or link `blob/<branch>/…` image URLs (a slash branch breaks, and any branch link dies after merge; #811). Later: `gh pr edit <n> --body-file <f> --attach <path>`
- issue comments with images: `gh issue comment <n> --body-file <f> --attach <path>`
