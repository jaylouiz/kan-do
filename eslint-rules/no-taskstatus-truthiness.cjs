/**
 * @fileoverview Forbid truthiness checks on a status value (#435, #441).
 *
 * `TaskStatus` is a numeric enum and `TaskStatus.Open` is 0, so `if (status)`, `status && x`,
 * `status ? a : b`, `status || x`, `!status` and `Boolean(status)` all treat Offen as "no status" (#434 F1).
 * Compare explicitly: `status !== undefined`, `status === TaskStatus.Open`.
 *
 * Untyped on purpose: a type-aware version (`parserOptions.projectService`) was measured at roughly +80% lint
 * runtime on this repo (Nuxt's type program), the issue budget is +20%. The rule therefore matches by NAME: an
 * operand that is an identifier or a property access ending in `status` (`status`, `oldStatus`, `task.status`,
 * `a?.status`), and only in a file that mentions `TaskStatus` (keeps HTTP status codes, Notion mapping fields and
 * similar out of scope).
 *
 * Covered: the conditions above; `status ||= x` / `status &&= x` (`??=` stays legal); predicate callbacks that
 * return a status (`tasks.filter(t => t.status)`, also `.some/.every/.find/.findIndex/.findLast/.findLastIndex`,
 * expression or `return` body, in scripts and in Vue templates alike); `.filter(Boolean)` (and the other predicate methods) on a recognisable status list
 * (receiver named `...statuses`, or `list.map(t => t.status)`); Vue template conditions (`v-if`, `v-else-if`,
 * `v-show`, ternaries, `||`/`&&`, `!`, `Boolean()`); `satisfies` / `as` / `<T>` / `!` wrappers; both operands of a
 * tested `??` and the branches of a tested ternary.
 *
 * Not caught (a name-based, untyped rule cannot see them): a TaskStatus held under another name (`statusMap[x]`,
 * `from`, destructured aliases); `.filter(Boolean)` and similar on a receiver that is not recognisably a status
 * list; a file that never names the enum; template object/array class bindings (`:class="{ on: status }"`) and
 * `v-for` / `v-model` expressions; `switch (status)` and any other non-boolean use of a status. In a flagged file,
 * a non-TaskStatus value named `...status` is a false positive: compare it explicitly or disable the rule on that
 * line with a reason.
 */
'use strict'

const STATUS_NAME = /status$/i
// `hasArchiveStatus`, `isStatus...`: a boolean about a status, not a status value.
const BOOLEAN_PREFIX = /^(has|is|can|should|was|did)[A-Z]/

const PREDICATE_METHODS = new Set(['filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex'])
const STATUS_LIST_NAME = /statuses$/i
const TEMPLATE_CONDITION_DIRECTIVES = new Set(['if', 'else-if', 'show'])

/** Name of the value an operand reads: `status`, `task.status`, `task?.status!` -> `status`; otherwise null. */
function operandName(node) {
  switch (node.type) {
    case 'Identifier':
      return node.name
    case 'MemberExpression':
      return !node.computed && node.property.type === 'Identifier' ? node.property.name : null
    case 'ChainExpression':
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
      return operandName(node.expression)
    default:
      return null
  }
}

module.exports = {
  meta: {
    type: 'problem',
    schema: [],
    docs: { description: 'Forbid truthiness checks on a status value (TaskStatus.Open is 0)' },
    messages: {
      truthiness:
        'TaskStatus is a numeric enum and TaskStatus.Open is 0: a truthiness check on a status skips Offen. Compare explicitly (`!== undefined`, `=== TaskStatus.X`) (#435).'
    }
  },
  create(context) {
    if (!context.sourceCode.text.includes('TaskStatus')) return {}
    const reported = new WeakSet()

    /** Report `node` when it is used as a condition and reads a status-named value. */
    function check(node) {
      if (node.type === 'LogicalExpression') {
        // `a || b` / `a && b` test both sides when the whole is tested; `a ?? b` yields one of them.
        check(node.left)
        check(node.right)
        return
      }
      if (node.type === 'ConditionalExpression') {
        check(node.consequent)
        check(node.alternate)
        return
      }
      if (isStatusName(node) && !reported.has(node)) {
        reported.add(node)
        context.report({ node, messageId: 'truthiness' })
      }
    }

    const isFunction = (n) =>
      n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'

    /** Name of the called method (`a.filter(...)` -> `filter`), or null. */
    function methodName(call) {
      const callee = call.callee
      return callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier'
        ? callee.property.name
        : null
    }

    /** Does a `.map(cb)` callback return a status-named value? (`tasks.map(t => t.status)`) */
    function isStatusMap(node) {
      const call = node.type === 'ChainExpression' ? node.expression : node
      if (call.type !== 'CallExpression' || methodName(call) !== 'map') return false
      const cb = call.arguments[0]
      if (!cb || !isFunction(cb)) return false
      if (cb.body.type !== 'BlockStatement') return isStatusName(cb.body)
      return returnsStatus(cb.body)
    }

    function isStatusName(node) {
      const name = operandName(node)
      return name !== null && STATUS_NAME.test(name) && !BOOLEAN_PREFIX.test(name)
    }

    /** Does a block body `return` a status-named value directly (nested functions excluded)? */
    function returnsStatus(node) {
      if (!node || typeof node.type !== 'string') return false
      if (node.type === 'ReturnStatement') return node.argument != null && isStatusName(node.argument)
      if (isFunction(node)) return false
      for (const key of Object.keys(node)) {
        if (key === 'parent') continue
        const child = node[key]
        if (Array.isArray(child) ? child.some(returnsStatus) : child && typeof child.type === 'string' && returnsStatus(child)) {
          return true
        }
      }
      return false
    }

    /** `list.filter(Boolean)` is a status check only when `list` is recognisably a list of statuses. */
    function isStatusList(node) {
      const name = operandName(node)
      return (name !== null && STATUS_LIST_NAME.test(name)) || isStatusMap(node)
    }

    // Predicate callbacks (`tasks.filter(t => t.status)`): the callback's result is truthiness-tested. An expression
    // body is checked directly; a `return` is matched to its nearest enclosing function through `predicateFns`.
    const predicateFns = new WeakSet()
    const functionStack = []

    const expressionHandlers = {
      ConditionalExpression: (n) => check(n.test),
      UnaryExpression: (n) => n.operator === '!' && check(n.argument),
      // `status && x` / `status || x`: the left operand is always truthiness-tested. The right operand is a value,
      // not a test, unless the whole expression is itself in a test position, which `check` above walks into.
      LogicalExpression: (n) => n.operator !== '??' && check(n.left),
      CallExpression: (n) => {
        if (n.callee.type === 'Identifier' && n.callee.name === 'Boolean') {
          if (n.arguments[0]) check(n.arguments[0])
          return
        }
        const method = methodName(n)
        if (method === null || !PREDICATE_METHODS.has(method)) return
        const cb = n.arguments[0]
        if (!cb) return
        if (cb.type === 'Identifier' && cb.name === 'Boolean') {
          if (isStatusList(n.callee.object)) {
            if (!reported.has(cb)) {
              reported.add(cb)
              context.report({ node: cb, messageId: 'truthiness' })
            }
          }
          return
        }
        if (!isFunction(cb)) return
        if (cb.body.type === 'BlockStatement') predicateFns.add(cb)
        else check(cb.body)
      }
    }

    // Shared by the script and the template visitor: a block-bodied predicate callback is matched to its `return`s.
    const predicateHandlers = {
      ':function': (n) => functionStack.push(n),
      ':function:exit': () => functionStack.pop(),
      ReturnStatement: (n) => {
        const fn = functionStack[functionStack.length - 1]
        if (n.argument && fn && predicateFns.has(fn)) check(n.argument)
      }
    }

    const handlers = {
      ...expressionHandlers,
      ...predicateHandlers,
      IfStatement: (n) => check(n.test),
      WhileStatement: (n) => check(n.test),
      DoWhileStatement: (n) => check(n.test),
      ForStatement: (n) => n.test && check(n.test),
      AssignmentExpression: (n) => (n.operator === '||=' || n.operator === '&&=') && check(n.left)
    }

    const ps = context.sourceCode.parserServices
    if (!ps || typeof ps.defineTemplateBodyVisitor !== 'function') return handlers

    // Vue templates: `v-if` / `v-else-if` / `v-show` take a whole condition; the other expression shapes arrive as
    // ordinary ESTree nodes, so the same handlers apply.
    return ps.defineTemplateBodyVisitor(
      {
        ...expressionHandlers,
        ...predicateHandlers,
        VExpressionContainer: (n) => {
          const attr = n.parent
          if (
            attr &&
            attr.type === 'VAttribute' &&
            attr.directive &&
            TEMPLATE_CONDITION_DIRECTIVES.has(attr.key.name.name) &&
            n.expression
          ) {
            check(n.expression)
          }
        }
      },
      handlers
    )
  }
}
