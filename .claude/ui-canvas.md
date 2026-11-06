# ui-canvas profile: kan-do

<!-- Read by the ui-canvas skill. Keep it short; it is loaded on every canvas task. -->

- tool: figcraft
- canvas file: `$ARTCRAFT_HOME/work/projects/kan-do/kan-do.figcraft` (`ARTCRAFT_HOME`: your ArtCraft checkout, default `~/dev-workspace/artcraft`; maintainer tooling, not in this repo)
- start: `"${ARTCRAFT_HOME:-$HOME/dev-workspace/artcraft}/bin/craft-live" figcraft "${ARTCRAFT_HOME:-$HOME/dev-workspace/artcraft}/work/projects/kan-do/kan-do.figcraft"`
- fidelity: mid
- design sources: DESIGN.md (tokens, typography, Board and Task card patterns), PRODUCT.md, `app.config.ts`, `assets/css/`, `components/`
- tokens on the canvas: the file's single variable collection (24 variables). TODO: name it here
- components on the canvas → code: Button → UButton, Badge → UBadge, TaskCard → `components/TaskCard.vue`
- frame naming: frame = screen name (`today` = board at /tasks), mobile as `<frame>/mobile`, variants `<frame>/v<n>`, sizes `<frame>/<width>`
- breakpoints: 390, 768, 1280 (mobile ≤767px in CSS)
- UI copy language: German; strings come from `i18n/locales/de.json`
- comments for the agent: every open thread; a thread that gives a reason ("because…") also goes through the skill `design-rule` (propose, never write a rule unasked)
- run the app for replicate: `npm run dev`, then http://localhost:3000/tasks?seed=local
- handoff target: GitHub issue comment, implemented by /build-gh-issue
