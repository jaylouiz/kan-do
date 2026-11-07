// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'
import { getSandboxDatabase, loadNotionSandboxCredentials, notionSandboxConfig } from '~/server/utils/notionSandbox'
import type { SandboxDatabase } from '~/server/utils/notionSandbox'
import { NotionClientAPI } from '~/integrations/NotionClientAPI'
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'
import { TaskStatus } from '~/types/taskStatus'
import { proxyFetch } from './helpers/proxyFetch'
import { createSandboxDatabase, sandboxClient, seedSandbox, summarizePage, teardownSandbox } from '~/scripts/notion-sandbox.mts'

/**
 * Contract test against real Notion: runs the unmocked proxy routes on a fresh
 * sandbox database, with the property shapes `NotionIntegration` writes.
 * Opt-in (network, ~30 s): NOTION_SANDBOX=1 npx vitest run tests/contract
 * Setup: docs/testing/notion-sandbox.md.
 */
// NotionIntegration reports failures through the toast-based error handler, which needs a Nuxt app.
// Rethrow instead: a Notion rejection then fails the contract test rather than returning an empty list.
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: (error: unknown) => {
      throw error
    },
  }),
}))

const creds = loadNotionSandboxCredentials()
const enabled = process.env.NOTION_SANDBOX === '1' && creds !== null

/** The unmocked proxy routes the browser-mode client talks to, mounted on a supertest app. */
const buildProxyApp = async (): Promise<ReturnType<typeof supertest>> => {
  const app = createApp()
  for (const route of ['database.get', 'data-sources.get', 'query-data-source.post', 'create-task.post', 'update-task', 'pages', 'archive-page.post', 'unarchive-page.post']) {
    app.use(`/api/notion/${route.replace(/\.(post|get)$/, '')}`, (await import(`~/server/api/notion/${route}.ts`)).default)
  }
  return supertest(toNodeListener(app))
}

describe.skipIf(!enabled)('Notion proxy routes against the sandbox', () => {
  const label = `contract-${Date.now().toString(36)}`
  const notion = sandboxClient(creds?.token ?? '')
  const auth = `Bearer ${creds?.token ?? ''}`
  let db: SandboxDatabase
  let request: ReturnType<typeof supertest>

  beforeAll(async () => {
    db = await createSandboxDatabase(notion, creds!.parentPageId, label, 'select')
    await seedSandbox(notion, db, 'board')
    request = await buildProxyApp()
  }, 120_000)

  afterAll(async () => {
    if (creds) await teardownSandbox(notion, creds.parentPageId, label)
  }, 60_000)

  it('finds the database by label', async () => {
    expect((await getSandboxDatabase(notion, creds!.parentPageId, label))?.dataSourceId).toBe(db.dataSourceId)
  })

  // NotionIntegration.getDatabaseSchema reads `properties` from the database route
  it('returns the schema with the mapped property types', async () => {
    const res = await request.get(`/api/notion/database?id=${db.databaseId}`).set('Authorization', auth)
    expect(res.status).toBe(200)
    expect(res.body.properties.Name.type).toBe('title')
    expect(res.body.properties.Status.type).toBe('select')
    expect(res.body.properties.Aufwand.type).toBe('number')
  })

  it('returns the data source with its properties', async () => {
    const res = await request.get(`/api/notion/data-sources?id=${db.dataSourceId}`).set('Authorization', auth)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(db.dataSourceId)
    expect(res.body.parent.database_id).toBe(db.databaseId)
    expect(res.body.properties.Status.type).toBe('select')
  })

  it('queries the seeded pages', async () => {
    const res = await request.post('/api/notion/query-data-source').set('Authorization', auth).send({ dataSourceId: db.dataSourceId })
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(8)
  })

  it('creates, updates, reads back and archives a page', async () => {
    const created = await request.post('/api/notion/create-task').set('Authorization', auth).send({
      databaseId: db.databaseId,
      properties: {
        Name: { title: [{ text: { content: 'Vertragstest' } }] },
        Status: { select: { name: 'Today' } },
      },
    })
    expect(created.status).toBe(200)
    const pageId: string = created.body.pageId

    const updated = await request.patch('/api/notion/update-task').set('Authorization', auth).send({
      pageId,
      properties: { Status: { select: { name: 'Doing' } }, Aufwand: { number: 5 } },
    })
    expect(updated.status).toBe(200)

    const read = await request.get(`/api/notion/pages?pageId=${pageId}`).set('Authorization', auth)
    expect(read.status).toBe(200)
    expect(summarizePage(read.body)).toMatchObject({ title: 'Vertragstest', status: 'Doing', aufwand: 5 })

    const archived = await request.post('/api/notion/archive-page').set('Authorization', auth).send({ pageId })
    expect(archived.status).toBe(200)
    const page = await notion.pages.retrieve({ page_id: pageId })
    expect('in_trash' in page && page.in_trash).toBe(true)
  })
})

describe.skipIf(!enabled)('Notion un-archive against the sandbox (#422)', () => {
  const label = `contract-restore-${Date.now().toString(36)}`
  const notion = sandboxClient(creds?.token ?? '')
  const auth = `Bearer ${creds?.token ?? ''}`
  let db: SandboxDatabase
  let request: ReturnType<typeof supertest>

  beforeAll(async () => {
    db = await createSandboxDatabase(notion, creds!.parentPageId, label, 'select')
    request = await buildProxyApp()
  }, 120_000)

  afterAll(async () => {
    if (creds) await teardownSandbox(notion, creds.parentPageId, label)
  }, 60_000)

  it('archive -> un-archive brings the same page back into the database; a following query shows it once', async () => {
    const created = await request.post('/api/notion/create-task').set('Authorization', auth).send({
      databaseId: db.databaseId,
      properties: { Name: { title: [{ text: { content: 'Wiederherstellen' } }] }, Status: { select: { name: 'Doing' } } },
    })
    expect(created.status).toBe(200)
    const pageId: string = created.body.pageId

    expect((await request.post('/api/notion/archive-page').set('Authorization', auth).send({ pageId })).status).toBe(200)
    const archivedPage = await notion.pages.retrieve({ page_id: pageId })
    expect('in_trash' in archivedPage && archivedPage.in_trash).toBe(true)

    const restored = await request.post('/api/notion/unarchive-page').set('Authorization', auth).send({ pageId })
    expect(restored.status).toBe(200)
    const page = await notion.pages.retrieve({ page_id: pageId })
    expect('in_trash' in page && page.in_trash).toBe(false)

    // the snapshot is written onto the page (it kept the last upstream status, the restore writes the restored one)
    const updated = await request.patch('/api/notion/update-task').set('Authorization', auth).send({
      pageId,
      properties: { Status: { select: { name: 'Today' } } },
    })
    expect(updated.status).toBe(200)

    const query = await request.post('/api/notion/query-data-source').set('Authorization', auth).send({ dataSourceId: db.dataSourceId })
    expect(query.status).toBe(200)
    const matching = (query.body.results as Array<{ id: string }>).filter(result => result.id === pageId)
    expect(matching).toHaveLength(1)
  })

  it('un-archiving a page Notion does not have answers 404, so the client creates a new one', async () => {
    const gone = '00000000-0000-4000-8000-000000000422'
    const res = await request.post('/api/notion/unarchive-page').set('Authorization', auth).send({ pageId: gone })
    expect(res.status).toBe(404)
  })
})

// Own database (label) seeded with the `many` scenario (128 pages); seeding takes a minute or two,
// so it stays apart from the 8-page `board` database above.
describe.skipIf(!enabled)('Notion query pagination against the sandbox (#311)', () => {
  const label = `contract-many-${Date.now().toString(36)}`
  const notion = sandboxClient(creds?.token ?? '')
  let db: SandboxDatabase
  let request: ReturnType<typeof supertest>

  beforeAll(async () => {
    db = await createSandboxDatabase(notion, creds!.parentPageId, label, 'select')
    expect(await seedSandbox(notion, db, 'many')).toBe(128)
    request = await buildProxyApp()
  }, 300_000)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    if (creds) await teardownSandbox(notion, creds.parentPageId, label)
  }, 60_000)

  // The route alone returns one page; the client's loop must reach the rest through the real proxy.
  it('returns one page from the route with has_more and a cursor', async () => {
    const res = await request
      .post('/api/notion/query-data-source')
      .set('Authorization', `Bearer ${creds!.token}`)
      .send({ dataSourceId: db.dataSourceId, page_size: 100 })
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(100)
    expect(res.body.has_more).toBe(true)
    expect(typeof res.body.next_cursor).toBe('string')
  })

  it('NotionClientAPI.queryDataSource follows the cursor through the proxy and returns all 128 pages', async () => {
    const calls: string[] = []
    const bridge = proxyFetch(request)
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/')) calls.push(String(input))
      return bridge(input, init)
    })

    const { results } = await new NotionClientAPI(creds!.token).queryDataSource(db.dataSourceId)

    expect(results).toHaveLength(128)
    expect(new Set(results.map((page) => (page as { id: string }).id)).size).toBe(128)
    expect(calls).toEqual(['/api/notion/query-data-source', '/api/notion/query-data-source'])
  }, 60_000)
})

// NotionIntegration end to end through the browser proxy (fetch -> supertest bridge, #311) against a
// `select` and a native `status` sandbox database (#312). This is what confirms the native-Status
// filter shape `{ property, status: { equals } }` and write shape `{ status: { name } }` with real Notion.
describe.skipIf(!enabled).each(['select', 'status'] as const)('NotionIntegration against a %s Status sandbox database (#312)', (statusType) => {
  const label = `contract-${statusType}-${Date.now().toString(36)}`
  const notion = sandboxClient(creds?.token ?? '')
  let db: SandboxDatabase
  let integration: NotionIntegration

  beforeAll(async () => {
    db = await createSandboxDatabase(notion, creds!.parentPageId, label, statusType)
    expect(await seedSandbox(notion, db, 'board')).toBe(8)
    // proxyFetch captures the real fetch before it is stubbed: the routes' own Notion calls pass through
    vi.stubGlobal('fetch', proxyFetch(await buildProxyApp()))
    resetStatusTypeCache()
    const config = notionSandboxConfig(creds!.token, db)
    integration = new NotionIntegration(
      config.token,
      config.databaseId,
      config.propertyMapping,
      config.statusMapping,
      config.priorityMapping,
      config.dataSourceId,
    )
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (creds) await teardownSandbox(notion, creds.parentPageId, label)
  }, 60_000)

  it('queries the seeded board with the detected status filter', async () => {
    expect(await integration.getActiveBoardTasks()).toHaveLength(8)
  }, 60_000)

  it('creates a task, writes a status change and reads both back', async () => {
    const created = await integration.createTask({ title: `Statustest ${statusType}`, status: TaskStatus.Open })
    expect(summarizePage((await notion.pages.retrieve({ page_id: created.id })) as unknown as Record<string, unknown>)).toMatchObject({ title: `Statustest ${statusType}`, status: 'Today' })

    const updated = await integration.updateTask({ ...created, status: TaskStatus.Progress })
    expect(updated.status).toBe(TaskStatus.Progress)
    expect(summarizePage((await notion.pages.retrieve({ page_id: created.id })) as unknown as Record<string, unknown>)).toMatchObject({ status: 'Doing' })

    expect(await integration.getActiveBoardTasks()).toHaveLength(9)
  }, 60_000)

  it('archives through the archive status and finds the task with the archive filter', async () => {
    const [task] = await integration.getActiveBoardTasks()
    await integration.updateTask({ ...task!, archivedAt: new Date() })

    const archived = await integration.getArchivedTasks()
    expect(archived.map((entry) => entry.id)).toEqual([task!.id])
    expect(summarizePage((await notion.pages.retrieve({ page_id: task!.id })) as unknown as Record<string, unknown>)).toMatchObject({ status: 'Archiv' })
  }, 60_000)

  it('a total the user set (#4) is written lowered and cleared; an ordinary push at 0 leaves the property alone', async () => {
    const created = await integration.createTask({ title: `Zeittest ${statusType}`, status: TaskStatus.Open })

    const raised = await integration.updateTask({ ...created, timeSpentSeconds: 1800 }, { timeEdited: true })
    expect(raised.timeSpentSeconds).toBe(1800)

    const lowered = await integration.updateTask({ ...raised, timeSpentSeconds: 600 }, { timeEdited: true })
    expect(lowered.timeSpentSeconds).toBe(600)

    // not a user edit: a task at 0 does not erase what the page holds
    const untouched = await integration.updateTask({ ...lowered, timeSpentSeconds: 0 })
    expect(untouched.timeSpentSeconds).toBe(600)

    const cleared = await integration.updateTask({ ...untouched, timeSpentSeconds: 0 }, { timeEdited: true })
    expect(cleared.timeSpentSeconds).toBe(0)
  }, 60_000)
})
