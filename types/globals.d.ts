/**
 * Build-time constants defined in nuxt.config.ts via vite.define.
 * These are replaced with literal values at build time for tree-shaking.
 */

/** true in dev and Vercel preview deployments; false in production builds */

/** true in dev and Vercel preview deployments; false in production builds */
declare const __NOTION_STUB_ALLOWED__: boolean;

/**
 * true in `nuxt dev` and in builds made with KANDO_COPY_EDITOR=1 (scripts/e2e-server.mjs) and in the dev instance (#246, `isDevInstance`); false in every other
 * build, which drops the live copy editor (#59, `dev-tools/copy-editor/`) from the bundle.
 */
declare const __COPY_EDITOR__: boolean;

/**
 * The /ui manifest rows (`buildManifest()`, scripts/ui-manifest.mjs), computed by nuxt.config.ts when the dev-only pages
 * ship (#65, lib/devPages.ts) and `[]` otherwise (#117: the manifest is derived, never committed).
 */
declare const __UI_MANIFEST__: import('~/dev-tools/ui-catalog/catalogModel').ManifestRow[];
