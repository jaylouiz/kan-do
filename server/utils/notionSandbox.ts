import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Client } from '@notionhq/client'

/**
 * Credentials for the Notion dev sandbox: an internal integration that only sees one
 * parent page in a throwaway workspace (docs/testing/notion-sandbox.md). Read from
 * `NOTION_SANDBOX_KEY` / `NOTION_SANDBOX_PAGE_ID`, else from the file at
 * `NOTION_SANDBOX_ENV` (default `~/.config/kan-do/notion-sandbox.env`), so every
 * worktree finds them and they never live in the repo.
 *
 * Kept free of Nuxt imports: `scripts/notion-sandbox.mts` runs it under plain Node.
 */
export interface NotionSandboxCredentials {
  token: string
  parentPageId: string
}

export const NOTION_SANDBOX_ENV_PATH = join(homedir(), '.config', 'kan-do', 'notion-sandbox.env')

/** Title prefix of every database the sandbox script creates; the label follows it. */
export const NOTION_SANDBOX_DB_PREFIX = 'kan-do sandbox · '

const parseEnvFile = (path: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

/** The sandbox credentials, or null when none are configured. */
export const loadNotionSandboxCredentials = (
  env: Record<string, string | undefined> = process.env,
): NotionSandboxCredentials | null => {
  const path = env.NOTION_SANDBOX_ENV ?? NOTION_SANDBOX_ENV_PATH
  const file = existsSync(path) ? parseEnvFile(path) : {}
  const token = env.NOTION_SANDBOX_KEY ?? file.NOTION_SANDBOX_KEY
  const pageId = env.NOTION_SANDBOX_PAGE_ID ?? file.NOTION_SANDBOX_PAGE_ID
  if (!token || !pageId) return null
  return { token, parentPageId: pageId.replace(/-/g, '') }
}

export type SandboxStatusType = 'select' | 'status'

/** Status option names, in board order, plus the archive status. */
export const NOTION_SANDBOX_STATUS = {
  today: 'Today',
  doing: 'Doing',
  waiting: 'Waiting',
  done: 'Done',
  archive: 'Archiv',
} as const

const STATUS_OPTIONS = [
  { name: NOTION_SANDBOX_STATUS.today, color: 'blue' },
  { name: NOTION_SANDBOX_STATUS.doing, color: 'yellow' },
  { name: NOTION_SANDBOX_STATUS.waiting, color: 'orange' },
  { name: NOTION_SANDBOX_STATUS.done, color: 'green' },
  { name: NOTION_SANDBOX_STATUS.archive, color: 'gray' },
] as const

const PRIORITY = { urgent: 'Dringend', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' } as const

/**
 * The sandbox database schema, in the shape kan-do writes: Status is a `select`
 * by default (what `NotionIntegration` writes); `status` builds a native Status property.
 */
export const notionSandboxSchema = (statusType: SandboxStatusType = 'select') => ({
  Name: { title: {} },
  Status: statusType === 'select' ? { select: { options: STATUS_OPTIONS } } : { status: { options: STATUS_OPTIONS } },
  Aufwand: { number: { format: 'number' } },
  Timebox: { number: { format: 'number' } },
  Thema: { select: { options: [{ name: 'Kunde A', color: 'purple' }, { name: 'Intern', color: 'gray' }] } },
  'Aktivität': { multi_select: { options: [{ name: 'Schreiben', color: 'pink' }, { name: 'Review', color: 'brown' }] } },
  'Priorität': {
    select: {
      options: [
        { name: PRIORITY.urgent, color: 'red' },
        { name: PRIORITY.high, color: 'orange' },
        { name: PRIORITY.medium, color: 'yellow' },
        { name: PRIORITY.low, color: 'gray' },
      ],
    },
  },
  'Erledigt am': { date: {} },
  Ungeplant: { checkbox: {} },
})

/** A complete `NotionConfig` for a sandbox database, matching `notionSandboxSchema`. */
export const notionSandboxConfig = (
  token: string,
  ids: { databaseId: string; dataSourceId: string; databaseName: string },
) => ({
  token,
  databaseId: ids.databaseId,
  databaseName: ids.databaseName,
  dataSourceId: ids.dataSourceId,
  dataSourceName: ids.databaseName,
  propertyMapping: {
    title: 'Name',
    status: 'Status',
    dueDate: null,
    priority: 'Priorität',
    timeBox: 'Timebox',
    timeBoxUnit: 'minutes' as const,
    timeSpent: 'Aufwand',
    timeSpentUnit: 'minutes' as const,
    topic: 'Thema',
    activity: 'Aktivität',
    completedDate: 'Erledigt am',
    customProperties: [],
    unplanned: { mode: 'boolean' as const, propertyName: 'Ungeplant' },
  },
  statusMapping: { ...NOTION_SANDBOX_STATUS },
  // Three kan-do levels over the four sandbox options (#617): Dringend and Hoch both read as High
  priorityMapping: { high: [PRIORITY.high, PRIORITY.urgent], regular: [PRIORITY.medium], low: [PRIORITY.low] },
})

export interface SandboxDatabase {
  label: string
  databaseId: string
  dataSourceId: string
  databaseName: string
  url: string
}

/** Child databases of the parent page whose title starts with the sandbox prefix. */
export async function findSandboxDatabases(notion: Client, parentPageId: string): Promise<Array<{ id: string; title: string }>> {
  const found: Array<{ id: string; title: string }> = []
  let cursor: string | undefined
  do {
    const page = await notion.blocks.children.list({ block_id: parentPageId, start_cursor: cursor, page_size: 100 })
    for (const block of page.results) {
      if ('type' in block && block.type === 'child_database' && block.child_database.title.startsWith(NOTION_SANDBOX_DB_PREFIX)) {
        found.push({ id: block.id, title: block.child_database.title })
      }
    }
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return found
}

export async function getSandboxDatabase(notion: Client, parentPageId: string, label: string): Promise<SandboxDatabase | null> {
  const title = NOTION_SANDBOX_DB_PREFIX + label
  const match = (await findSandboxDatabases(notion, parentPageId)).find((db) => db.title === title)
  if (!match) return null
  const database = await notion.databases.retrieve({ database_id: match.id })
  const dataSourceId = 'data_sources' in database ? database.data_sources[0]?.id : undefined
  if (!dataSourceId) throw new Error(`Database "${title}" has no data source`)
  return { label, databaseId: match.id, dataSourceId, databaseName: title, url: 'url' in database ? database.url : '' }
}
