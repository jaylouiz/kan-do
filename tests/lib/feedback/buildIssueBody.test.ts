import { describe, expect, it } from 'vitest'
import { buildIssueBody } from '~/lib/feedback/buildIssueBody'
import type { ElementInfo, IssueBodyInput } from '~/lib/feedback/types'

const element: ElementInfo = {
  chain: ['TaskCard', 'BoardColumn'],
  testId: 'task-card',
  selector: '[data-testid="task-card"] > div',
  rect: { x: 40, y: 109, width: 320, height: 132 },
  taskId: 'seed-open-1',
}

const full: IssueBodyInput = {
  description: 'Card is *cut off*\n\n| not a table |',
  element,
  environment: { route: '/tasks', viewport: { width: 1200, height: 768 }, locale: 'de' },
  versionInfo: { version: '0.1.0', os: 'macOS' },
  logTail: 'line 1\nline 2',
}

describe('buildIssueBody', () => {
  it('keeps the description verbatim under its own heading', () => {
    const body = buildIssueBody(full)
    expect(body.startsWith('## Description\n\nCard is *cut off*\n\n| not a table |\n\n')).toBe(true)
  })

  it('renders every context row', () => {
    const body = buildIssueBody(full)
    for (const needle of ['| Version | `0.1.0` |', '| OS | `macOS` |', '| Route | `/tasks` |', '| Viewport | 1200×768 |', '| Locale | `de` |',
      '| Component | `TaskCard › BoardColumn` |', '| Selector |', '| Test id | `task-card` |', '| Bounding box | 40, 109, 320×132 |', '| Task id | `seed-open-1` |']) {
      expect(body).toContain(needle)
    }
  })

  it('leaves removed items out entirely instead of rendering blanks', () => {
    const body = buildIssueBody({ description: 'x' })
    expect(body).not.toContain('## Context')
    expect(body).not.toContain('<details>')
    expect(body).not.toContain('|  |')
    expect(body).toBe('## Description\n\nx\n\n_Filed from kan-do via in-app feedback_\n')
  })

  it('drops single groups: no element means no component, selector or task rows', () => {
    const body = buildIssueBody({ ...full, element: undefined })
    expect(body).toContain('| Route |')
    expect(body).not.toMatch(/Component|Selector|Task id|Bounding box/)
  })

  it('adds the task title only when it was passed, and only next to a task id', () => {
    expect(buildIssueBody(full)).not.toContain('Task title')
    expect(buildIssueBody({ ...full, taskTitle: 'Konzept | ausarbeiten' })).toContain('| Task title | `Konzept \\| ausarbeiten` |')
    expect(buildIssueBody({ ...full, element: { ...element, taskId: null }, taskTitle: 'T' })).not.toContain('Task title')
  })

  it('renders a hostile task title as inline code, so it cannot alter the table or ping anyone', () => {
    const body = buildIssueBody({ ...full, taskTitle: 'a | b `c` @octocat #123 [x](http://y) <img src=x>' })
    expect(body).toContain('| Task title | ``a \\| b `c` @octocat #123 [x](http://y) <img src=x>`` |')
  })

  it('puts the log tail in a collapsed details block with a fence its content cannot close', () => {
    const body = buildIssueBody({ ...full, logTail: 'a ``` b\nline 2\n' })
    expect(body).toContain('<details>\n<summary>Log (last 2 lines)</summary>')
    expect(body).toContain('````text\na ``` b\nline 2\n````')
  })

  it('ends with the footer, with the version when known', () => {
    expect(buildIssueBody(full).trimEnd().endsWith('_Filed from kan-do v0.1.0 via in-app feedback_')).toBe(true)
  })

  it('states an empty description explicitly', () => {
    expect(buildIssueBody({ description: '  ' })).toContain('## Description\n\n_No description._')
  })
})

describe('buildIssueBody screenshot section (#247)', () => {
  const path = 'feedback/2026/10/0b6f.png'

  it('puts the image, the plain path and the agent hint after the description when it is uploaded', () => {
    const body = buildIssueBody({ description: 'x', screenshot: { delivery: 'upload', path } })
    const description = body.indexOf('## Description')
    const image = body.indexOf('![Screenshot](https://github.com/jaylouiz/kan-do/blob/feedback-assets/feedback/2026/10/0b6f.png?raw=true)')
    expect(description).toBeLessThan(image)
    expect(body).toContain('Path: `feedback/2026/10/0b6f.png` on `feedback-assets`')
    expect(body).toContain('`gh api repos/jaylouiz/kan-do/contents/feedback/2026/10/0b6f.png?ref=feedback-assets`')
  })

  it('is one line in the clipboard variant', () => {
    const body = buildIssueBody({ description: 'x', screenshot: { delivery: 'clipboard', path } })
    expect(body).toContain('\n\nScreenshot: paste it here (copied to the clipboard).\n\n')
    expect(body).not.toContain('![Screenshot]')
    expect(body).not.toContain(path)
  })

  it('is absent, not blank, when the screenshot was removed', () => {
    const body = buildIssueBody({ description: 'x' })
    expect(body).not.toContain('Screenshot')
    expect(body).not.toContain('feedback-assets')
  })
})
