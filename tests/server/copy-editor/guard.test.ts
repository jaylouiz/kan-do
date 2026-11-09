// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkRequestHeaders } from '~/server/copy-editor/guard'

const ok = { host: 'localhost:3102', origin: 'http://localhost:3102', 'x-kando-copy-editor': '1', 'content-type': 'application/json' }

describe('copy editor request guard', () => {
  it('accepts a same-machine JSON call with the marker header', () => {
    expect(checkRequestHeaders(ok)).toBeNull()
    expect(checkRequestHeaders({ ...ok, host: '127.0.0.1:3102', origin: undefined })).toBeNull()
    expect(checkRequestHeaders({ ...ok, 'content-type': 'application/json; charset=utf-8' })).toBeNull()
  })

  it.each([
    ['a non-loopback host (DNS rebinding)', { host: 'evil.example:3102' }],
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['an unparsable origin', { origin: 'null' }],
    ['a missing marker header', { 'x-kando-copy-editor': undefined }],
    ['a form content type', { 'content-type': 'text/plain' }],
    ['a missing host', { host: undefined }],
  ])('refuses %s', (_label, override) => {
    expect(checkRequestHeaders({ ...ok, ...override })).not.toBeNull()
  })
})
