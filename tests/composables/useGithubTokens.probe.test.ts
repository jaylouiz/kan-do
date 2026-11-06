import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SecretError } from '~/composables/useSecrets'
import { useGithubTokens, resetGithubTokensState } from '~/composables/useGithubTokens'
import { resetFeedbackState, useFeedback } from '~/composables/useFeedback'

/** #247: "Screenshot-Upload prüfen" writes an empty, unreferenced blob and reads the answer. */

const secretsMock = { available: true, status: vi.fn(), set: vi.fn(), remove: vi.fn(), githubRequest: vi.fn(), get: vi.fn() }
vi.mock('~/composables/useSecrets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/composables/useSecrets')>()),
  useSecrets: () => secretsMock,
}))
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: vi.fn() }) }))

describe('useGithubTokens.probeUpload', () => {
  beforeEach(() => {
    resetGithubTokensState()
    resetFeedbackState()
    vi.clearAllMocks()
  })

  it('posts an empty utf-8 blob for the feedback token and calls it allowed on 2xx', async () => {
    secretsMock.githubRequest.mockResolvedValue({ status: 201, body: { sha: 'e69de29' } })
    const tokens = useGithubTokens()
    await tokens.probeUpload('github-feedback')
    expect(secretsMock.githubRequest).toHaveBeenCalledWith('github-feedback', 'POST', '/repos/jaylouiz/kan-do/git/blobs', { content: '', encoding: 'utf-8' })
    expect(tokens.rows['github-feedback'].upload).toBe('allowed')
  })

  it.each([
    [403, 'Resource not accessible by personal access token'],
    [404, 'Not Found'],
  ])('answers denied on %i', async (status, message) => {
    secretsMock.githubRequest.mockResolvedValue({ status, body: { message } })
    const tokens = useGithubTokens()
    await tokens.probeUpload('github-feedback')
    expect(tokens.rows['github-feedback'].upload).toBe('denied')
  })

  it.each([
    'API rate limit exceeded for user ID 1.',
    'You have exceeded a secondary rate limit.',
  ])('a rate-limited 403 ("%s") is not "denied": the token is not judged', async (message) => {
    const feedback = useFeedback()
    secretsMock.githubRequest.mockResolvedValue({ status: 403, body: { message } })
    const tokens = useGithubTokens()
    await tokens.probeUpload('github-feedback')
    expect(tokens.rows['github-feedback'].upload).toBe('failed')
    expect(feedback.uploadDenied.value).toBe(false)
  })

  it('answers offline without a connection and failed for anything else', async () => {
    const tokens = useGithubTokens()
    secretsMock.githubRequest.mockRejectedValue(new SecretError('network'))
    await tokens.probeUpload('github-feedback')
    expect(tokens.rows['github-feedback'].upload).toBe('offline')
    secretsMock.githubRequest.mockResolvedValue({ status: 500, body: null })
    await tokens.probeUpload('github-feedback')
    expect(tokens.rows['github-feedback'].upload).toBe('failed')
  })

  it('never probes the updates token (it has no write rights to ask for)', async () => {
    const tokens = useGithubTokens()
    await tokens.probeUpload('github-updates')
    expect(secretsMock.githubRequest).not.toHaveBeenCalled()
    expect(tokens.rows['github-updates'].upload).toBe('idle')
  })

  it('a successful probe clears an earlier "upload denied" of the feedback dialog', async () => {
    const feedback = useFeedback()
    expect(feedback.uploadDenied.value).toBe(false)
    secretsMock.githubRequest.mockResolvedValue({ status: 201, body: {} })
    await useGithubTokens().probeUpload('github-feedback')
    expect(feedback.uploadDenied.value).toBe(false)
  })

  it('keeps the result in memory only', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    secretsMock.githubRequest.mockResolvedValue({ status: 201, body: {} })
    await useGithubTokens().probeUpload('github-feedback')
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
  })
})
