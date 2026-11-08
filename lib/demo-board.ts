/**
 * @module demo-board
 * @description The shared demo board (#527): one coherent sample set for the managing director of a landscaping
 * business (offers, building sites, staff, vehicle fleet, bookkeeping), built so that every board feature has
 * something to show. Used by the onboarding button "Mit Beispielaufgaben starten" (`LocalSetupFlow`) and by the dev
 * seed `?seed=demo` (`plugins/e2e-seed.client.ts`). `?seed=local` stays the E2E fixture and is not built from this.
 *
 * Task titles, notes, topics and activities are sample DATA in German, not UI copy: no i18n keys
 * (docs/superpowers/specs/2026-10-19-i18n-design.md).
 *
 * What it covers:
 * - Offen (9): topics with 2-3 members (stacks), activities with 2-4 members, all three priorities, one card without
 *   topic and activity (the "no value" group), a timebox, a long note, a carried-over card (5 days: dots + triage nudge)
 * - Jetzt (1): a timebox with about 40 % of it spent (progress chip)
 * - Wartet (3): notes on what each waits for, carried over for 2, 4 and 7 days
 * - Erledigt (5): four done today with tracked time (one over its timebox, one unplanned, one without timebox), one yesterday
 *
 * Statistics: the backfill skips demo ids ({@link isDemoTaskId} in `lib/demoIds.ts`), so only `?seed=demo` has statistics data.
 * Dates are relative to `now`, so the board reads the same on any day. The data is pure: it touches no store.
 */
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TopicStyle } from '~/lib/topicStyles'
import type { TaskCompletionRecord } from '~/store/taskStatistics'
import { localDateKey, type CarryOverEntry } from '~/utils/carryOver'
import { demoTaskId, newDemoLoadId } from '~/lib/demoIds'

const HOUR_MS = 3_600_000

/** Colour and symbol per topic name (the `topic-styles` store, #431). */
export const DEMO_TOPIC_STYLES: Record<string, TopicStyle> = {
  'Baustelle Müller': { hue: 'green', symbol: 'leaf' },
  Angebote: { hue: 'blue', symbol: 'briefcase' },
  Personal: { hue: 'purple', symbol: 'users' },
  Fuhrpark: { hue: 'orange', symbol: 'wrench' },
  Buchhaltung: { hue: 'brown', symbol: 'currency-eur' },
}

/** The colour a source would give each topic (`Task.topicColorCode`); the style above wins when both exist. */
const TOPIC_COLOR: Record<string, string> = {
  'Baustelle Müller': '#10b981',
  Angebote: '#3b82f6',
  Personal: '#a855f7',
  Fuhrpark: '#f59e0b',
  Buchhaltung: '#964b00',
}

export interface DemoBoard {
  tasks: Task[]
  /** Carried-over counters, keyed by task id, counted through today */
  carryOverByTaskId: Record<string, CarryOverEntry>
  topicStyles: Record<string, TopicStyle>
  /** Statistics records of the done tasks, for `?seed=demo` only: the onboarding button does not store them */
  completionRecords: TaskCompletionRecord[]
}

interface DemoTaskInput {
  id: string
  title: string
  status: TaskStatus
  priority: number
  activity?: string
  topic?: string
  notes?: string
  /** Minutes */
  timeBox?: number
  /** Minutes */
  timeSpent?: number
  /** Whole days since creation */
  createdDaysAgo?: number
  /** Hours since completion, for tasks done today (never before today's midnight) */
  doneHoursAgo?: number
  /** Done yesterday evening */
  doneYesterday?: boolean
  isUnplanned?: boolean
}

/**
 * @param now The moment the board is built for; every date is relative to it
 * @param loadId Token in every task id (`demo-<loadId>-open-1`): a fresh one per load, so loading the samples twice
 *   never reuses an id (archive, trash and statistics of the first load stay out of the second). Tests pass a fixed one.
 */
export function buildDemoBoard(now: Date = new Date(), loadId: string = newDemoLoadId()): DemoBoard {
  const id = (key: string) => demoTaskId(loadId, key)
  // `days` calendar days before `now`, same wall-clock time (`now - days * 24 h` drifts by an hour across a DST switch)
  const daysBefore = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  // Done today at h hours ago, clamped to today (shortly after 00:00 `now - 4 h` would be yesterday), newest first
  const hoursAgo = (h: number) =>
    new Date(Math.min(now.getTime(), Math.max(now.getTime() - h * HOUR_MS, startOfToday + (5 - h) * 10_000)))
  const yesterdayEvening = new Date(startOfToday - 4 * HOUR_MS)

  const task = (input: DemoTaskInput): Task => {
    const created = daysBefore(input.createdDaysAgo ?? 0)
    const completedAt =
      input.doneHoursAgo !== undefined ? hoursAgo(input.doneHoursAgo) : input.doneYesterday ? yesterdayEvening : null
    return {
      id: input.id,
      source: 'local',
      externalId: null,
      status: input.status,
      title: input.title,
      activity: input.activity ?? null,
      topic: input.topic ?? null,
      topicColorCode: input.topic ? (TOPIC_COLOR[input.topic] ?? null) : null,
      priority: input.priority,
      notes: input.notes ?? null,
      timeBoxSeconds: input.timeBox === undefined ? null : input.timeBox * 60,
      timeSpentSeconds: (input.timeSpent ?? 0) * 60,
      timerId: null,
      custom: {},
      completedAt,
      createdAt: created,
      updatedAt: completedAt ?? created,
      archivedAt: null,
      isUnplanned: input.isUnplanned ?? false,
    }
  }

  const { Open, Progress, Waiting, Done } = TaskStatus

  const tasks: Task[] = [
    // Offen: Thema "Baustelle Müller" (3), "Angebote" (2), "Personal" (2), "Fuhrpark" (1)
    task({
      id: id('open-1'),
      title: 'Bepflanzungsplan Müller final abstimmen',
      status: Open,
      priority: 3,
      topic: 'Baustelle Müller',
      activity: 'Vor Ort',
      notes: 'Hainbuchenhecke an der Südgrenze, Staudenbeet am Sitzplatz.\n\n- Frau Müller möchte **mehr Blühfarbe im Frühjahr**\n- Pflanzliste an die Baumschule weitergeben',
      timeBox: 45,
      createdDaysAgo: 3,
    }),
    task({
      id: id('open-2'),
      title: 'Bagger für Montag disponieren',
      status: Open,
      priority: 3,
      topic: 'Baustelle Müller',
      activity: 'Telefonat',
      createdDaysAgo: 2,
    }),
    task({
      id: id('open-3'),
      title: 'Pflastersteine Müller nachbestellen',
      status: Open,
      priority: 3,
      topic: 'Baustelle Müller',
      activity: 'Büro',
      notes: 'Mengenabweichung laut Aufmaß: 14 m² mehr als bestellt.',
      timeBox: 20,
      createdDaysAgo: 1,
    }),
    task({
      id: id('open-4'),
      title: 'Angebot Gartenumbau Familie Schneider schreiben',
      status: Open,
      priority: 3,
      topic: 'Angebote',
      activity: 'Büro',
      notes: 'Terrasse (Naturstein), Hochbeete, Bewässerung. Aufmaß liegt im Ordner "Schneider".',
      timeBox: 90,
      createdDaysAgo: 2,
    }),
    task({
      id: id('open-5'),
      title: 'Nachfrage zum Angebot Stadtpark-Sanierung',
      status: Open,
      priority: 2,
      topic: 'Angebote',
      activity: 'Telefonat',
      createdDaysAgo: 4,
    }),
    task({
      id: id('open-6'),
      title: 'Vorstellungsgespräch Gärtner (m/w/d) führen',
      status: Open,
      priority: 3,
      topic: 'Personal',
      activity: 'Vor Ort',
      notes: 'Bewerbung liegt im Postfach. Probearbeitstag am Mittwoch anbieten.',
      timeBox: 60,
      createdDaysAgo: 5,
    }),
    task({
      id: id('open-7'),
      title: 'Urlaubsplanung Sommerteam abstimmen',
      status: Open,
      priority: 2,
      topic: 'Personal',
      activity: 'Büro',
      createdDaysAgo: 5,
    }),
    task({
      id: id('open-8'),
      title: 'TÜV-Termin für den Transporter vereinbaren',
      status: Open,
      priority: 2,
      topic: 'Fuhrpark',
      activity: 'Telefonat',
      createdDaysAgo: 6,
    }),
    // No topic, no activity, lowest priority: the "no value" group under every option
    task({
      id: id('open-9'),
      title: 'Idee: Winterdienst-Angebot für Bestandskunden prüfen',
      status: Open,
      priority: 1,
      createdDaysAgo: 1,
    }),

    // Jetzt: 90 min box, 36 min (40 %) spent
    task({
      id: id('progress-1'),
      title: 'Angebot Dachbegrünung Hotel Seeblick kalkulieren',
      status: Progress,
      priority: 3,
      topic: 'Angebote',
      activity: 'Büro',
      notes: 'Fläche 420 m², extensive Begrünung mit Sedum-Matten. Statik-Gutachten liegt vor.',
      timeBox: 90,
      timeSpent: 36,
      createdDaysAgo: 2,
    }),

    // Wartet: each says what it waits for
    task({
      id: id('waiting-1'),
      title: 'Liefertermin Hainbuchen bestätigen lassen',
      status: Waiting,
      priority: 3,
      topic: 'Baustelle Müller',
      activity: 'Telefonat',
      notes: 'Wartet auf Rückmeldung der Baumschule Kröger: 120 Hainbuchen, Lieferung vor Pflanzbeginn.',
      createdDaysAgo: 4,
    }),
    task({
      id: id('waiting-2'),
      title: 'Auftragsbestätigung Stadtpark-Sanierung',
      status: Waiting,
      priority: 3,
      topic: 'Angebote',
      activity: 'Büro',
      notes: 'Wartet auf die unterschriebene Auftragsbestätigung der Stadt.',
      createdDaysAgo: 2,
    }),
    task({
      id: id('waiting-3'),
      title: 'Rückfrage Umsatzsteuer-Voranmeldung klären',
      status: Waiting,
      priority: 2,
      topic: 'Buchhaltung',
      activity: 'Büro',
      notes: 'Wartet auf den Rückruf der Steuerberatung.',
      createdDaysAgo: 8,
    }),

    // Erledigt: four today (newest first), one yesterday
    task({
      id: id('done-1'),
      title: 'Angebot Terrassenbau Familie Hoffmann verschicken',
      status: Done,
      priority: 3,
      topic: 'Angebote',
      activity: 'Büro',
      timeBox: 60,
      timeSpent: 70,
      createdDaysAgo: 2,
      doneHoursAgo: 1,
    }),
    task({
      id: id('done-2'),
      title: 'Baustellenbegehung Müller mit dem Bauleiter',
      status: Done,
      priority: 3,
      topic: 'Baustelle Müller',
      activity: 'Vor Ort',
      timeSpent: 95,
      createdDaysAgo: 3,
      doneHoursAgo: 2,
    }),
    task({
      id: id('done-3'),
      title: 'Rückruf Herr Wiese wegen Rasenschaden',
      status: Done,
      priority: 3,
      activity: 'Telefonat',
      timeSpent: 10,
      createdDaysAgo: 0,
      doneHoursAgo: 3,
      isUnplanned: true,
    }),
    task({
      id: id('done-4'),
      title: 'Lohnabrechnung Vormonat prüfen',
      status: Done,
      priority: 2,
      topic: 'Buchhaltung',
      activity: 'Büro',
      timeBox: 45,
      timeSpent: 40,
      createdDaysAgo: 4,
      doneHoursAgo: 4,
    }),
    task({
      id: id('done-5'),
      title: 'Rechnungen Gartenpflege Bestandskunden schreiben',
      status: Done,
      priority: 2,
      topic: 'Buchhaltung',
      activity: 'Büro',
      timeBox: 60,
      timeSpent: 55,
      createdDaysAgo: 3,
      doneYesterday: true,
    }),
  ]

  // Carried-over cue (#99), counted through today so reloading the same day keeps the numbers
  const today = localDateKey(now)
  const carried = (days: number): CarryOverEntry => ({
    firstOn: localDateKey(daysBefore(days)),
    days,
    lastOn: today,
    keptAtDays: null,
  })
  const carryOverByTaskId: Record<string, CarryOverEntry> = {
    [id('open-5')]: carried(3),
    [id('open-6')]: carried(5), // past the triage nudge threshold
    [id('open-7')]: carried(5),
    [id('open-8')]: carried(6),
    [id('open-2')]: carried(1),
    [id('waiting-1')]: carried(4),
    [id('waiting-2')]: carried(2),
    [id('waiting-3')]: carried(7),
  }

  const completionRecords: TaskCompletionRecord[] = tasks.flatMap((t) =>
    t.status === TaskStatus.Done && t.completedAt
      ? [{
          taskId: t.id,
          title: t.title,
          completedAt: t.completedAt,
          timeBoxSeconds: t.timeBoxSeconds,
          actualTimeSpentSeconds: t.timeSpentSeconds,
          estimationAccuracy: t.timeBoxSeconds && t.timeSpentSeconds > 0 ? (t.timeSpentSeconds / t.timeBoxSeconds) * 100 : null,
          topic: t.topic,
          topicColorCode: t.topicColorCode,
          activity: t.activity,
          isUnplanned: t.isUnplanned ?? false,
        }]
      : [],
  )

  return { tasks, carryOverByTaskId, topicStyles: DEMO_TOPIC_STYLES, completionRecords }
}
