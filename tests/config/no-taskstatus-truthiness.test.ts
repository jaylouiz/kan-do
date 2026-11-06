// @vitest-environment node
/**
 * Rule test for `kan-do/no-taskstatus-truthiness` (#435): a truthiness check on a status value skips
 * `TaskStatus.Open` (0). The `npm run lint` wiring is covered by the last test, which lints a fixture with the
 * real project config.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { RuleTester, ESLint } from 'eslint'
import tsParser from '@typescript-eslint/parser'

const require = createRequire(import.meta.url)
const rule = require('../../eslint-rules/no-taskstatus-truthiness.cjs')

const tester = new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' } })

// The rule only looks at files that name the enum.
const withEnum = (body: string) => `import { TaskStatus } from '~/types/taskStatus'\n${body}`

describe('kan-do/no-taskstatus-truthiness', () => {
  tester.run('no-taskstatus-truthiness', rule, {
    valid: [
      // explicit comparisons
      withEnum('declare const status: TaskStatus | undefined; if (status !== undefined) {}'),
      withEnum('declare const status: TaskStatus; if (status === TaskStatus.Open) {}'),
      withEnum('declare const task: { status?: TaskStatus }; const s = task.status ?? TaskStatus.Open'),
      withEnum('declare const task: { status?: TaskStatus }; const s = task.status === undefined ? 1 : 2'),
      // unrelated numeric, boolean and string checks in a TaskStatus file
      withEnum('declare const count: number; if (count) {}'),
      withEnum('declare const ready: boolean; const x = ready && 1; const y = !ready'),
      withEnum('declare const title: string; const t = title || "Untitled"'),
      withEnum('declare const hasArchiveStatus: boolean; if (hasArchiveStatus) {}'),
      // a status as the right-hand VALUE of && / || is not tested
      withEnum('declare const ok: boolean; declare const status: TaskStatus; const v = ok && status'),
      // file never names the enum: HTTP status codes and the like are out of scope
      'declare const res: { status: number }; if (res.status) {}',
      // `??=` only assigns on null/undefined, so Offen (0) survives
      withEnum('declare const task: { status?: TaskStatus }; task.status ??= TaskStatus.Open'),
      // predicate callbacks that compare explicitly or return something else
      withEnum('declare const tasks: { status: TaskStatus; count: number }[]; tasks.filter(t => t.status === TaskStatus.Open)'),
      withEnum('declare const tasks: { status?: TaskStatus }[]; tasks.filter(t => t.status !== undefined)'),
      withEnum('declare const tasks: { status: TaskStatus }[]; tasks.map(t => t.status)'),
      withEnum('declare const tasks: { count: number }[]; tasks.filter(t => t.count)'),
      // a nested function's return does not leak into the enclosing predicate
      withEnum('declare const items: { status: TaskStatus; ok: boolean }[]; items.filter(i => { const f = () => i.status; return i.ok })'),
      // `.filter(Boolean)` on a receiver that is not recognisably a status list
      withEnum('declare const names: string[]; names.filter(Boolean)'),
      withEnum('declare const parts: { title: string }[]; parts.map(p => p.title).filter(Boolean)'),
      // a status as the value of a `??` or ternary that is not itself tested
      withEnum('declare const status: TaskStatus; declare const c: boolean; const v = c ? status : TaskStatus.Open; const w = status ?? 1'),
      // wrappers around an explicit comparison
      withEnum('declare const status: TaskStatus; if ((status as TaskStatus) === TaskStatus.Open) {}'),
    ],
    invalid: [
      { code: withEnum('declare const status: TaskStatus; if (status) {}'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; if (!status) {}'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; const a = status && 1'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; const a = status ? 1 : 2'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; const a = status || TaskStatus.Open'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; const a = Boolean(status)'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; while (status) {}'), errors: 1 },
      // property access, optional chaining, other names ending in "status"
      { code: withEnum('declare const task: { status?: TaskStatus }; if (task.status) {}'), errors: 1 },
      { code: withEnum('declare const task: { status?: TaskStatus } | null; if (task?.status) {}'), errors: 1 },
      { code: withEnum('declare const oldStatus: TaskStatus | undefined; if (oldStatus) {}'), errors: 1 },
      // the status operand inside a larger condition (the #434 shape)
      { code: withEnum('declare const ok: boolean; declare const oldStatus: TaskStatus; if (ok && oldStatus) {}'), errors: 1 },
      { code: withEnum('declare const ok: boolean; declare const status: TaskStatus; if (!(ok || status)) {}'), errors: 1 },
      // logical assignment
      { code: withEnum('declare let status: TaskStatus; status ||= TaskStatus.Open'), errors: 1 },
      { code: withEnum('declare const task: { status: TaskStatus }; task.status ||= TaskStatus.Open'), errors: 1 },
      { code: withEnum('declare const task: { status: TaskStatus }; task.status &&= TaskStatus.Open'), errors: 1 },
      // predicate callbacks
      ...['filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex'].map(m => ({
        code: withEnum(`declare const tasks: { status: TaskStatus }[]; tasks.${m}(t => t.status)`),
        errors: 1
      })),
      { code: withEnum('declare const tasks: { status: TaskStatus }[]; tasks.filter(t => { return t.status })'), errors: 1 },
      { code: withEnum('declare const tasks: { status: TaskStatus }[]; tasks.filter(function (t) { return t.status })'), errors: 1 },
      { code: withEnum('declare const tasks: { status: TaskStatus }[]; declare const ok: boolean; tasks.filter(t => ok && t.status)'), errors: 1 },
      // `.filter(Boolean)` on a status list
      { code: withEnum('declare const statuses: TaskStatus[]; statuses.filter(Boolean)'), errors: 1 },
      { code: withEnum('declare const task: { statuses: TaskStatus[] }; task.statuses.filter(Boolean)'), errors: 1 },
      { code: withEnum('declare const tasks: { status: TaskStatus }[]; tasks.map(t => t.status).filter(Boolean)'), errors: 1 },
      { code: withEnum('declare const tasks: { status: TaskStatus }[]; tasks.map(t => { return t.status }).some(Boolean)'), errors: 1 },
      // TS wrappers
      { code: withEnum('declare const status: TaskStatus; const a = (status satisfies TaskStatus) ? 1 : 2'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; if (<TaskStatus>status) {}'), errors: 1 },
      { code: withEnum('declare const task: { status: TaskStatus }; if (task.status as TaskStatus) {}'), errors: 1 },
      // operands inside a tested ternary / `??`
      { code: withEnum('declare const status: TaskStatus; declare const cond: boolean; declare const other: number; if (cond ? status : other) {}'), errors: 1 },
      { code: withEnum('declare const status: TaskStatus; declare const a: number | undefined; while (a ?? status) {}'), errors: 1 },
      { code: withEnum('declare const task: { status: TaskStatus }; declare const cond: boolean; const x = Boolean(cond ? task.status : 0)'), errors: 1 },
      // reached through two paths, reported once
      { code: withEnum('declare const tasks: { status: TaskStatus }[]; declare const x: boolean; tasks.filter(t => t.status && x)'), errors: 1 }
    ]
  })

  // Loads the project ESLint config in a fresh instance: ~1.2 s alone, past the 5 s default under parallel-worker load (#520).
  it('fails `npm run lint` (project config) on a truthiness check of a TaskStatus', async () => {
    const eslint = new ESLint()
    const code = withEnum('export function f(status?: TaskStatus) {\n  if (status) return 1\n  return 0\n}\n')
    const [result] = await eslint.lintText(code, { filePath: 'lib/__fixture-taskstatus-truthiness.ts' })
    const ids = result!.messages.map(m => m.ruleId)
    expect(ids).toContain('kan-do/no-taskstatus-truthiness')
  }, 30_000)

  // Template expressions (item 4 of #441) go through the real config so the `.vue` wiring is proven too.
  describe('in .vue templates (project config)', () => {
    const eslint = new ESLint()
    const sfc = (template: string) =>
      `<script setup lang="ts">\nimport { TaskStatus } from '~/types/taskStatus'\ndefineProps<{ status?: TaskStatus; task: { status?: TaskStatus }; isDone: boolean }>()\n</script>\n<template>\n  ${template}\n</template>\n`
    const lint = async (code: string) => {
      const [result] = await eslint.lintText(code, { filePath: 'components/__fixture-taskstatus-truthiness.vue' })
      return result!.messages.filter(m => m.ruleId === 'kan-do/no-taskstatus-truthiness')
    }

    it.each([
      '<div v-if="task.status" />',
      '<div v-if="status" /><div v-else-if="status" />',
      '<div v-show="!status" />',
      '<div :class="status ? \'a\' : \'b\'" />',
      '<div>{{ status || \'none\' }}</div>',
      '<div v-if="(status satisfies TaskStatus)" />',
      // block-bodied predicate callbacks in a template (#455), same as the expression form
      '<div v-if="[task].some(t => t.status)" />',
      '<div v-if="[task].some(t => { return t.status })" />',
      '<div v-if="[task].filter(t => { return t.status }).length" />',
      '<div v-if="[task].find(function (t) { return t.status })" />',
      '<div :class="[task].every(t => { return t.status }) ? \'a\' : \'b\'" />'
    ])('reports %s', async (template) => {
      const count = template.includes('v-else-if') ? 2 : 1
      expect(await lint(sfc(template))).toHaveLength(count)
    })

    it.each([
      '<div v-if="status === TaskStatus.Done" />',
      '<div v-if="status !== undefined" />',
      '<div v-if="isDone" />',
      '<div v-if="[task].some(t => { return t.status === TaskStatus.Open })" />',
      '<div v-if="[task].some(t => { const f = () => t.status; return isDone })" />'
    ])('allows %s', async (template) => {
      expect(await lint(sfc(template))).toHaveLength(0)
    })

    it('ignores a .vue file that never mentions TaskStatus', async () => {
      const code = '<script setup lang="ts">\ndefineProps<{ status?: number }>()\n</script>\n<template>\n  <div v-if="status" />\n</template>\n'
      expect(await lint(code)).toHaveLength(0)
    })

    it('stays in sequence: a clean template, a bad one, then clean again (no state leaks between files)', async () => {
      expect(await lint(sfc('<div v-if="isDone" />'))).toHaveLength(0)
      expect(await lint(sfc('<div v-if="status" />'))).toHaveLength(1)
      expect(await lint(sfc('<div v-if="isDone" />'))).toHaveLength(0)
    })
  })
})
