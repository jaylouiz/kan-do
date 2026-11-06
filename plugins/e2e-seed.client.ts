/**
 * @module e2e-seed
 * @description Dev-only plugin that seeds localStorage with test data via a URL query parameter.
 * Activated by appending `?seed=<mode>` to any URL when running the dev server.
 *
 * Supported modes:
 *   ?seed=local   — Local source, pre-populated tasks across all 4 columns
 *   ?seed=dayclose — Local source, board tailored to review the end-of-day closing dialog (#98):
 *                   several tasks done today (one without time, one with a long title), one done yesterday,
 *                   stale Offen/Jetzt/Wartet cards for the triage block, a fresh card without carry-over
 *   ?seed=newday[-all][&daysago=n] — Local source, first start on a new day (#385): four tasks done n days ago (default 1),
 *                   not archived, plus an open and a waiting card; `newday-all` has nothing open. Writes `day-recap-store`
 *                   with `lastShownDay` n+1 days back, so the recap opens (`&daysago=3` reads "am Montag"-style copy)
 *   ?seed=demo    — Local source, the realistic demo board (#527, lib/demo-board.ts): a landscaping business owner's
 *                   offers, building sites, staff and bookkeeping. Offen has topics, activities and priorities that form
 *                   stacks under every grouping option, Jetzt a timebox with time spent, Wartet notes and carry-over,
 *                   Erledigt tasks done today and yesterday; topics come with colours and symbols. Writes the statistics
 *                   records of the done tasks too (the onboarding button does not: the backfill skips demo ids). Not an
 *                   E2E fixture: use `?seed=local` for specs
 *   ?seed=notion  — Notion stub mode (token = 'notion_test_stub'), pre-populated tasks
 *   ?seed=mixed   — Local and Notion tasks side by side (Notion stub, default source Notion; `&default=local`
 *                   makes Local the default source); the Notion tasks are the stub's own pages
 *   ?seed=notion-sandbox[&label=<label>] — real Notion sandbox database (dev server only,
 *                   docs/testing/notion-sandbox.md); empty local cache, tasks load from Notion
 *   ?seed=clear   — clears all integration state (board-store, tasks-store, notionConfig, legacy linearConfig, settings-store)
 *                   , the trash (trash-store), the topic colours and symbols (topic-styles) and the persisted UI locale (kando-locale)
 *
 * Every mode but `clear` also writes settings-store with the Fokus overlay (#394) OFF, so touch taps and screenshots
 * are not affected; add `&focus=1` to see the overlay (the app default) on a seeded board.
 *
 * After seeding, the plugin removes the query param and reloads so the app starts cleanly.
 *
 * Usage:
 *   npm run dev
 *   open http://localhost:3000/tasks?seed=local
 *   open http://localhost:3000/tasks?seed=notion
 *
 * Also hands the specs `window.__kandoE2E.connectSource(id)`, the composable the Verbindungen page calls (#540): a
 * spec cannot import it by its `/_nuxt/` source path, which only exists under Vite dev. It runs inside the Nuxt app
 * context, like the page's own call, and resolves to its `ConnectResult`.
 *
 * Active when __NOTION_STUB_ALLOWED__ is true (dev + Vercel preview + E2E production builds with
 * NOTION_STUB_ENABLED=true). Tree-shaken out of fully deployed production builds, hook included.
 */

import { LOCALE_STORAGE_KEY } from '~/utils/localeResolution'
import { localDateKey } from '~/utils/carryOver'
import { dayKey } from '~/utils/recapDay'
import { buildDemoBoard } from '~/lib/demo-board'
import { buildDemoDayEndHistory, buildDemoStatisticsHistory, buildDemoWorkSessions } from '~/lib/demo-statistics-history'
import { useSourceConnections } from '~/composables/useSourceConnections'
import type { IntegrationSourceId } from '~/types/taskSource'

export default defineNuxtPlugin((nuxtApp) => {
  if (!__NOTION_STUB_ALLOWED__) return
  if (!import.meta.client) return

  ;(window as unknown as { __kandoE2E?: unknown }).__kandoE2E = {
    connectSource: (source: IntegrationSourceId) => nuxtApp.runWithContext(() => useSourceConnections().connectSource(source)),
  }

  const url = new URL(window.location.href)
  const seed = url.searchParams.get('seed')

  if (!seed) return

  // Shared task data covering all 4 columns (Offen / Jetzt / Wartet / Erledigt)
  const now = new Date().toISOString()
  const yesterday = new Date(Date.now() - 86_400_000).toISOString()

  const seedTasks = [
    // Rich task: activity + topic set, no timebox
    { id: 'seed-open-1', title: 'Konzept ausarbeiten', status: 0, priority: 2, activity: 'Planung', topic: 'Design', topicColorCode: '#6366f1', notes: 'Entwurf bis Ende der Woche fertigstellen.', timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: now, updatedAt: now },
    // Timebox set, no time used yet
    { id: 'seed-open-2', title: 'Dokumentation lesen', status: 0, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: 2700, custom: {}, createdAt: now, updatedAt: now },
    // In progress: timebox with partial time already used (only 1 task in status 1)
    { id: 'seed-progress-1', title: 'Review schreiben', status: 1, priority: 1, activity: 'Entwicklung', topic: 'Backend', topicColorCode: '#10b981', timeSpentSeconds: 1800, timeBoxSeconds: 3600, custom: {}, createdAt: now, updatedAt: now },
    { id: 'seed-waiting-1', title: 'Blocker klären', status: 2, priority: 2, activity: null, topic: null, topicColorCode: null, notes: 'Warte auf Rückmeldung vom Team.', timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: now, updatedAt: now },
    { id: 'seed-done-1', title: 'Retrospektive nachbereiten', status: 3, priority: 3, activity: 'Planung', topic: null, topicColorCode: null, timeSpentSeconds: 3600, timeBoxSeconds: 3600, completedAt: now, custom: {}, createdAt: yesterday, updatedAt: now },
    { id: 'seed-done-2', title: 'CI Pipeline optimieren', status: 3, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 1800, timeBoxSeconds: 1800, completedAt: yesterday, custom: {}, createdAt: yesterday, updatedAt: yesterday },
  ]

  // Day-close review board (#98). "Fertig" moves the Jetzt card back to Offen (and stops its timer if you started one).
  // "Done today" at h hours ago, but never before this local midnight: shortly after 00:00 `now - 4 h` is yesterday and the
  // Done column would show only the "Gestern erledigt" note (no cards, no sorting control; #449). The clamp keeps the order
  // (h=1 newest) and stays at or before `now` from 00:00:40 on.
  const hoursAgo = (h: number) => {
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    return new Date(Math.max(Date.now() - h * 3_600_000, startOfToday + (5 - h) * 10_000)).toISOString()
  }
  const dayCloseTasks = [
    { id: 'dc-done-1', title: 'Angebot an Kunden schicken', status: 3, priority: 2, activity: 'Planung', topic: null, topicColorCode: null, timeSpentSeconds: 4500, timeBoxSeconds: 3600, completedAt: hoursAgo(1), custom: {}, createdAt: yesterday, updatedAt: now },
    { id: 'dc-done-2', title: 'Steuerunterlagen sortieren', status: 3, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 2700, timeBoxSeconds: null, completedAt: hoursAgo(2), custom: {}, createdAt: yesterday, updatedAt: now },
    { id: 'dc-done-3', title: 'Kurze Rückfrage beantwortet (ohne erfasste Zeit)', status: 3, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, completedAt: hoursAgo(3), custom: {}, createdAt: now, updatedAt: now },
    { id: 'dc-done-4', title: 'Sehr langer Aufgabentitel, der in der Zusammenfassung sauber umbrechen muss, ohne die Zeile zu sprengen oder die Zeit zu verdrängen', status: 3, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 1200, timeBoxSeconds: null, completedAt: hoursAgo(4), custom: {}, createdAt: yesterday, updatedAt: now },
    { id: 'dc-done-old', title: 'Gestern erledigt (darf im Dialog nicht erscheinen)', status: 3, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 900, timeBoxSeconds: null, completedAt: yesterday, custom: {}, createdAt: yesterday, updatedAt: yesterday },
    { id: 'dc-progress-1', title: 'Präsentation vorbereiten', status: 1, priority: 1, activity: 'Entwicklung', topic: 'Backend', topicColorCode: '#10b981', timeSpentSeconds: 1800, timeBoxSeconds: 3600, custom: {}, createdAt: now, updatedAt: now },
    { id: 'dc-open-stale', title: 'Steuerberater anrufen', status: 0, priority: 2, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: yesterday, updatedAt: yesterday },
    { id: 'dc-open-oldest', title: 'Altes Thema endlich klären', status: 0, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: yesterday, updatedAt: yesterday },
    { id: 'dc-open-fresh', title: 'Neue Idee notieren', status: 0, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: now, updatedAt: now },
    { id: 'dc-waiting-stale', title: 'Rückmeldung vom Vermieter', status: 2, priority: 2, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: yesterday, updatedAt: yesterday },
  ]
  const carriedFor = (days: number) => ({ firstOn: localDateKey(new Date(Date.now() - days * 86_400_000)), days, lastOn: localDateKey(), keptAtDays: null })
  const dayCloseCarryOver = {
    'dc-open-stale': carriedFor(5), // past threshold: triage block
    'dc-open-oldest': carriedFor(9), // dots at cap + triage block
    'dc-waiting-stale': carriedFor(6), // Wartet: never gets the block
  }

  // New-day recap board (#385): tasks done `daysago` days back, not archived; the open work carries over
  const daysAgo = Math.max(1, Math.floor(Number(url.searchParams.get('daysago'))) || 1)
  url.searchParams.delete('daysago')
  const doneAt = (hour: number, minute = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, minute, 0, 0); return d.toISOString() }
  const newDayTask = (t: { id: string, status: number } & Record<string, unknown>) => ({ priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: yesterday, updatedAt: yesterday, ...t })
  const newDayDone = [
    newDayTask({ id: 'nd-done-1', title: 'Angebot an Kunden schicken', status: 3, priority: 2, activity: 'Planung', timeSpentSeconds: 4500, timeBoxSeconds: 3600, completedAt: doneAt(11, 15) }),
    newDayTask({ id: 'nd-done-2', title: 'Kurze Rückfrage beantwortet', status: 3, priority: 3, completedAt: doneAt(13) }),
    newDayTask({ id: 'nd-done-3', title: 'Steuerunterlagen sortieren', status: 3, timeSpentSeconds: 2700, completedAt: doneAt(14, 30) }),
    newDayTask({ id: 'nd-done-4', title: 'Sehr langer Aufgabentitel, der sauber umbrechen muss, ohne die Zeile zu sprengen', status: 3, timeSpentSeconds: 1200, completedAt: doneAt(15, 45) }),
  ]
  const newDayUndone = [
    newDayTask({ id: 'nd-open-1', title: 'Konzept ausarbeiten', status: 0, priority: 2, activity: 'Planung', topic: 'Design', topicColorCode: '#6366f1', timeBoxSeconds: 2700 }),
    newDayTask({ id: 'nd-waiting-1', title: 'Rückmeldung vom Vermieter', status: 2, priority: 2 }),
  ]
  const newDayAllDone = [...newDayDone, newDayTask({ id: 'nd-done-5', title: 'Retrospektive nachbereiten', status: 3, activity: 'Planung', timeSpentSeconds: 3600, timeBoxSeconds: 3600, completedAt: doneAt(17, 10) })]
  const newDayCarryOver = { 'nd-open-1': carriedFor(2), 'nd-waiting-1': carriedFor(3) }

  const byStatus = (s: number, list: { id: string, status: number }[] = seedTasks) => list.filter((t) => t.status === s).map((t) => t.id)

  // Tasks carry the source they live in (#326): Local tasks have no externalId, Notion tasks use their id
  const stamp = <T extends { id: string }>(list: T[], source: 'local' | 'notion') =>
    list.map((t) => ({ ...t, source, externalId: source === 'local' ? null : t.id }))

  const tasksStoreFor = (source: 'local' | 'notion', list: { id: string, status: number }[] = seedTasks, overrides: Record<string, unknown> = {}) => ({
    ...tasksStoreBase,
    tasks: stamp(list, source),
    ...overrides,
  })

  const tasksStoreBase = {
    tasks: seedTasks,
    isLoading: false,
    lastSyncTimestamp: null,
    archivedTaskIds: [],
    deletedTaskIds: [],
    pendingTimeUpdates: {},
    customPropertyIndexes: {},
    taskOperationVersions: {},
    batchOperationInProgress: false,
    // Carried-over cue (#99): counted through today, so reloading the same day keeps these numbers
    carryOverByTaskId: {
      'seed-open-1': { firstOn: localDateKey(new Date(Date.now() - 5 * 86_400_000)), days: 5, lastOn: localDateKey(), keptAtDays: null },
      'seed-open-2': { firstOn: localDateKey(new Date(Date.now() - 2 * 86_400_000)), days: 2, lastOn: localDateKey(), keptAtDays: null },
      'seed-waiting-1': { firstOn: localDateKey(new Date(Date.now() - 3 * 86_400_000)), days: 3, lastOn: localDateKey(), keptAtDays: null },
    },
    pendingDeletes: {},
  }

  const buildBoardStore = (source: 'local' | 'notion', list: { id: string, status: number }[] = seedTasks) => ({
    boardConfig: { sources: source === 'local' ? { connected: [], default: 'local' } : { connected: ['notion'], default: 'notion' } },
    columns: [
      { idClassSuffix: 'open', taskStatus: 0, taskOrder: byStatus(0, list), taskPositions: {} },
      { idClassSuffix: 'progress', taskStatus: 1, taskOrder: byStatus(1, list), taskPositions: {} },
      { idClassSuffix: 'waiting', taskStatus: 2, taskOrder: byStatus(2, list), taskPositions: {} },
      { idClassSuffix: 'done', taskStatus: 3, taskOrder: byStatus(3, list), taskPositions: {} },
    ],
    grouping: { enabled: false, key: null },
  })

  const stubNotionConfig = {
    config: {
      token: 'notion_test_stub',
      databaseId: 'db-123',
      dataSourceId: 'ds-123',
      propertyMapping: {
        title: 'Name',
        status: 'Status',
        dueDate: null,
        priority: null,
        timeBox: 'Timebox',
        timeSpent: 'Aufwand',
        timeSpentUnit: 'minutes',
        customProperties: [],
      },
      statusMapping: { today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting' },
    },
  }

  // Seeds keep the Fokus overlay off unless asked for (`&focus=1`); the app default is on
  if (['local', 'demo', 'dayclose', 'notion', 'mixed', 'notion-sandbox'].includes(seed)) {
    localStorage.setItem('settings-store', JSON.stringify({ focusEnabled: url.searchParams.get('focus') === '1' }))
    url.searchParams.delete('focus')
  }

  // A seeded board starts with an empty trash (#422), so the dock shows no trash icon until a task is deleted
  if (['local', 'demo', 'dayclose', 'newday', 'newday-all', 'notion', 'mixed', 'notion-sandbox'].includes(seed)) {
    localStorage.removeItem('trash-store')
    // ... and no topic colours or symbols left over from a previous seed (#431)
    localStorage.removeItem('topic-styles')
  }

  if (seed === 'local') {
    localStorage.setItem('board-store', JSON.stringify(buildBoardStore('local')))
    localStorage.setItem('tasks-store', JSON.stringify(tasksStoreFor('local')))
  } else if (seed === 'demo') {
    const demo = buildDemoBoard()
    localStorage.setItem('board-store', JSON.stringify(buildBoardStore('local', demo.tasks)))
    localStorage.setItem('tasks-store', JSON.stringify(tasksStoreFor('local', demo.tasks, { carryOverByTaskId: demo.carryOverByTaskId })))
    localStorage.setItem('topic-styles', JSON.stringify({ styles: demo.topicStyles }))
    // The statistics backfill skips demo tasks (the onboarding button must not fill permanent statistics), so the dev seed writes its records itself
    // plus eight weeks of history, so the Statistik page shows a verdict and trends (#469)
    localStorage.setItem('taskStatistics', JSON.stringify({ completionRecords: [...buildDemoStatisticsHistory(), ...demo.completionRecords], dayEndInFlight: buildDemoDayEndHistory(), workSessions: buildDemoWorkSessions() }))
  } else if (seed === 'dayclose') {
    localStorage.setItem('board-store', JSON.stringify(buildBoardStore('local', dayCloseTasks)))
    localStorage.setItem('tasks-store', JSON.stringify(tasksStoreFor('local', dayCloseTasks, { carryOverByTaskId: dayCloseCarryOver })))
  } else if (seed === 'newday' || seed === 'newday-all') {
    const list = seed === 'newday' ? [...newDayDone, ...newDayUndone] : newDayAllDone
    const lastShown = new Date(); lastShown.setDate(lastShown.getDate() - daysAgo - 1)
    localStorage.setItem('board-store', JSON.stringify(buildBoardStore('local', list)))
    localStorage.setItem('tasks-store', JSON.stringify(tasksStoreFor('local', list, { carryOverByTaskId: seed === 'newday' ? newDayCarryOver : {} })))
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: dayKey(lastShown), archiveDone: true }))
  } else if (seed === 'notion') {
    localStorage.setItem('board-store', JSON.stringify(buildBoardStore('notion')))
    localStorage.setItem('tasks-store', JSON.stringify(tasksStoreFor('notion')))
    localStorage.setItem('notionConfig', JSON.stringify(stubNotionConfig))
  } else if (seed === 'mixed') {
    // Local + Notion side by side (#326): the Notion tasks are the stub's pages (tests/fixtures/notion/tasks.json),
    // so the Notion fetch keeps them; the Local tasks must survive that fetch.
    const mixedTasks = [
      ...[
        { id: 'page-1', title: 'Fokusaufgabe vorbereiten', status: 0 },
        { id: 'page-2', title: 'Review Team Updates', status: 1 },
        { id: 'page-3', title: 'Blocker klären', status: 2 },
        { id: 'page-4', title: 'Retrospektive nachbereiten', status: 3 },
      ].map((t) => ({ priority: 2, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: now, updatedAt: now, ...t, source: 'notion', externalId: t.id })),
      ...[
        { id: 'local-open-1', title: 'Lokal: Einkauf planen', status: 0 },
        { id: 'local-waiting-1', title: 'Lokal: Antwort abwarten', status: 2 },
        { id: 'local-done-1', title: 'Lokal: Wäsche erledigt', status: 3 },
      ].map((t) => ({ priority: 2, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: now, updatedAt: now, ...t, source: 'local', externalId: null })),
    ]
    const defaultSource = url.searchParams.get('default') === 'local' ? 'local' : 'notion'
    url.searchParams.delete('default')
    localStorage.setItem('board-store', JSON.stringify({
      ...buildBoardStore('notion', mixedTasks),
      boardConfig: { sources: { connected: ['notion'], default: defaultSource } },
    }))
    localStorage.setItem('tasks-store', JSON.stringify({ ...tasksStoreBase, tasks: mixedTasks, carryOverByTaskId: {} }))
    localStorage.setItem('notionConfig', JSON.stringify(stubNotionConfig))
  } else if (seed === 'notion-sandbox') {
    // The config (with the sandbox token) comes from the dev server, so it never appears in a URL or command
    const label = url.searchParams.get('label') ?? 'default'
    void fetch(`/api/dev/notion-sandbox-config?label=${encodeURIComponent(label)}`)
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.data?.message ?? `HTTP ${response.status}`)
        localStorage.setItem('board-store', JSON.stringify(buildBoardStore('notion', [])))
        localStorage.setItem('tasks-store', JSON.stringify(tasksStoreFor('notion', [], { carryOverByTaskId: {} })))
        localStorage.setItem('notionConfig', JSON.stringify({ config: body }))
        url.searchParams.delete('seed')
        url.searchParams.delete('label')
        window.location.replace(url.toString())
      })
      .catch((error: unknown) => {
        window.alert(`Notion sandbox seed failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    return
  } else if (seed === 'clear') {
    localStorage.removeItem('board-store')
    localStorage.removeItem('tasks-store')
    localStorage.removeItem('notionConfig')
    localStorage.removeItem('settings-store')
    localStorage.removeItem('linearConfig')
    localStorage.removeItem('day-recap-store')
    localStorage.removeItem('trash-store')
    localStorage.removeItem('topic-styles')
    localStorage.removeItem(LOCALE_STORAGE_KEY)
  } else {
    // Unknown seed mode — skip reload to avoid infinite loop
    return
  }

  // Remove ?seed= param and reload so the app hydrates from the freshly seeded store
  url.searchParams.delete('seed')
  window.location.replace(url.toString())
})
