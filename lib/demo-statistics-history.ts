/**
 * @module lib/demo-statistics-history
 * @description A deterministic 8-week completion history for the dev seed `?seed=demo` (#469). The demo board only carries
 * today and yesterday, so the Statistik page would show its "thin history" state; this layers the weeks before on top.
 * Patterns are built in on purpose: office tasks run long, phone calls short, afternoons long, unplanned tasks spike on
 * Wednesdays, and the estimates improve slowly. Written by `plugins/e2e-seed.client.ts` only: `buildDemoBoard()` keeps
 * its records equal to its done tasks, and the onboarding sample button never fills permanent statistics.
 */
import type { TaskCompletionRecord } from '~/store/taskStatistics'
import { DEMO_ID_PREFIX } from '~/lib/demoIds'
import { addDays } from '~/lib/statisticsReview'
import { dayKey } from '~/utils/recapDay'
import type { WorkSession } from '~/lib/workSessions'

/** mulberry32: the same history on every reload and in every screenshot. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Kind { title: string; topic: string; activity: string; color: string; boxMinutes: number[]; bias: number }

const KINDS: Kind[] = [
  { title: 'Angebot Gartenumbau schreiben', topic: 'Angebote', activity: 'Büro', color: '#3b82f6', boxMinutes: [45, 60, 90], bias: 1.45 },
  { title: 'Rechnungen schreiben', topic: 'Buchhaltung', activity: 'Büro', color: '#964b00', boxMinutes: [30, 45, 60], bias: 1.35 },
  { title: 'Kunden zurückrufen', topic: 'Angebote', activity: 'Telefonat', color: '#3b82f6', boxMinutes: [15, 20, 30], bias: 0.8 },
  { title: 'Lieferant anrufen', topic: 'Baustelle Müller', activity: 'Telefonat', color: '#10b981', boxMinutes: [10, 15, 20], bias: 0.75 },
  { title: 'Beete anlegen', topic: 'Baustelle Müller', activity: 'Vor Ort', color: '#10b981', boxMinutes: [90, 120, 180], bias: 1.2 },
  { title: 'Aufmaß nehmen', topic: 'Baustelle Müller', activity: 'Vor Ort', color: '#10b981', boxMinutes: [60, 90], bias: 1.05 },
  { title: 'Transporter zur Inspektion', topic: 'Fuhrpark', activity: 'Fahrt', color: '#f59e0b', boxMinutes: [45, 60], bias: 1.1 },
  { title: 'Schichtplan abstimmen', topic: 'Personal', activity: 'Büro', color: '#a855f7', boxMinutes: [20, 30], bias: 1.0 },
]

/** Completion records for the weekdays from 2 to 56 days before `now`. */
export function buildDemoStatisticsHistory(now: Date = new Date()): TaskCompletionRecord[] {
  const rand = rng(469)
  const today = addDays(now, 0)
  const records: TaskCompletionRecord[] = []
  for (let ago = 56; ago >= 2; ago--) {
    const day = addDays(today, -ago)
    const weekday = day.getDay()
    if (weekday === 0 || weekday === 6) continue
    // the weeks get a little busier and the estimates a little better over time
    const progress = 1 - ago / 56
    const count = 2 + Math.floor(rand() * 3) + (weekday === 3 ? 1 : 0) + (progress > 0.7 ? 1 : 0)
    for (let i = 0; i < count; i++) {
      const kind = KINDS[Math.floor(rand() * KINDS.length)]!
      const boxSeconds = kind.boxMinutes[Math.floor(rand() * kind.boxMinutes.length)]! * 60
      const hour = 8 + Math.floor(rand() * 9)
      const afternoon = hour >= 14 ? 1.12 : 0.96
      const fade = 1 - progress * 0.18
      const accuracy = Math.max(0.45, kind.bias * afternoon * (1 + (kind.bias - 1) * (fade - 1)) * (0.82 + rand() * 0.36))
      const completedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rand() * 60))
      records.push({
        taskId: `${DEMO_ID_PREFIX}hist-${ago}-${i}`,
        title: kind.title,
        completedAt,
        timeBoxSeconds: boxSeconds,
        actualTimeSpentSeconds: Math.round(boxSeconds * accuracy),
        estimationAccuracy: accuracy * 100,
        topic: kind.topic,
        topicColorCode: kind.color,
        activity: kind.activity,
        isUnplanned: rand() < (weekday === 3 ? 0.4 : 0.15),
      })
    }
  }
  return records
}

/**
 * Tasks in flight at day end for the weekdays from 2 to 56 days before `now` (#537), falling slowly from about 8 to about 4,
 * so the Q2 week list of `?seed=demo` shows the column with a trend. Deterministic like the records.
 */
export function buildDemoDayEndHistory(now: Date = new Date()): Record<string, number> {
  const rand = rng(537)
  const today = addDays(now, 0)
  const history: Record<string, number> = {}
  for (let ago = 56; ago >= 2; ago--) {
    const date = addDays(today, -ago)
    const weekday = date.getDay()
    if (weekday === 0 || weekday === 6) continue
    history[dayKey(date)] = Math.max(1, Math.round(4 + (ago / 56) * 4 + (rand() - 0.5) * 2))
  }
  return history
}

/**
 * Work sessions for the weekdays from 1 to 55 days before `now` (#600): a morning block that starts around 8:30, a
 * break, an afternoon block, a little more on Wednesdays and the odd late hour, so the "Wann arbeite ich?" tile of
 * `?seed=demo` shows a clear peak window and a usual start. Deterministic like the records; the onboarding sample button writes none.
 */
export function buildDemoWorkSessions(now: Date = new Date()): WorkSession[] {
  const rand = rng(600)
  const today = addDays(now, 0)
  const sessions: WorkSession[] = []
  const at = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.round(minutes)).getTime()
  for (let ago = 55; ago >= 1; ago--) {
    const day = addDays(today, -ago)
    const weekday = day.getDay()
    if (weekday === 0 || weekday === 6) continue
    const start = 8 * 60 + 15 + rand() * 45
    const lunch = 12 * 60 + 5 + rand() * 40
    sessions.push({ start: at(day, start), end: at(day, lunch) })
    const back = lunch + 40 + rand() * 25
    const end = 16 * 60 + 10 + rand() * 80 + (weekday === 3 ? 45 : 0)
    sessions.push({ start: at(day, back), end: at(day, end) })
    if (rand() < 0.15) sessions.push({ start: at(day, 20 * 60 + rand() * 30), end: at(day, 21 * 60 + 5 + rand() * 30) })
  }
  return sessions
}
