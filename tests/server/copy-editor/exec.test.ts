// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { run } from '~/server/copy-editor/exec'

describe('copy editor exec', () => {
  it('decodes a multi-chunk UTF-8 payload once, so multibyte characters split across chunks survive', async () => {
    // 'ü' is two bytes; a write boundary between them splits it across two stdout chunks.
    const script = `const b = Buffer.from('ü'.repeat(40000), 'utf8'); process.stdout.write(b.subarray(0, 32769)); setTimeout(() => process.stdout.write(b.subarray(32769)), 80)`
    const result = await run(process.execPath, ['-e', script], { timeoutMs: 10_000 })
    expect(result.stdout).toBe('ü'.repeat(40000))
  })

  it('settles on timeout even when a grandchild keeps the pipes open', async () => {
    const started = Date.now()
    const result = await run('sh', ['-c', 'sleep 5 & wait'], { timeoutMs: 300 })
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
