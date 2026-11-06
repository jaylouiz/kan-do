/**
 * @module useToday
 * @description Shared reactive "today" (local midnight). Refreshes on tab focus / visibility and
 * by a timer to the next local midnight, so a board left open overnight re-evaluates
 * "done today" vs. "done before today" and the yesterday-note label without a reload.
 */
import { ref, type Ref } from 'vue'

/** Small buffer after midnight so the timer never fires a hair before the day changes. */
const MIDNIGHT_BUFFER_MS = 1000

const startOfDay = (date: Date): Date => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

const today = ref<Date>(startOfDay(new Date()))
let started = false
let timer: ReturnType<typeof setTimeout> | null = null

/** Only replaces the ref on a real day change so dependents do not recompute on every call. */
function syncDay() {
  const current = startOfDay(new Date())
  if (current.getTime() !== today.value.getTime()) today.value = current
}

function refresh() {
  syncDay()
  schedule()
}

function schedule() {
  if (timer !== null) clearTimeout(timer)
  const now = new Date()
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  timer = setTimeout(refresh, nextMidnight.getTime() - now.getTime() + MIDNIGHT_BUFFER_MS)
}

function start() {
  // typeof window (not import.meta.client) so the jsdom unit tests exercise the same path
  if (started || typeof window === 'undefined') return
  started = true
  refresh()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') refresh()
  })
  window.addEventListener('focus', refresh)
}

/** `today` is the local start of the current day; reactive across midnight. */
export function useToday(): { today: Ref<Date> } {
  start()
  syncDay()
  return { today }
}
