import { describe, expect, it } from 'vitest'
import { classifyUploadStatus } from '~/lib/feedback/uploadAccess'

describe('classifyUploadStatus', () => {
  it.each([
    [403, { message: 'Resource not accessible by personal access token' }],
    [403, { message: 'Resource not accessible by integration' }],
    [403, { message: 'Must have admin rights to Repository.' }],
    [404, { message: 'Not Found' }],
    [404, null],
  ])('%i %j means the permission is missing', (status, body) => {
    expect(classifyUploadStatus(status, body)).toBe('denied')
  })

  it.each([
    [403, { message: 'API rate limit exceeded for user ID 1.' }],
    [403, { message: 'You have exceeded a secondary rate limit.' }],
    [403, { message: 'You have triggered an abuse detection mechanism.' }],
    [429, null],
    [429, { message: 'whatever' }],
  ])('%i %j is a rate limit', (status, body) => {
    expect(classifyUploadStatus(status, body)).toBe('rateLimited')
  })

  it.each([
    [403, null],
    [403, '<html>Forbidden</html>'],
    [403, { message: 'Something odd' }],
    [500, { message: 'Server Error' }],
    [422, {}],
  ])('%i %j proves nothing about the token', (status, body) => {
    expect(classifyUploadStatus(status, body)).toBe('other')
  })

  it('reads a plain-text body as the message', () => {
    expect(classifyUploadStatus(403, 'API rate limit exceeded')).toBe('rateLimited')
  })
})
