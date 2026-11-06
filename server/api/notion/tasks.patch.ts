import { Client } from '@notionhq/client'
import { defineEventHandler, readBody } from 'h3'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { isNotionStubEnabled, updateStubPage } from '~/server/utils/notionStub'

export default defineEventHandler(async (event) => {
  try {
    // Validate required query parameters
    const query = validateRequest(event, ['token', 'taskId'])
    const token = query.token as string
    const taskId = query.taskId as string
    const body = await readBody(event)

    if (!body || !body.properties) {
      throw new Error('Request body must include properties to update')
    }

    if (isNotionStubEnabled(token)) {
      return updateStubPage(token, taskId, body.properties)
    }

    const notion = new Client({ auth: token, notionVersion: '2022-06-28' })
    const response = await notion.pages.update({
      page_id: taskId,
      properties: body.properties,
    })

    return response
  } catch (error) {
    handleNotionError(error)
  }
})
;
