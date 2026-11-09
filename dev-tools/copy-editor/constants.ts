/** Marks every element of the tool's own UI: the picker never offers or swallows events on it. Also the proof string
 *  `tests/config/copy-editor-build-output.test.ts` looks for in a build that must not contain the tool. */
export const UI_ATTR = 'data-kando-copy-editor'
/** localStorage key of the collected edits (a dev convenience: not app data, not in PERSISTED_KEYS). */
export const EDITS_STORAGE_KEY = 'kando-copy-editor-edits'
/** Request header the dev routes require (`server/copy-editor/guard.ts`). */
export const API_HEADER = 'x-kando-copy-editor'
