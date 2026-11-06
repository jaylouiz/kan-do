import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskProgressCircular from '~/components/task/TaskProgressCircular.vue'

describe('TaskProgressCircular (#109)', () => {
  it('renders only the track and the progress arc while running (no sweeping marker)', () => {
    const w = mount(TaskProgressCircular, {
      props: { timeBoxSeconds: 3600, timeSpentSeconds: 900, isRunning: true },
    })
    expect(w.findAll('circle')).toHaveLength(2)
    expect(w.find('.task-progress-circular__sweep').exists()).toBe(false)
    expect(w.classes()).toContain('is-running')
  })
})
