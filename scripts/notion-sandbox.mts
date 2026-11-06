#!/usr/bin/env node
/**
 * Notion dev sandbox: builds, seeds, inspects and tears down a real Notion database
 * that agents fully control, so Notion work needs no manual clicks in Notion.
 * Setup and usage: docs/testing/notion-sandbox.md. Runs under plain Node 24 (type stripping).
 *
 *   node scripts/notion-sandbox.mts reset [--scenario board] [--label default] [--status-type select]
 *   node scripts/notion-sandbox.mts seed <scenario> [--label default]
 *   node scripts/notion-sandbox.mts inspect [--label default]
 *   node scripts/notion-sandbox.mts record [--label default] [--out tests/fixtures/notion/recorded]
 *   node scripts/notion-sandbox.mts teardown [--label default | --all]
 *
 * Scenarios: board (default), empty, edge, many, archive-ready.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { Client } from '@notionhq/client'
import {
  findSandboxDatabases,
  getSandboxDatabase,
  loadNotionSandboxCredentials,
  NOTION_SANDBOX_DB_PREFIX,
  NOTION_SANDBOX_ENV_PATH,
  NOTION_SANDBOX_STATUS as S,
  notionSandboxSchema,
} from '../server/utils/notionSandbox.ts'
import type { SandboxDatabase, SandboxStatusType } from '../server/utils/notionSandbox.ts'

const NOTION_VERSION = '2025-09-03'
const WRITE_CONCURRENCY = 3


interface SeedTask {
  title?: string
  status?: string | null
  aufwand?: number | null
  timebox?: number | null
  thema?: string
  activity?: string
  priority?: string
  completedDaysAgo?: number
  unplanned?: boolean
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const BOARD: SeedTask[] = [
  { title: 'Angebot für Kunde A schreiben', status: S.today, timebox: 60, aufwand: 15, thema: 'Kunde A', activity: 'Schreiben', priority: 'Hoch' },
  { title: 'Pull Requests reviewen', status: S.today, timebox: 30, thema: 'Intern', activity: 'Review' },
  { title: 'Rechnung prüfen', status: S.today, priority: 'Niedrig' },
  { title: 'Release-Notes formulieren', status: S.doing, timebox: 45, aufwand: 20, activity: 'Schreiben' },
  { title: 'Rückmeldung von Legal abwarten', status: S.waiting, thema: 'Kunde A' },
  { title: 'Zugang zum Staging-Server', status: S.waiting, unplanned: true },
  { title: 'Wochenplanung', status: S.done, aufwand: 25, completedDaysAgo: 0 },
  { title: 'Inbox auf null', status: S.done, aufwand: 10, completedDaysAgo: 1 },
]

const SCENARIOS: Record<string, () => SeedTask[]> = {
  board: () => BOARD,
  empty: () => [],
  // Pages a hand-edited Notion database really contains
  edge: () => [
    { title: '', status: S.today },
    { title: 'Ohne Status', status: null },
    { title: 'Unbekannter Status', status: 'Irgendwann' },
    { title: 'Ein sehr langer Titel, '.repeat(12).trim(), status: S.today },
    { title: 'Umlaute äöü ß und Emoji 🚀', status: S.doing },
    { title: 'Timebox null, Aufwand 0', status: S.today, timebox: null, aufwand: 0 },
  ],
  // More open tasks than one query page (100) holds
  many: () => [
    ...BOARD,
    ...Array.from({ length: 120 }, (_, i) => ({ title: `Füllaufgabe ${String(i + 1).padStart(3, '0')}`, status: S.today })),
  ],
  'archive-ready': () => [
    ...BOARD,
    ...[8, 15, 31, 45].map((days) => ({ title: `Erledigt vor ${days} Tagen`, status: S.done, completedDaysAgo: days })),
  ],
}

// ---------------------------------------------------------------------------
// Notion operations (exported for tests/contract)
// ---------------------------------------------------------------------------

export const sandboxClient = (token: string): Client =>
  new Client({ auth: token, notionVersion: NOTION_VERSION })

const plainTitle = (rich: Array<{ plain_text?: string }> | undefined): string =>
  (rich ?? []).map((t) => t.plain_text ?? '').join('')

const dayOffset = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

/** Moves sandbox databases to the trash: the one with `label`, or all of them. */
export async function teardownSandbox(notion: Client, parentPageId: string, label: string | null): Promise<number> {
  const all = await findSandboxDatabases(notion, parentPageId)
  const targets = label === null ? all : all.filter((db) => db.title === NOTION_SANDBOX_DB_PREFIX + label)
  for (const db of targets) await notion.blocks.delete({ block_id: db.id })
  return targets.length
}

export async function createSandboxDatabase(
  notion: Client,
  parentPageId: string,
  label: string,
  statusType: SandboxStatusType,
): Promise<SandboxDatabase> {
  const databaseName = NOTION_SANDBOX_DB_PREFIX + label
  const database = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: databaseName } }],
    initial_data_source: { properties: notionSandboxSchema(statusType) as never },
  })
  const dataSourceId = 'data_sources' in database ? database.data_sources[0]?.id : undefined
  if (!dataSourceId) throw new Error('Notion created the database without a data source')
  return { label, databaseId: database.id, dataSourceId, databaseName, url: 'url' in database ? database.url : '' }
}

const toProperties = (task: SeedTask, statusType: SandboxStatusType): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    Name: { title: task.title ? [{ type: 'text', text: { content: task.title } }] : [] },
  }
  if (task.status) properties['Status'] = { [statusType]: { name: task.status } }
  if (task.aufwand !== undefined) properties['Aufwand'] = { number: task.aufwand }
  if (task.timebox !== undefined) properties['Timebox'] = { number: task.timebox }
  if (task.thema) properties['Thema'] = { select: { name: task.thema } }
  if (task.activity) properties['Aktivität'] = { multi_select: [{ name: task.activity }] }
  if (task.priority) properties['Priorität'] = { select: { name: task.priority } }
  if (task.completedDaysAgo !== undefined) properties['Erledigt am'] = { date: { start: dayOffset(task.completedDaysAgo) } }
  if (task.unplanned) properties['Ungeplant'] = { checkbox: true }
  return properties
}

/** Detects the Status property type so `seed` writes the right shape into an existing database. */
async function statusTypeOf(notion: Client, dataSourceId: string): Promise<SandboxStatusType> {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId })
  const status = 'properties' in source ? source.properties['Status'] : undefined
  return status?.type === 'status' ? 'status' : 'select'
}

export async function seedSandbox(notion: Client, db: SandboxDatabase, scenario: string): Promise<number> {
  const build = SCENARIOS[scenario]
  if (!build) throw new Error(`Unknown scenario "${scenario}". Known: ${Object.keys(SCENARIOS).join(', ')}`)
  const tasks = build()
  const statusType = await statusTypeOf(notion, db.dataSourceId)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!
      await notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: db.dataSourceId },
        properties: toProperties(task, statusType) as never,
      })
    }
  }
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker))
  return tasks.length
}

export async function queryAll(notion: Client, dataSourceId: string): Promise<Array<Record<string, unknown>>> {
  const pages: Array<Record<string, unknown>> = []
  let cursor: string | undefined
  do {
    const res = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 })
    pages.push(...(res.results as Array<Record<string, unknown>>))
    cursor = res.next_cursor ?? undefined
  } while (cursor)
  return pages
}

/** Compact view of a page's kan-do-relevant properties. */
export function summarizePage(page: Record<string, unknown>) {
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown> & { type?: string }>
  const value = (name: string): unknown => {
    const prop = props[name]
    if (!prop?.type) return undefined
    const raw = prop[prop.type] as unknown
    if (prop.type === 'title' || prop.type === 'rich_text') return plainTitle(raw as Array<{ plain_text?: string }>)
    if (prop.type === 'select' || prop.type === 'status') return (raw as { name?: string } | null)?.name ?? null
    if (prop.type === 'multi_select') return (raw as Array<{ name: string }>).map((o) => o.name)
    if (prop.type === 'date') return (raw as { start?: string } | null)?.start ?? null
    return raw
  }
  return {
    id: page.id,
    title: value('Name'),
    status: value('Status'),
    aufwand: value('Aufwand'),
    timebox: value('Timebox'),
    thema: value('Thema'),
    activity: value('Aktivität'),
    priority: value('Priorität'),
    completed: value('Erledigt am'),
    unplanned: value('Ungeplant'),
    inTrash: page.in_trash ?? page.archived,
    lastEdited: page.last_edited_time,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      label: { type: 'string', default: 'default' },
      scenario: { type: 'string', default: 'board' },
      'status-type': { type: 'string', default: 'select' },
      out: { type: 'string', default: join('tests', 'fixtures', 'notion', 'recorded') },
      all: { type: 'boolean', default: false },
    },
  })
  const [command, arg] = positionals
  const creds = loadNotionSandboxCredentials()
  if (!creds) {
    throw new Error(`No sandbox credentials. Set NOTION_SANDBOX_KEY and NOTION_SANDBOX_PAGE_ID or write them to ${NOTION_SANDBOX_ENV_PATH} (docs/testing/notion-sandbox.md).`)
  }
  const notion = sandboxClient(creds.token)
  const label = values.label
  const print = (data: unknown) => console.log(JSON.stringify(data, null, 2))
  const requireDb = async () => {
    const db = await getSandboxDatabase(notion, creds.parentPageId, label)
    if (!db) throw new Error(`No sandbox database "${NOTION_SANDBOX_DB_PREFIX}${label}". Run: node scripts/notion-sandbox.mts reset --label ${label}`)
    return db
  }

  switch (command) {
    case 'reset': {
      const statusType = values['status-type']
      if (statusType !== 'select' && statusType !== 'status') throw new Error('--status-type must be select or status')
      await teardownSandbox(notion, creds.parentPageId, label)
      const db = await createSandboxDatabase(notion, creds.parentPageId, label, statusType)
      const pages = await seedSandbox(notion, db, values.scenario)
      print({ ...db, scenario: values.scenario, statusType, pages, app: `http://localhost:3000/tasks?seed=notion-sandbox&label=${encodeURIComponent(label)}` })
      break
    }
    case 'seed': {
      const db = await requireDb()
      print({ ...db, scenario: arg ?? 'board', added: await seedSandbox(notion, db, arg ?? 'board') })
      break
    }
    case 'inspect': {
      const db = await requireDb()
      print({ ...db, pages: (await queryAll(notion, db.dataSourceId)).map(summarizePage) })
      break
    }
    case 'record': {
      const db = await requireDb()
      mkdirSync(values.out, { recursive: true })
      const files = {
        'database.json': await notion.databases.retrieve({ database_id: db.databaseId }),
        'data-source.json': await notion.dataSources.retrieve({ data_source_id: db.dataSourceId }),
        'query.json': await notion.dataSources.query({ data_source_id: db.dataSourceId, page_size: 100 }),
      }
      for (const [name, body] of Object.entries(files)) writeFileSync(join(values.out, name), `${JSON.stringify(body, null, 2)}\n`)
      print({ ...db, written: Object.keys(files).map((name) => join(values.out, name)) })
      break
    }
    case 'teardown': {
      print({ trashed: await teardownSandbox(notion, creds.parentPageId, values.all ? null : label) })
      break
    }
    default:
      throw new Error('Usage: node scripts/notion-sandbox.mts <reset|seed|inspect|record|teardown> [options] (see file header)')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
