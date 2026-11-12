#!/usr/bin/env bash
# SessionStart, cloud sessions only (Claude Code on the web sets CLAUDE_CODE_REMOTE=true): install what the
# Stop hook, the E2E gate and screenshots need. Local sessions exit at once.
# npm ci is keyed on the lockfile hash, so a resumed session with unchanged dependencies skips it.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# SessionStart stdout becomes session context: the cloud rules live here instead of in the always-loaded CLAUDE.md.
cat .claude/cloud.md 2>/dev/null
log() { echo "cloud-setup: $*" >&2; }

hash=$(sha256sum package-lock.json 2>/dev/null | cut -c1-16)
stamp="node_modules/.cloud-setup-${hash:-none}"
if [ ! -f "$stamp" ]; then
  # Pinned npm, as for every install in this repo (CLAUDE.md "Commands"); a plain `npm ci` failed in a cloud session.
  npx --yes npm@11.19.0 ci --no-audit --no-fund --loglevel=error >&2 ||
    { log "npm ci failed; Claude: run \`npx npm@11.19.0 ci\`, then \`npx playwright install chromium\`"; exit 0; }
  npx nuxt prepare >/dev/null 2>&1 || log "nuxt prepare failed (lint/typecheck need .nuxt)"
  touch "$stamp"
fi

# Chromium for the E2E specs and screenshots, from the repo's own Playwright (a bare `npx playwright`
# without node_modules fetches the latest release and a Chromium this repo cannot use); no-op when present.
pw=node_modules/.bin/playwright
"$pw" install --with-deps chromium >/dev/null 2>&1 ||
  "$pw" install chromium >/dev/null 2>&1 ||
  log "Chromium download failed: E2E and screenshots will not run (allowed domains: .claude/cloud.md)"

# playwright-cli backs the project skill of the same name (version pinned to the local install).
command -v playwright-cli >/dev/null 2>&1 ||
  npm install -g @playwright/cli@0.1.13 >/dev/null 2>&1 ||
  log "playwright-cli install failed"
exit 0
