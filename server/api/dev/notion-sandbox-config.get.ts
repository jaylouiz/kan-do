import { defineEventHandler, getQuery } from 'h3'
import { handleNotionError, throwApiError } from '~/server/utils/apiError'
import {
  getSandboxDatabase,
  loadNotionSandboxCredentials,
  NOTION_SANDBOX_DB_PREFIX,
  notionSandboxConfig,
} from '~/server/utils/notionSandbox'
import { Client } from '@notionhq/client'

/**
 * Dev only: the `NotionConfig` for a Notion sandbox database (docs/testing/notion-sandbox.md),
 * read by `?seed=notion-sandbox` so a browser session connects without the token passing
 * through a command line. 404 outside `nuxt dev` or without sandbox credentials.
 */
export default defineEventHandler(async (event) => {
  const creds = import.meta.dev ? loadNotionSandboxCredentials() : null
  if (!creds) throwApiError(404, 'Notion sandbox is not configured')

  const label = typeof getQuery(event).label === 'string' ? String(getQuery(event).label) : 'default'
  try {
    const notion = new Client({ auth: creds.token, notionVersion: '2025-09-03' })
    const db = await getSandboxDatabase(notion, creds.parentPageId, label)
    if (!db) {
      throwApiError(404, `No sandbox database "${NOTION_SANDBOX_DB_PREFIX}${label}". Run: node scripts/notion-sandbox.mts reset --label ${label}`)
    }
    return notionSandboxConfig(creds.token, db)
  } catch (error) {
    handleNotionError(error)
  }
})
