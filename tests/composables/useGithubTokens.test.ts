import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { SecretError } from '~/composables/useSecrets'
import { useGithubTokens, resetGithubTokensState, showRow, REMOVE_UNDO_WINDOW_MS } from '~/composables/useGithubTokens'
import { toastAddMock, toastRemoveMock } from '../mocks/nuxt-imports'

const secretsMock = {
  available: true,
  status: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  githubRequest: vi.fn(),
  get: vi.fn(),
}
vi.mock('~/composables/useSecrets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/composables/useSecrets')>()),
  useSecrets: () => secretsMock,
}))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))

const missing = { state: 'ok', present: false, last4: null, rejected: false }
const stored = (last4 = 'a1b2', rejected = false) => ({ state: 'ok', present: true, last4, rejected })

function lastToast() {
  return toastAddMock.mock.calls.at(-1)![0] as {
    id: string
    'onUpdate:open': (open: boolean) => void
    actions: Array<{ onClick: () => void; closeOnClick: boolean }>
  }
}

describe('useGithubTokens', () => {
  beforeEach(() => {
    resetGithubTokensState()
    vi.clearAllMocks()
    secretsMock.available = true
    secretsMock.status.mockResolvedValue({ 'github-updates': missing, 'github-feedback': missing })
    secretsMock.set.mockResolvedValue(undefined)
    secretsMock.remove.mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('loads status lazily for both entries', async () => {
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2'), 'github-feedback': missing })
    const tokens = useGithubTokens()
    await tokens.load()
    expect(secretsMock.status).toHaveBeenCalledWith(['github-updates', 'github-feedback'])
    expect(tokens.rows['github-updates']).toMatchObject({ present: true, last4: 'a1b2', rejected: false })
    expect(tokens.rows['github-feedback'].present).toBe(false)
    expect(tokens.keychainUnavailable.value).toBe(false)
  })

  it('reports an unreadable Keychain instead of "missing"', async () => {
    secretsMock.status.mockResolvedValue({
      'github-updates': { state: 'error', kind: 'keychain' }, 'github-feedback': missing,
    })
    const tokens = useGithubTokens()
    await tokens.load()
    expect(tokens.keychainUnavailable.value).toBe(true)
  })

  it('is unavailable without the desktop shell', async () => {
    secretsMock.available = false
    const tokens = useGithubTokens()
    await tokens.load()
    expect(tokens.keychainUnavailable.value).toBe(true)
    expect(secretsMock.status).not.toHaveBeenCalled()
  })

  it('save checks the updates token against releases, stores it and marks it valid', async () => {
    secretsMock.githubRequest.mockResolvedValue({ status: 200, body: [] })
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('wxyz') })
    const tokens = useGithubTokens()
    const ok = await tokens.save('github-updates', '  ghp_abcdwxyz  ')

    expect(ok).toBe(true)
    expect(secretsMock.set).toHaveBeenCalledWith('github-updates', 'ghp_abcdwxyz')
    expect(secretsMock.githubRequest).toHaveBeenCalledWith(
      'github-updates', 'GET', '/repos/jaylouiz/kan-do/releases?per_page=1', undefined, 'ghp_abcdwxyz',
    )
    expect(tokens.rows['github-updates']).toMatchObject({ present: true, last4: 'wxyz', valid: true, problem: null, checking: false })
  })

  it('save checks the feedback token against issues', async () => {
    secretsMock.githubRequest.mockResolvedValue({ status: 200, body: [] })
    secretsMock.status.mockResolvedValue({ 'github-feedback': stored('1234') })
    await useGithubTokens().save('github-feedback', 'ghp_x1234')
    expect(secretsMock.githubRequest).toHaveBeenCalledWith(
      'github-feedback', 'GET', '/repos/jaylouiz/kan-do/issues?per_page=1', undefined, 'ghp_x1234',
    )
  })

  it.each([
    ['a 401', () => Promise.reject(new SecretError('rejected')), 'rejected'],
    ['a 403', () => Promise.resolve({ status: 403, body: {} }), 'forbidden'],
    ['a 403 rate limit', () => Promise.resolve({ status: 403, body: { message: 'API rate limit exceeded' } }), 'unverified'],
    ['a 404', () => Promise.resolve({ status: 404, body: {} }), 'notFound'],
    ['a 301', () => Promise.resolve({ status: 301, body: {} }), 'unverified'],
    ['a 503', () => Promise.resolve({ status: 503, body: {} }), 'unverified'],
    ['a connection error', () => Promise.reject(new SecretError('network')), 'offline'],
    ['a timeout', () => Promise.reject(new SecretError('timeout')), 'offline'],
  ] as const)('stores nothing and touches nothing stored when the check ends in %s', async (_label, respond, problem) => {
    secretsMock.githubRequest.mockImplementation(respond)
    const tokens = useGithubTokens()
    const ok = await tokens.save('github-updates', 'ghp_bad')

    expect(ok).toBe(false)
    expect(secretsMock.set).not.toHaveBeenCalled()
    expect(secretsMock.remove).not.toHaveBeenCalled()
    expect(tokens.rows['github-updates']).toMatchObject({ present: false, problem, valid: false, checking: false })
  })

  it('a failed check of a replacement keeps the stored token (#223 L1)', async () => {
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2') })
    const tokens = useGithubTokens()
    await tokens.load()
    secretsMock.githubRequest.mockResolvedValue({ status: 503, body: {} })

    expect(await tokens.save('github-updates', 'ghp_replacement')).toBe(false)
    expect(secretsMock.set).not.toHaveBeenCalled()
    expect(secretsMock.remove).not.toHaveBeenCalled()
    expect(tokens.rows['github-updates']).toMatchObject({ present: true, last4: 'a1b2', problem: 'unverified' })
  })

  it('test never deletes the stored token, whatever the answer (#223 M1)', async () => {
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2') })
    const tokens = useGithubTokens()
    await tokens.load()
    const expected = { 403: 'forbidden', 404: 'notFound', 301: 'unverified', 500: 'unverified', 502: 'unverified' }
    for (const [status, problem] of Object.entries(expected)) {
      secretsMock.githubRequest.mockResolvedValueOnce({ status: Number(status), body: {} })
      await tokens.test('github-updates')
      expect(tokens.rows['github-updates']).toMatchObject({ present: true, rejected: false, valid: false, problem })
    }
    secretsMock.githubRequest.mockRejectedValueOnce(new SecretError('network'))
    await tokens.test('github-updates')
    expect(tokens.rows['github-updates']).toMatchObject({ present: true, problem: 'offline' })
    expect(secretsMock.remove).not.toHaveBeenCalled()
    expect(secretsMock.set).not.toHaveBeenCalled()
  })

  describe('the feedback row (#280)', () => {
    const viaGh = { state: 'ok', present: true, last4: 'gh01', rejected: false, source: 'gh_cli' }

    it('is shown only for a token that is stored in the Keychain; the updates row always is', async () => {
      secretsMock.status.mockResolvedValue({ 'github-updates': missing, 'github-feedback': missing })
      await useGithubTokens().load()
      expect(showRow('github-updates')).toBe(true)
      expect(showRow('github-feedback')).toBe(false)

      secretsMock.status.mockResolvedValue({ 'github-updates': missing, 'github-feedback': { ...stored('c3d4'), source: 'keychain' } })
      await useGithubTokens().load()
      expect(showRow('github-feedback')).toBe(true)

      secretsMock.status.mockResolvedValue({ 'github-updates': missing, 'github-feedback': viaGh })
      await useGithubTokens().load()
      expect(showRow('github-feedback')).toBe(false)
    })

    it('stays mounted while a removal waits for its undo (the row hides itself) and goes when it is committed', async () => {
      secretsMock.status.mockResolvedValue({ 'github-updates': missing, 'github-feedback': { ...stored('c3d4'), source: 'keychain' } })
      const tokens = useGithubTokens()
      await tokens.load()
      tokens.remove('github-feedback')
      expect(showRow('github-feedback')).toBe(true)
      expect(tokens.rows['github-feedback'].removed).toBe(true)
      lastToast().actions[0]!.onClick()
      expect(tokens.rows['github-feedback'].removed).toBe(false)
      tokens.remove('github-feedback')
      lastToast()['onUpdate:open'](false)
      await flushPromises()
      expect(showRow('github-feedback')).toBe(false)
    })

    it('is never checked on a page visit when its token is the GitHub CLI\'s', async () => {
      secretsMock.status.mockResolvedValue({ 'github-updates': missing, 'github-feedback': viaGh })
      const tokens = useGithubTokens()
      await tokens.load()
      await tokens.checkOnOpen()
      expect(secretsMock.githubRequest).not.toHaveBeenCalled()
    })
  })

  describe('checkOnOpen (#241)', () => {
    const bothStored = { 'github-updates': stored('a1b2'), 'github-feedback': stored('c3d4') }

    async function open() {
      secretsMock.status.mockResolvedValue(bothStored)
      const tokens = useGithubTokens()
      await tokens.load()
      return tokens
    }

    it('checks every saved row once, in parallel, and marks a 200 valid', async () => {
      const tokens = await open()
      secretsMock.githubRequest.mockResolvedValue({ status: 200, body: [] })
      await tokens.checkOnOpen()
      expect(secretsMock.githubRequest).toHaveBeenCalledTimes(2)
      expect(tokens.rows['github-updates']).toMatchObject({ valid: true, problem: null, checking: false })
      expect(tokens.rows['github-feedback'].valid).toBe(true)
    })

    it('skips empty, rejected and removed rows and rows already checking', async () => {
      secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2', true), 'github-feedback': missing })
      const tokens = useGithubTokens()
      await tokens.load()
      await tokens.checkOnOpen()
      expect(secretsMock.githubRequest).not.toHaveBeenCalled()

      const open2 = await open()
      open2.rows['github-updates'].checking = true
      open2.remove('github-feedback')
      await open2.checkOnOpen()
      expect(secretsMock.githubRequest).not.toHaveBeenCalled()
    })

    it('offline never rejects the token: it falls back to "Gespeichert" with the calm line', async () => {
      const tokens = await open()
      secretsMock.githubRequest.mockRejectedValue(new SecretError('network'))
      await tokens.checkOnOpen()
      for (const entry of ['github-updates', 'github-feedback'] as const) {
        expect(tokens.rows[entry]).toMatchObject({ present: true, rejected: false, valid: false, problem: 'offline', checking: false })
      }
      secretsMock.githubRequest.mockRejectedValue(new SecretError('timeout'))
      await tokens.checkOnOpen()
      expect(tokens.rows['github-updates']).toMatchObject({ rejected: false, problem: 'offline' })
    })

    it('a 401 leads to the rejected state through the Rust flag', async () => {
      const tokens = await open()
      secretsMock.githubRequest.mockRejectedValue(new SecretError('rejected'))
      secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2', true), 'github-feedback': stored('c3d4', true) })
      await tokens.checkOnOpen()
      expect(tokens.rows['github-updates']).toMatchObject({ rejected: true, valid: false })
    })

    it.each([[403, 'forbidden'], [404, 'notFound'], [503, 'unverified']] as const)('a %s is named inline, not rejected', async (status, problem) => {
      const tokens = await open()
      secretsMock.githubRequest.mockResolvedValue({ status, body: {} })
      await tokens.checkOnOpen()
      expect(tokens.rows['github-updates']).toMatchObject({ rejected: false, valid: false, problem })
      expect(secretsMock.remove).not.toHaveBeenCalled()
    })
  })

  it('stores nothing when the Keychain refuses the write, via useErrorHandler', async () => {
    secretsMock.githubRequest.mockResolvedValue({ status: 200, body: [] })
    secretsMock.set.mockRejectedValue(new SecretError('keychain'))
    const tokens = useGithubTokens()
    expect(await tokens.save('github-updates', 'ghp_x')).toBe(false)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.any(SecretError), 'secrets')
    expect(tokens.rows['github-updates'].problem).toBe('failed')
  })

  it('test re-runs the check; a 401 shows as rejected through the status flag', async () => {
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2') })
    const tokens = useGithubTokens()
    await tokens.load()

    secretsMock.githubRequest.mockRejectedValueOnce(new SecretError('rejected'))
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2', true) })
    await tokens.test('github-updates')
    expect(tokens.rows['github-updates']).toMatchObject({ rejected: true, valid: false, problem: null })

    // Saving a new token clears the rejected state.
    secretsMock.githubRequest.mockResolvedValue({ status: 200, body: [] })
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('9999') })
    await tokens.save('github-updates', 'ghp_new9999')
    expect(tokens.rows['github-updates']).toMatchObject({ rejected: false, valid: true, last4: '9999' })
  })

  it('test keeps a failed check inline when the token is not flagged rejected', async () => {
    secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2') })
    const tokens = useGithubTokens()
    await tokens.load()
    secretsMock.githubRequest.mockRejectedValueOnce(new SecretError('network'))
    await tokens.test('github-updates')
    expect(tokens.rows['github-updates']).toMatchObject({ present: true, problem: 'offline', valid: false })
  })

  describe('remove', () => {
    async function loaded() {
      secretsMock.status.mockResolvedValue({ 'github-updates': stored('a1b2'), 'github-feedback': missing })
      const tokens = useGithubTokens()
      await tokens.load()
      return tokens
    }

    it('acts at once, deletes from the Keychain only after the toast closed', async () => {
      const tokens = await loaded()
      tokens.remove('github-updates')

      expect(tokens.rows['github-updates'].removed).toBe(true)
      expect(secretsMock.remove).not.toHaveBeenCalled()
      const toast = lastToast()
      expect(toast.actions[0]!.closeOnClick).toBe(false)

      toast['onUpdate:open'](false)
      await flushPromises()
      expect(secretsMock.remove).toHaveBeenCalledWith('github-updates')
      expect(tokens.rows['github-updates']).toMatchObject({ present: false, last4: null, removed: false })
    })

    it('Undo cancels the delete and restores the saved state', async () => {
      const tokens = await loaded()
      const onUndo = vi.fn()
      tokens.remove('github-updates', onUndo)
      const toast = lastToast()

      toast.actions[0]!.onClick()
      toast['onUpdate:open'](false)
      await flushPromises()

      expect(secretsMock.remove).not.toHaveBeenCalled()
      expect(onUndo).toHaveBeenCalledOnce()
      expect(toastRemoveMock).toHaveBeenCalledWith(toast.id)
      expect(tokens.rows['github-updates']).toMatchObject({ present: true, last4: 'a1b2', removed: false })
    })

    it('uses the ~5 s undo window and a new token supersedes a pending removal', async () => {
      const tokens = await loaded()
      tokens.remove('github-updates')
      expect((toastAddMock.mock.calls.at(-1)![0] as { duration: number }).duration).toBe(REMOVE_UNDO_WINDOW_MS)

      secretsMock.githubRequest.mockResolvedValue({ status: 200, body: [] })
      secretsMock.status.mockResolvedValue({ 'github-updates': stored('7777') })
      await tokens.save('github-updates', 'ghp_new7777')
      lastToast()['onUpdate:open'](false)
      await flushPromises()

      expect(secretsMock.remove).not.toHaveBeenCalled()
      expect(tokens.rows['github-updates']).toMatchObject({ present: true, last4: '7777', removed: false })
    })

    it('a failed Keychain delete brings the row back and reports through useErrorHandler', async () => {
      const tokens = await loaded()
      secretsMock.remove.mockRejectedValue(new SecretError('keychain'))
      tokens.remove('github-updates')
      lastToast()['onUpdate:open'](false)
      await flushPromises()
      expect(tokens.rows['github-updates']).toMatchObject({ present: true, removed: false })
      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(SecretError), 'secrets')
    })
  })
})
