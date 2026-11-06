import { describe, it, expect } from 'vitest'
import { getErrorMessageKey, isNetworkError, LocalizedError } from '~/lib/errorMessages'
import { setTestLocale } from '../helpers/i18n'
import { TodoistTimeoutError } from '~/integrations/TodoistIntegration'

describe('isNetworkError', () => {
  it('recognises the Todoist request timeout (#159)', () => {
    expect(isNetworkError(new TodoistTimeoutError(10000))).toBe(true)
  })

  it('recognises the Todoist request timeout after the SDK rewrapped it (message only)', () => {
    expect(isNetworkError(new Error(new TodoistTimeoutError(10000).message))).toBe(true)
  })

  it('does not treat an ordinary HTTP error as a network error', () => {
    expect(isNetworkError(new Error('HTTP 500: Internal Server Error'))).toBe(false)
  })
})

describe('getErrorMessageKey task_create', () => {
  it.each(['Notion API error 502', 'Task not found', 'HTTP 500', 'whatever'])('maps "%s" to the create message', (msg) => {
    expect(getErrorMessageKey(msg, 'task_create')).toBe('errors.taskCreateFailed')
  })
})

describe('getErrorMessageKey task_create keeps actionable setup errors', () => {
  it.each([
    ['Notion is not configured', 'errors.notionNotConfigured'],
    ['Notion data source is not configured', 'errors.notionNotConfigured'],
    ['Notion is not set up', 'errors.notionNotConfigured'],
    ['Todoist token missing', 'errors.todoistTokenMissing'],
  ])('maps "%s" to its specific message', (msg, key) => {
    expect(getErrorMessageKey(msg, 'task_create')).toBe(key)
  })
})

describe('getErrorMessageKey secrets_reset / external_link (#245)', () => {
  it('maps the contexts to their own messages whatever the raw error says', () => {
    expect(getErrorMessageKey('secret store: keychain', 'secrets_reset')).toBe('errors.secretsResetFailed')
    expect(getErrorMessageKey('Not allowed', 'external_link')).toBe('errors.externalLinkFailed')
  })
})

describe('getErrorMessageKey routes a LocalizedError by its key (#487)', () => {
  it.each(['de', 'en'] as const)('maps notionNotConfiguredShort to notionNotConfigured in %s, in task_create and the general branch', (locale) => {
    setTestLocale(locale)
    const error = new LocalizedError('errors.notionNotConfiguredShort')
    expect(getErrorMessageKey(error, 'task_create')).toBe('errors.notionNotConfigured')
    expect(getErrorMessageKey(error, 'task_operation')).toBe('errors.notionNotConfigured')
    expect(getErrorMessageKey(error)).toBe('errors.notionNotConfigured')
  })

  it('does not depend on the wording: a reworded message for the key still maps the same', () => {
    const error = new LocalizedError('errors.notionNotConfiguredShort')
    Object.defineProperty(error, 'message', { value: 'Verbindung zu Notion fehlt noch' })
    expect(getErrorMessageKey(error, 'task_create')).toBe('errors.notionNotConfigured')
    expect(getErrorMessageKey(error, 'task_operation')).toBe('errors.notionNotConfigured')
  })

  it('does not map by text: a LocalizedError with another key whose text mentions the pattern stays unmapped', () => {
    const error = new LocalizedError('errors.selectDatabase')
    Object.defineProperty(error, 'message', { value: 'Notion is not configured' })
    expect(getErrorMessageKey(error, 'task_create')).toBe('errors.taskCreateFailed')
    expect(getErrorMessageKey(error, 'task_operation')).toBe('errors.default')
  })

  it('keeps the plain-text mapping for non-localized errors', () => {
    expect(getErrorMessageKey('Notion is not configured', 'task_operation')).toBe('errors.notionNotConfigured')
    expect(getErrorMessageKey('Notion is not set up')).toBe('errors.notionNotConfigured')
    expect(getErrorMessageKey('Notion data source is not configured', 'task_create')).toBe('errors.notionNotConfigured')
  })
})
