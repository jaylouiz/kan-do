/**
 * Sentinel API keys for integration stubs in E2E tests.
 * Mirror the constants defined in server/utils/notionStub.ts.
 * Duplicated here because server-side modules cannot be imported in test/browser contexts.
 */

/** Activates the server-side Notion stub when used as notionConfig.token in localStorage. */
export const NOTION_STUB_API_KEY = 'notion_test_stub'

/**
 * Dwell times of the stack specs: the product's own time-based thresholds, kept in one place and
 * routed through `dwell()` from `settle.ts`. Everything else is a condition wait.
 */

/** Edge-zone hold before the column switch: `EDGE_HOLD_MS = 650` in `components/board/Board.vue` (not exported; `tests/e2e-constants/edge-hold.test.ts` pins the relation), plus margin. */
export const EDGE_HOLD_DWELL_MS = 900
