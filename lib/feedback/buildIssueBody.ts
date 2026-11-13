/**
 * @module feedback/buildIssueBody
 * @description Renders the GitHub issue body of an in-app report (#227). English headings, the
 * user's text verbatim. Items the user removed are absent, never blank. The review step shows this
 * exact string, and the send path posts it unchanged.
 */
import { FEEDBACK_ASSETS_BRANCH, FEEDBACK_RELAY_BRANCH, FEEDBACK_RELAY_REPO, FEEDBACK_REPO, type IssueBodyInput } from '~/lib/feedback/types'

/** A table cell must stay on one line and must not close the cell early. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

function code(value: string): string {
  const safe = value.replace(/\r?\n/g, ' ')
  const longest = Math.max(0, ...(safe.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${safe}${fence}`
}

/** The shortest backtick fence that no line of `text` can close. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

export function contextRows(input: IssueBodyInput, { short = false } = {}): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  if (input.versionInfo) {
    if (input.versionInfo.version) rows.push(['Version', code(input.versionInfo.version)])
    if (input.versionInfo.os) rows.push(['OS', code(input.versionInfo.os)])
  }
  if (input.environment) {
    rows.push(['Route', code(input.environment.route)])
    if (!short) {
      rows.push(['Viewport', `${input.environment.viewport.width}×${input.environment.viewport.height}`])
      rows.push(['Locale', code(input.environment.locale)])
    }
  }
  const el = input.element
  if (el) {
    if (el.chain.length) rows.push(['Component', code(el.chain.join(' › '))])
    if (!short) {
      rows.push(['Selector', code(el.selector)])
      if (el.testId) rows.push(['Test id', code(el.testId)])
      rows.push(['Bounding box', `${el.rect.x}, ${el.rect.y}, ${el.rect.width}×${el.rect.height}`])
    }
    if (el.taskId) rows.push(['Task id', code(el.taskId)])
    if (el.taskId && input.taskTitle) rows.push(['Task title', code(input.taskTitle)])
  }
  return rows
}

export function contextSection(input: IssueBodyInput, options?: { short?: boolean }): string | null {
  const rows = contextRows(input, options)
  if (!rows.length) return null
  return ['## Context', '', '| Item | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)].join('\n')
}

export function logSection(input: IssueBodyInput): string | null {
  if (!input.logTail?.trim()) return null
  const lines = input.logTail.replace(/\s+$/, '').split('\n').length
  const fence = fenceFor(input.logTail)
  return [`<details>`, `<summary>Log (last ${lines} lines)</summary>`, '', `${fence}text`, input.logTail.replace(/\s+$/, ''), fence, '', '</details>'].join('\n')
}

/**
 * One block after the description. Upload: the image (viewable for repo members), the plain path and
 * a one-line `gh api` hint for agents. Clipboard: a single line, the author pastes the image there.
 */
export function screenshotSection(input: IssueBodyInput): string | null {
  const shot = input.screenshot
  if (!shot) return null
  if (shot.delivery === 'clipboard') return 'Screenshot: paste it here (copied to the clipboard).'
  // Relay (#268): the image lives in the private feedback repository, next to the issue.
  const [repo, branch] = shot.delivery === 'relay' ? [FEEDBACK_RELAY_REPO, FEEDBACK_RELAY_BRANCH] : [FEEDBACK_REPO, FEEDBACK_ASSETS_BRANCH]
  return [
    `![Screenshot](https://github.com/${repo}/blob/${branch}/${shot.path}?raw=true)`,
    '',
    `Path: \`${shot.path}\` on \`${branch}\``,
    `Agents: \`gh api repos/${repo}/contents/${shot.path}?ref=${branch}\``,
  ].join('\n')
}

export function footer(input: IssueBodyInput): string {
  const version = input.versionInfo?.version
  return `_Filed from kan-do${version ? ` v${version}` : ''} via in-app feedback_`
}

export function buildIssueBody(input: IssueBodyInput, options: { short?: boolean, withLog?: boolean, withContext?: boolean } = {}): string {
  const { short = false, withLog = true, withContext = true } = options
  const parts: Array<string | null> = [
    '## Description',
    // Verbatim: an empty description stays an explicit marker, never silently dropped.
    input.description.trim() ? input.description : '_No description._',
    screenshotSection(input),
    withContext ? contextSection(input, { short }) : null,
    withLog ? logSection(input) : null,
    footer(input),
  ]
  // `## Description` and its text form one block; every other part is its own block.
  const [heading, text, ...rest] = parts
  return [`${heading}\n\n${text}`, ...rest.filter((p): p is string => !!p)].join('\n\n') + '\n'
}
