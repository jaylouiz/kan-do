/**
 * @module copy-editor/guard
 * @description Request checks for the dev-only copy editor routes (#59). The routes run git and the local agent CLI
 * on the designer's machine, so besides being registered only in `nuxt dev` they refuse anything that is not a
 * same-machine, same-origin JSON call: a foreign page cannot reach them (custom header forces a CORS preflight,
 * `Host`/`Origin` must be loopback, which also stops DNS rebinding).
 * @responsibility Header validation. No I/O.
 */

export const COPY_EDITOR_HEADER = 'x-kando-copy-editor'

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

type Headers = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/** An error message, or null when the request may proceed. */
export function checkRequestHeaders(headers: Headers): string | null {
  const host = one(headers.host)
  if (!host || !LOOPBACK.test(host)) return 'copy editor routes answer only on localhost'
  const origin = one(headers.origin)
  if (origin !== undefined) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return 'invalid Origin'
    }
    if (!LOOPBACK.test(originHost)) return 'cross-origin request refused'
  }
  if (one(headers[COPY_EDITOR_HEADER]) !== '1') return `missing ${COPY_EDITOR_HEADER} header`
  if (!(one(headers['content-type']) ?? '').toLowerCase().startsWith('application/json')) return 'JSON body required'
  return null
}
