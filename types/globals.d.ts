/**
 * Build-time constants defined in nuxt.config.ts via vite.define.
 * These are replaced with literal values at build time for tree-shaking.
 */

/** true in dev and Vercel preview deployments; false in production builds */

/** true in dev and Vercel preview deployments; false in production builds */
declare const __NOTION_STUB_ALLOWED__: boolean;

/**
 * true in `nuxt dev` and in builds made with KANDO_COPY_EDITOR=1 (only scripts/e2e-server.mjs); false in every other
 * build, which drops the live copy editor (#59, `dev-tools/copy-editor/`) from the bundle.
 */
declare const __COPY_EDITOR__: boolean;
