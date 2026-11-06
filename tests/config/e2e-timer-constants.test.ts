import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FOCUS_KEY_IDLE_MS, FOCUS_MOUSE_IDLE_MS, FOCUS_RETURN_DELAY_MS, FOCUS_TOUCH_IDLE_MS, GAP_CLOSE_MS, NUDGE_COUNTDOWN_MS, TOAST_CLOSE_POLL_MS,
  UNDO_RETURN_MS, UNDO_WINDOW_MS,
} from '../e2e/helpers/clock'

// #543: E2E specs drive app timers with the page clock and need the timer lengths, but cannot import the composables
// (they pull in Nuxt). `helpers/clock.ts` repeats the values; this pins them to their source, so a changed window
// fails here instead of making a spec assert after a window that has not ended.
const constantIn = (file: string, name: string): number => {
  const source = readFileSync(resolve(__dirname, '../..', file), 'utf8')
  const match = new RegExp(`const ${name} = ([0-9_]+)`).exec(source)
  if (!match?.[1]) throw new Error(`${name} not found in ${file}`)
  return Number(match[1].replaceAll('_', ''))
}

describe('E2E clock helper constants', () => {
  it.each([
    ['composables/useTaskMove.ts', 'MOVE_UNDO_WINDOW_MS', UNDO_WINDOW_MS],
    ['composables/useTaskDeletion.ts', 'DELETE_UNDO_WINDOW_MS', UNDO_WINDOW_MS],
    ['composables/useGithubTokens.ts', 'REMOVE_UNDO_WINDOW_MS', UNDO_WINDOW_MS],
    ['lib/deleteGapState.ts', 'GAP_CLOSE_MS', GAP_CLOSE_MS],
    ['lib/deleteGapState.ts', 'UNDO_RETURN_MS', UNDO_RETURN_MS],
    ['composables/useUndoWindow.ts', 'TOAST_CLOSE_POLL_MS', TOAST_CLOSE_POLL_MS],
    ['store/board.ts', 'TIMEBOX_NUDGE_MS', NUDGE_COUNTDOWN_MS],
    ['composables/useFocusOverlay.ts', 'MOUSE_IDLE_MS', FOCUS_MOUSE_IDLE_MS],
    ['composables/useFocusOverlay.ts', 'KEY_IDLE_MS', FOCUS_KEY_IDLE_MS],
    ['composables/useFocusOverlay.ts', 'TOUCH_IDLE_MS', FOCUS_TOUCH_IDLE_MS],
    ['composables/useFocusOverlay.ts', 'RETURN_DELAY_MS', FOCUS_RETURN_DELAY_MS],
  ])('%s %s matches the helper', (file, name, helperValue) => {
    expect(helperValue).toBe(constantIn(file, name))
  })
})
