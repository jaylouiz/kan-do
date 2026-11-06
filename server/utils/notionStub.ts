import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

type _NotionFixtureName = 'databases' | 'database-schema' | 'tasks' | 'ping'

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'notion')

const fixtureCache = new Map<string, unknown>()

/** Sentinel API token that activates the Notion stub in dev/preview */
export const NOTION_STUB_API_KEY = 'notion_test_stub'

/**
 * True for the sentinel token and its session variants (`notion_test_stub:<session>`).
 * The session suffix only scopes the in-memory page state (see below).
 */
const isStubToken = (token?: string): boolean =>
  token === NOTION_STUB_API_KEY || (token?.startsWith(`${NOTION_STUB_API_KEY}:`) ?? false)

/**
 * Returns true when the Notion stub should be used instead of the real API.
 * Activated by either:
 *  - E2E_NOTION_STUB=1 environment variable (server-wide, e.g. set in playwright.config.ts)
 *  - token === NOTION_STUB_API_KEY or `${NOTION_STUB_API_KEY}:<session>` (per-request sentinel, only in dev/preview)
 */
export const isNotionStubEnabled = (token?: string): boolean => {
  const flag = process.env.E2E_NOTION_STUB
  if (flag === '1' || flag === 'true') return true
  // Guard sentinel token to non-production environments (runtime equivalent of __NOTION_STUB_ALLOWED__)
  const tokenStubAllowed =
    process.env.VERCEL_ENV === 'preview' ||
    process.env.NOTION_STUB_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production'
  return tokenStubAllowed && isStubToken(token)
}

/**
 * True for a stub token carrying `status=native` (`notion_test_stub:status=native:<session>`):
 * the stub then behaves like a database whose `Status` property is Notion's native Status type
 * (#312) instead of a `select`.
 */
export const stubNativeStatus = (token?: string | null): boolean =>
  !!token && isStubToken(token) && /(?:^|:)status=native(?::|$)/.test(token)

const loadFixture = (name: string): unknown => {
  if (!fixtureCache.has(name)) {
    const filePath = join(FIXTURE_ROOT, `${name}.json`)
    const raw = readFileSync(filePath, 'utf-8')
    fixtureCache.set(name, JSON.parse(raw))
  }
  return fixtureCache.get(name)!
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const getStubbedDatabases = <T>(): T => clone(loadFixture('databases') as T)

export const getStubbedDatabaseSchema = <T>(variant?: string): T => {
  const fixtureName = variant ? `database-schema-${variant}` : 'database-schema'
  const filePath = join(FIXTURE_ROOT, `${fixtureName}.json`)
  
  if (existsSync(filePath)) {
    return clone(loadFixture(fixtureName) as T)
  }
  
  return clone(loadFixture('database-schema') as T)
}

export const getStubbedTasks = <T>(variant?: string): T => {
  const fixtureName = variant ? `tasks-${variant}` : 'tasks'
  const filePath = join(FIXTURE_ROOT, `${fixtureName}.json`)
  
  if (existsSync(filePath)) {
    return clone(loadFixture(fixtureName) as T)
  }
  
  return clone(loadFixture('tasks') as T)
}

export const getStubbedPing = <T>(): T => clone(loadFixture('ping') as T)

export interface StubDataSource {
  object: 'data_source'
  id: string
  title: Array<{ plain_text: string }>
  parent: { type: 'database_id'; database_id: string }
  properties: Record<string, unknown>
}

export const getStubbedDataSources = <T extends { id: string; name: string | null; location: { type?: string; database_id?: string; page_id?: string } | null }[]>(): T => {
  const databases = getStubbedDatabases<Array<{ id: string; dataSources: Array<{ id: string; name: string | null; databaseId: string }> }>>()
  const flattened = databases.flatMap((database) =>
    database.dataSources.map((source) => ({
      id: source.id,
      name: source.name ?? null,
      location: {
        type: 'database_id',
        database_id: source.databaseId ?? database.id,
      },
    })),
  )
  return clone(flattened) as T
}

/**
 * One data source as `GET data_sources/<id>` returns it (Notion-Version 2025-09-03):
 * `title` array, `parent.database_id` and `properties` (the database-schema fixture).
 * The name and database come from `databases.json`; an unknown id fails with 404. A `status=native`
 * token gets the schema with a native Status property (`database-schema-status` fixture).
 */
export const getStubbedDataSource = <T = StubDataSource>(id: string, token?: string | null): T => {
  const databases = getStubbedDatabases<Array<{ id: string; dataSources: Array<{ id: string; name: string | null; databaseId?: string }> }>>()
  for (const database of databases) {
    const source = database.dataSources.find((candidate) => candidate.id === id)
    if (!source) continue
    return {
      object: 'data_source',
      id: source.id,
      title: [{ plain_text: source.name ?? '' }],
      parent: { type: 'database_id', database_id: source.databaseId ?? database.id },
      properties: getStubbedDatabaseSchema<Record<string, unknown>>(stubNativeStatus(token) ? 'status' : undefined),
    } as T
  }
  throw stubFailureError(404)
}

// ---------------------------------------------------------------------------
// In-memory page state
// ---------------------------------------------------------------------------
//
// Writes (update-task, tasks PATCH) are applied to an in-memory copy of the
// tasks fixture so that a later page retrieve or data-source query reflects them.
// State lives per server process and is keyed by the request token: E2E seed
// helpers use a unique `notion_test_stub:<session>` token per test, so parallel
// specs never share state. The first access for a token starts from the fixture.

export interface StubPage {
  id: string
  object?: string
  properties: Record<string, unknown>
  [key: string]: unknown
}

/** Upper bound on remembered sessions; the oldest is dropped beyond it. */
const MAX_STUB_SESSIONS = 200

const stubSessions = new Map<string, Map<string, StubPage>>()

/** Upper bound for the `pages=<n>` flag, so a typo cannot allocate an endless session. */
const MAX_STUB_PAGES = 2000

/** The total page count a stub token asks for (`notion_test_stub:pages=250:<session>`), or null. */
const stubPageCount = (token?: string): number | null => {
  if (!token || !isStubToken(token)) return null
  const match = /(?:^|:)pages=(\d+)(?::|$)/.exec(token)
  return match ? Math.min(Number(match[1]), MAX_STUB_PAGES) : null
}

/** Synthetic Today task `stub-filler-NNN` that pads a session past the fixture pages. */
const fillerPage = (index: number): StubPage => {
  const number = String(index).padStart(3, '0')
  return {
    object: 'page',
    id: `stub-filler-${number}`,
    properties: {
      Name: { title: [{ plain_text: `Füllaufgabe ${number}` }] },
      Status: { select: { name: 'Today', color: 'blue' } },
    },
  }
}

/** Rewrites a page's `Status` from the fixture's select shape to Notion's native Status shape. */
const toNativeStatus = (page: StubPage): void => {
  const current = page.properties['Status'] as { select?: { name?: string; color?: string } | null } | undefined
  if (!current || !('select' in current)) return
  page.properties['Status'] = { type: 'status', status: current.select ?? null }
}

const sessionFor = (token?: string): Map<string, StubPage> => {
  const key = token ?? ''
  let session = stubSessions.get(key)
  if (!session) {
    session = new Map(getStubbedTasks<StubPage[]>().map((page) => [page.id, page]))
    const total = stubPageCount(token) ?? 0
    for (let index = 1; session.size < total; index++) {
      const page = fillerPage(index)
      session.set(page.id, page)
    }
    if (stubNativeStatus(token)) {
      for (const page of session.values()) toNativeStatus(page)
    }
    stubSessions.set(key, session)
    if (stubSessions.size > MAX_STUB_SESSIONS) {
      const oldest = stubSessions.keys().next().value
      if (oldest !== undefined) stubSessions.delete(oldest)
    }
  }
  return session
}

/** All stub pages for this token, with any writes applied. Archived pages are not part of the database any more. */
export const getStubPages = (token?: string): StubPage[] => clone([...sessionFor(token).values()].filter((page) => page.archived !== true))

/** Archives a page like Notion's trash: a data-source query no longer returns it, a retrieve still does. */
export const archiveStubPage = (token: string | undefined, pageId: string): void => {
  const session = sessionFor(token)
  const current = session.get(pageId)
  if (current) session.set(pageId, { ...current, archived: true })
}

/** Takes an archived page out of the trash again. False when the stub has no such page (Notion: 404). */
export const unarchiveStubPage = (token: string | undefined, pageId: string): boolean => {
  const session = sessionFor(token)
  const current = session.get(pageId)
  if (!current) return false
  session.set(pageId, { ...current, archived: false })
  return true
}

/** Notion's maximum (and default) `page_size` for a data-source query. */
const STUB_MAX_PAGE_SIZE = 100
const STUB_CURSOR_PREFIX = 'stub-cursor:'

/**
 * One page of a data-source query, shaped like Notion's response: `page_size` (default and
 * maximum 100) rows from the offset in `startCursor`, plus `has_more` / `next_cursor`.
 * The cursor (`stub-cursor:<offset>`) is opaque to clients. Like the old unpaged stub,
 * the query `filter` is ignored. An unknown cursor fails like Notion's 400.
 */
export const queryStubPages = (
  token: string | undefined,
  options: { pageSize?: number; startCursor?: string } = {},
): { results: StubPage[]; has_more: boolean; next_cursor: string | null } => {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? STUB_MAX_PAGE_SIZE) || STUB_MAX_PAGE_SIZE, 1), STUB_MAX_PAGE_SIZE)
  const pages = getStubPages(token)

  let offset = 0
  if (options.startCursor !== undefined) {
    const raw = options.startCursor.startsWith(STUB_CURSOR_PREFIX) ? options.startCursor.slice(STUB_CURSOR_PREFIX.length) : ''
    offset = /^\d+$/.test(raw) ? Number(raw) : -1
    if (offset < 0 || offset > pages.length) throw stubFailureError(400)
  }

  const end = offset + pageSize
  const hasMore = end < pages.length
  return {
    results: pages.slice(offset, end),
    has_more: hasMore,
    next_cursor: hasMore ? `${STUB_CURSOR_PREFIX}${end}` : null,
  }
}

/** One stub page; an unknown id yields an empty page rather than an error. */
export const getStubPage = (token: string | undefined, pageId: string): StubPage =>
  clone(sessionFor(token).get(pageId) ?? { object: 'page', id: pageId, properties: {} })

/**
 * Notion answers a written `title` / `rich_text` with `plain_text` on each part; the stub stores the write
 * shape, so a later read (a refresh) would see an empty title. Adds the `plain_text` Notion would return.
 */
const withPlainText = (properties: Record<string, unknown>): Record<string, unknown> => {
  const next = clone(properties)
  for (const value of Object.values(next)) {
    if (typeof value !== 'object' || value === null) continue
    for (const key of ['title', 'rich_text'] as const) {
      const parts = (value as Record<string, unknown>)[key]
      if (!Array.isArray(parts)) continue
      for (const part of parts as Array<{ text?: { content?: string }; plain_text?: string }>) {
        if (part.plain_text === undefined && typeof part.text?.content === 'string') part.plain_text = part.text.content
      }
    }
  }
  return next
}

/** Merges written properties (Notion write shape) into the stored page and returns it. */
export const updateStubPage = (
  token: string | undefined,
  pageId: string,
  properties: Record<string, unknown>,
): StubPage => {
  const session = sessionFor(token)
  const current = session.get(pageId) ?? { object: 'page', id: pageId, properties: {} }
  const next: StubPage = { ...current, properties: { ...current.properties, ...withPlainText(properties) } }
  session.set(pageId, next)
  return clone(next)
}

/** Adds a page built from written properties (Notion write shape) and returns it. */
export const createStubPage = (
  token: string | undefined,
  properties: Record<string, unknown>,
): StubPage => {
  const page: StubPage = {
    object: 'page',
    id: `stub-page-${crypto.randomUUID()}`,
    created_time: new Date().toISOString(),
    last_edited_time: new Date().toISOString(),
    properties: withPlainText(properties),
  }
  sessionFor(token).set(page.id, page)
  return clone(page)
}

// ---------------------------------------------------------------------------
// Failure injection
// ---------------------------------------------------------------------------
//
// A stub token carrying `fail=<status>` (e.g. `notion_test_stub:fail=401:<session>`)
// makes every Notion route answer as if Notion had returned that status, through
// the same `handleNotionError` mapping real errors take.

const FAILURE_CODES: Record<number, string> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'restricted_resource',
  404: 'object_not_found',
  409: 'conflict_error',
  429: 'rate_limited',
  500: 'internal_server_error',
  502: 'bad_gateway',
  503: 'service_unavailable',
}

/** The status a stub token asks to fail with, or null for a normal stub token. */
export const stubFailureStatus = (token?: string | null): number | null => {
  if (!token || !isStubToken(token)) return null
  const match = /(?:^|:)fail=(\d{3})(?::|$)/.exec(token)
  return match ? Number(match[1]) : null
}

/**
 * The status a stub token asks only `create-task` to fail with (`notion_test_stub:create-fail=400:<session>`),
 * or null. Reads and updates stay healthy, so a board loads and syncs while a create is refused (#321).
 */
export const stubCreateFailureStatus = (token?: string | null): number | null => {
  if (!token || !isStubToken(token)) return null
  const match = /(?:^|:)create-fail=(\d{3})(?::|$)/.exec(token)
  return match ? Number(match[1]) : null
}

/** An error shaped like the client's `APIResponseError` for the given status. */
export const stubFailureError = (status: number, message?: string): Error =>
  Object.assign(new Error(message ?? `Simulated Notion failure (${status})`), {
    name: 'APIResponseError',
    status,
    code: FAILURE_CODES[status] ?? 'internal_server_error',
  })

// ---------------------------------------------------------------------------
// Status property shape validation
// ---------------------------------------------------------------------------
//
// Notion rejects a filter or write whose key does not match the property's type. The stub
// mirrors that for the property named `Status` only (other properties stay loosely checked so
// existing specs keep working): a `status=native` token holds a native Status property, every
// other stub token a select. Messages copy Notion's.

const STUB_STATUS_PROPERTY = 'Status'

/** Describes how `value` misses the expected key (`both`, `neither` or the `other` key), or null when it fits. */
const wrongStatusKey = (value: unknown, expected: 'select' | 'status'): string | null => {
  if (typeof value !== 'object' || value === null) return null
  const other = expected === 'status' ? 'select' : 'status'
  const hasExpected = expected in value
  const hasOther = other in value
  if (hasExpected && hasOther) return 'both'
  if (!hasExpected && !hasOther) return 'neither'
  return hasOther ? other : null
}

const assertStubStatusFilter = (filter: unknown, expected: 'select' | 'status'): void => {
  if (typeof filter !== 'object' || filter === null) return
  const node = filter as { property?: unknown; or?: unknown; and?: unknown }
  for (const group of [node.or, node.and]) {
    if (Array.isArray(group)) group.forEach((child) => assertStubStatusFilter(child, expected))
  }
  if (node.property !== STUB_STATUS_PROPERTY) return
  const wrong = wrongStatusKey(node, expected)
  if (wrong) {
    throw stubFailureError(
      400,
      `The property type in the database does not match the property type of the filter provided: database property ${expected} does not match filter ${wrong}`,
    )
  }
}

/**
 * Throws a 400 `validation_error` (passed through as 400 `NOTION_API_ERROR` by the routes, as in
 * production) when a query filter condition or written value for `Status` uses the wrong key
 * for the token's mode. Walks `or` / `and` groups recursively.
 */
export const assertStubStatusShape = (
  token: string | undefined,
  input: { filter?: unknown; properties?: Record<string, unknown> | null },
): void => {
  const expected = stubNativeStatus(token) ? 'status' : 'select'
  assertStubStatusFilter(input.filter, expected)
  if (wrongStatusKey(input.properties?.[STUB_STATUS_PROPERTY], expected)) {
    throw stubFailureError(400, `${STUB_STATUS_PROPERTY} is expected to be ${expected}.`)
  }
}

/** Drops all stub page state (unit tests). */
export const resetNotionStubState = (): void => {
  stubSessions.clear()
}
