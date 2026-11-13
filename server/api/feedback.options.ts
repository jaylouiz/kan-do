import { defineEventHandler, setResponseStatus } from 'h3'
import { setCorsHeaders } from '~/server/utils/feedbackRelay'

/** CORS preflight of `POST /api/feedback` (#268): the desktop webview and other origins post JSON. */
export default defineEventHandler((event) => {
  setCorsHeaders(event)
  setResponseStatus(event, 204)
  return null
})
