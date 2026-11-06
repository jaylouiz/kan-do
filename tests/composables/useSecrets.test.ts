import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SecretError, toSecretError, useSecrets } from '~/composables/useSecrets'
import { useKeychainStatus } from '~/composables/useKeychainStatus'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

function setDesktop(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

describe('useSecrets', () => {
  beforeEach(() => { invokeMock.mockReset(); setDesktop(true) })
  afterEach(() => setDesktop(false))

  it('is unavailable on web and every call rejects with "unsupported" without invoking', async () => {
    setDesktop(false)
    const secrets = useSecrets()
    expect(secrets.available).toBe(false)
    await expect(secrets.get('notion-token')).rejects.toMatchObject({ kind: 'unsupported' })
    await expect(secrets.set('github-updates', 'x')).rejects.toBeInstanceOf(SecretError)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('wraps the secret commands', async () => {
    const secrets = useSecrets()
    expect(secrets.available).toBe(true)

    invokeMock.mockResolvedValueOnce('ntn_abc')
    await expect(secrets.get('notion-token')).resolves.toBe('ntn_abc')
    expect(invokeMock).toHaveBeenLastCalledWith('secret_get', { entry: 'notion-token' })

    invokeMock.mockResolvedValueOnce(null)
    await expect(secrets.get('todoist-token')).resolves.toBeNull()

    invokeMock.mockResolvedValueOnce(undefined)
    await secrets.set('github-feedback', 'ghp_x')
    expect(invokeMock).toHaveBeenLastCalledWith('secret_set', { entry: 'github-feedback', value: 'ghp_x' })

    invokeMock.mockResolvedValueOnce(undefined)
    await secrets.remove('github-feedback')
    expect(invokeMock).toHaveBeenLastCalledWith('secret_delete', { entry: 'github-feedback' })
  })

  describe('clears the unavailable flag of a readable entry after a successful Keychain call (#245 L3)', () => {
    beforeEach(() => useKeychainStatus().setUnavailable(['notion-token', 'todoist-token']))
    afterEach(() => useKeychainStatus().clearUnavailable())

    it('set clears only the entry it wrote', async () => {
      invokeMock.mockResolvedValueOnce(undefined)
      await useSecrets().set('notion-token', 'ntn_new')
      expect(useKeychainStatus().unavailable.value).toEqual(['todoist-token'])
    })

    it('remove clears only the entry it deleted, so a Notion reset routes to /welcome again', async () => {
      invokeMock.mockResolvedValueOnce(undefined)
      await useSecrets().remove('notion-token')
      expect(useKeychainStatus().unavailable.value).toEqual(['todoist-token'])
    })

    it('a failed call keeps the flag', async () => {
      invokeMock.mockRejectedValueOnce({ kind: 'keychain' })
      await expect(useSecrets().set('notion-token', 'x')).rejects.toBeInstanceOf(SecretError)
      expect(useKeychainStatus().unavailable.value).toEqual(['notion-token', 'todoist-token'])
    })

    it('a GitHub entry leaves the flags alone', async () => {
      invokeMock.mockResolvedValueOnce(undefined)
      await useSecrets().set('github-updates', 'ghp_x')
      expect(useKeychainStatus().unavailable.value).toEqual(['notion-token', 'todoist-token'])
    })
  })

  it('asks for the GitHub entries by default and passes named entries through', async () => {
    const secrets = useSecrets()
    invokeMock.mockResolvedValue({})
    await secrets.status()
    expect(invokeMock).toHaveBeenLastCalledWith('secret_status', { entries: ['github-updates', 'github-feedback'] })
    await secrets.status(['notion-token'])
    expect(invokeMock).toHaveBeenLastCalledWith('secret_status', { entries: ['notion-token'] })
  })

  it('forwards github_request with entry, method, path and body', async () => {
    const secrets = useSecrets()
    invokeMock.mockResolvedValueOnce({ status: 200, body: [] })
    const response = await secrets.githubRequest('github-updates', 'GET', '/repos/jaylouiz/kan-do/releases?per_page=1')
    expect(response).toEqual({ status: 200, body: [] })
    expect(invokeMock).toHaveBeenLastCalledWith('github_request', {
      entry: 'github-updates', method: 'GET', path: '/repos/jaylouiz/kan-do/releases?per_page=1', body: undefined,
    })
  })

  it('exposes no way to read a GitHub token', () => {
    const secrets = useSecrets() as unknown as Record<string, unknown>
    // `get` is typed for the readable entries only; the GitHub entries have no read path in JS.
    expect(Object.keys(secrets).sort()).toEqual(['available', 'get', 'githubRequest', 'remove', 'set', 'status'])
  })

  it('turns Rust errors into SecretError and defaults unknown shapes to "keychain"', async () => {
    const secrets = useSecrets()
    invokeMock.mockRejectedValueOnce({ kind: 'rejected' })
    await expect(secrets.githubRequest('github-updates', 'GET', '/x')).rejects.toMatchObject({ kind: 'rejected' })
    invokeMock.mockRejectedValueOnce('boom')
    await expect(secrets.get('notion-token')).rejects.toMatchObject({ kind: 'keychain' })
    expect(toSecretError(new SecretError('network')).kind).toBe('network')
  })

  it('never puts the value into the error message', async () => {
    const secrets = useSecrets()
    invokeMock.mockRejectedValueOnce({ kind: 'keychain' })
    const error = await secrets.set('github-updates', 'ghp_supersecret').catch((e: SecretError) => e)
    expect((error as SecretError).message).not.toContain('supersecret')
  })
})
