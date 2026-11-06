import { describe, it, expect } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'
import { setTestLocale } from '~/tests/helpers/i18n'
import { TaskStatus } from '~/types/taskStatus'
import {
  TASK_STATUS_CONFIG,
  PRIORITY_LABEL_KEYS,
  getStatusLabel,
  getStatusIcon,
  getStatusColor,
  getPriorityLabel,
} from '~/utils/taskStatusMappings'

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)
}

describe('TASK_STATUS_CONFIG', () => {
  const statuses = [TaskStatus.Open, TaskStatus.Progress, TaskStatus.Waiting, TaskStatus.Done, TaskStatus.Backlog]

  it.each(statuses)('status %s has label, icon, and color', (status) => {
    const cfg = TASK_STATUS_CONFIG[status]
    expect(cfg).toBeDefined()
    expect(typeof cfg.labelKey).toBe('string')
    expect(get(de, cfg.labelKey)).toBeTruthy()
    expect(get(en, cfg.labelKey)).toBeTruthy()
    expect(typeof cfg.icon).toBe('string')
    expect(cfg.icon.length).toBeGreaterThan(0)
    expect(typeof cfg.color).toBe('string')
    expect(cfg.color.length).toBeGreaterThan(0)
  })

  it('Open status has correct values', () => {
    expect(getStatusLabel(TaskStatus.Open)).toBe('Offen')
    expect(TASK_STATUS_CONFIG[TaskStatus.Open].icon).toBe('ph:circle')
    expect(TASK_STATUS_CONFIG[TaskStatus.Open].color).toBe('neutral')
  })

  it('Progress status has correct values', () => {
    expect(getStatusLabel(TaskStatus.Progress)).toBe('Jetzt')
    expect(TASK_STATUS_CONFIG[TaskStatus.Progress].color).toBe('info')
  })

  it('Waiting status has correct values', () => {
    expect(getStatusLabel(TaskStatus.Waiting)).toBe('Wartet')
    expect(TASK_STATUS_CONFIG[TaskStatus.Waiting].color).toBe('warning')
  })

  it('Done status has correct values', () => {
    expect(getStatusLabel(TaskStatus.Done)).toBe('Erledigt')
    expect(TASK_STATUS_CONFIG[TaskStatus.Done].color).toBe('success')
  })
})

describe('getStatusLabel', () => {
  it('returns correct label for each status', () => {
    expect(getStatusLabel(TaskStatus.Open)).toBe('Offen')
    expect(getStatusLabel(TaskStatus.Progress)).toBe('Jetzt')
    expect(getStatusLabel(TaskStatus.Waiting)).toBe('Wartet')
    expect(getStatusLabel(TaskStatus.Done)).toBe('Erledigt')
  })

  it('falls back to Open label for unknown status', () => {
    expect(getStatusLabel(999 as TaskStatus)).toBe('Offen')
  })
})

describe('getStatusIcon', () => {
  it('returns correct icon for each status', () => {
    expect(getStatusIcon(TaskStatus.Open)).toBe('ph:circle')
    expect(getStatusIcon(TaskStatus.Progress)).toBe('ph:play-circle')
    expect(getStatusIcon(TaskStatus.Waiting)).toBe('ph:pause-circle')
    expect(getStatusIcon(TaskStatus.Done)).toBe('ph:check-circle')
  })

  it('falls back to Open icon for unknown status', () => {
    expect(getStatusIcon(999 as TaskStatus)).toBe('ph:circle')
  })
})

describe('getStatusColor', () => {
  it('returns correct color for each status', () => {
    expect(getStatusColor(TaskStatus.Open)).toBe('neutral')
    expect(getStatusColor(TaskStatus.Progress)).toBe('info')
    expect(getStatusColor(TaskStatus.Waiting)).toBe('warning')
    expect(getStatusColor(TaskStatus.Done)).toBe('success')
  })

  it('falls back to Open color for unknown status', () => {
    expect(getStatusColor(999 as TaskStatus)).toBe('neutral')
  })
})

describe('PRIORITY_LABEL_KEYS', () => {
  it('has labels for the three priority levels (#617)', () => {
    expect(getPriorityLabel(1)).toBe('Niedrig')
    expect(getPriorityLabel(2)).toBe('Normal')
    expect(getPriorityLabel(3)).toBe('Hoch')
    expect(Object.keys(PRIORITY_LABEL_KEYS)).toEqual(['1', '2', '3'])
  })
})

describe('getPriorityLabel', () => {
  it('returns correct label for each priority', () => {
    expect(getPriorityLabel(1)).toBe('Niedrig')
    expect(getPriorityLabel(2)).toBe('Normal')
    expect(getPriorityLabel(3)).toBe('Hoch')
  })

  it('reads the former 4th level (urgent) and anything above as High', () => {
    expect(getPriorityLabel(4)).toBe('Hoch')
    expect(getPriorityLabel(99)).toBe('Hoch')
  })

  it('reads a value that is no level (0, NaN) as Normal (#653)', () => {
    expect(getPriorityLabel(0)).toBe('Normal')
    expect(getPriorityLabel(NaN)).toBe('Normal')
  })
})

describe('locale switching', () => {
  it('translates status labels to English', () => {
    setTestLocale('en')
    expect(getStatusLabel(TaskStatus.Open)).toBe('Open')
    expect(getStatusLabel(TaskStatus.Progress)).toBe('Now')
    expect(getStatusLabel(TaskStatus.Waiting)).toBe('Waiting')
    expect(getStatusLabel(TaskStatus.Done)).toBe('Done')
  })

  it('translates priority labels to English', () => {
    setTestLocale('en')
    expect(getPriorityLabel(1)).toBe('Low')
    expect(getPriorityLabel(2)).toBe('Regular')
    expect(getPriorityLabel(4)).toBe('High')
  })

  it('every priority key exists in both locales', () => {
    for (const key of [...Object.values(PRIORITY_LABEL_KEYS), 'priority.none']) {
      expect(get(de, key)).toBeTruthy()
      expect(get(en, key)).toBeTruthy()
    }
  })
})
