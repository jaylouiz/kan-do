/**
 * @module copy-editor/routes
 * @description The two dev-only HTTP routes of the live copy editor (#59), registered by `nuxt.config.ts` through
 * `nitro.handlers` only in `nuxt dev` (they are not under `server/api`, so no build scans them in).
 * `POST /api/dev/copy/translate` drafts the other language, `POST /api/dev/copy/publish` opens the PR.
 * @responsibility Wire h3 to the pure flows: request guard, body, repository root, status codes. No logic of its own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createError, defineEventHandler, getRequestHeaders, readBody, setResponseStatus } from 'h3'
import type { TermEntry } from '../../lib/copy-editor/terms'
import { run } from './exec'
import { checkRequestHeaders } from './guard'
import { readLocaleTrees } from './locales'
import { publish } from './publish'
import { extractVoiceRules, translate, validateItems } from './translate'

const root = () => process.cwd()
const readTerms = () => JSON.parse(readFileSync(join(root(), 'docs/copy/terms.json'), 'utf8')) as TermEntry[]

function guard(event: Parameters<typeof getRequestHeaders>[0]) {
  const problem = checkRequestHeaders(getRequestHeaders(event))
  if (problem) throw createError({ statusCode: 403, statusMessage: problem })
}

export const translateRoute = defineEventHandler(async (event) => {
  guard(event)
  const base = readLocaleTrees(root())
  const parsed = validateItems(await readBody(event), base)
  if (!parsed.ok) {
    setResponseStatus(event, 400)
    return { ok: false, errors: parsed.errors }
  }
  const designMd = readFileSync(join(root(), 'DESIGN.md'), 'utf8')
  const result = await translate(parsed.items, {
    base,
    terms: readTerms(),
    rules: extractVoiceRules(designMd),
    run,
    agentCmd: process.env.KANDO_COPY_AGENT_CMD || 'claude',
  })
  if (!result.ok) setResponseStatus(event, 502)
  return result
})

export const publishRoute = defineEventHandler(async (event) => {
  guard(event)
  const result = await publish(await readBody(event), { root: root(), run, terms: readTerms() })
  if (!result.ok) setResponseStatus(event, result.step === 'validate' ? 400 : result.step === 'busy' ? 409 : 502)
  return result
})
