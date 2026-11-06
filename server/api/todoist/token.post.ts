import { defineEventHandler, readBody } from 'h3'
import { throwApiError } from '~/server/utils/apiError'

/**
 * Server-side proxy for the Todoist OAuth token exchange.
 * Keeps client_id and client_secret out of the browser bundle.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { code } = body

  if (!code) {
    throwApiError(400, 'Missing required parameter: code', { error: 'MISSING_PARAMETERS' })
  }

  const clientId = process.env.TODOIST_CLIENT_ID
  const clientSecret = process.env.TODOIST_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throwApiError(500, 'Todoist OAuth credentials not configured on server', { error: 'CONFIGURATION_ERROR' })
  }

  const response = await fetch('https://todoist.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })

  if (!response.ok) {
    const text = await response.text()
    throwApiError(502, `Todoist token exchange failed: ${response.status} ${text}`, { error: 'UPSTREAM_ERROR' })
  }

  const data = await response.json() as { access_token?: string }

  if (!data.access_token) {
    throwApiError(502, 'No access_token in Todoist response', { error: 'UPSTREAM_ERROR' })
  }

  return { access_token: data.access_token }
})
