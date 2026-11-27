---
paths:
  - "tests/**/*.test.ts"
  - "tests/setup/**"
  - "tests/helpers/**"
  - "server/api/__tests__/**"
---
# Unit and component tests (Vitest)

Moved from root `CLAUDE.md` "Testing" (#901). E2E rules: `.claude/rules/e2e.md`.

- **Stores**: `setActivePinia(createPinia())` per test; reset after
- **i18n in tests**: `tests/setup/i18n.ts` installs i18n globally (locale `de` before each test, so German literals are fine); use `setTestLocale('en')` from `tests/helpers/i18n.ts` for English. E2E pins `locale: 'de-DE'`.
- **Composables**: mock deps via `vi.doMock` before importing the module
- **Server routes**: `supertest` + `h3` (see `server/api/__tests__/`)
- **Record/Map state**: use `.get()`, `.has()`, `.size` — never bracket access
