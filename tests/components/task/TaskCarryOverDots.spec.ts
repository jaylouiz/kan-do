import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskCarryOverDots from '~/components/task/TaskCarryOverDots.vue'
import { setTestLocale } from '../../helpers/i18n'

const UTooltip = { props: ['text'], template: '<span class="tooltip" :data-text="text"><slot /></span>' }
const render = (day: number, decorative = false) =>
  mount(TaskCarryOverDots, { props: { day, decorative }, global: { stubs: { UTooltip } } })

describe('TaskCarryOverDots (#99, #121)', () => {
  it.each([0, 1])('renders nothing on display day %i (first board day)', (day) => {
    expect(render(day).find('[data-testid="carry-over-dots"]').exists()).toBe(false)
    expect(render(day, true).find('[data-testid="carry-over-dots"]').exists()).toBe(false)
  })

  it('day 2: two dots, no numeral below the cap, accessible name and tooltip "Tag 2 auf dem Board"', () => {
    setTestLocale('de')
    const wrapper = render(2)
    const dots = wrapper.get('[data-testid="carry-over-dots"]')
    expect(dots.findAll('.carry-over-dot')).toHaveLength(2)
    expect(dots.find('[data-testid="carry-over-count"]').exists()).toBe(false)
    expect(dots.attributes('aria-label')).toBe('Tag 2 auf dem Board')
    expect(dots.attributes('tabindex')).toBe('0')
    expect(wrapper.get('.tooltip').attributes('data-text')).toBe('Tag 2 auf dem Board')
  })

  it('has an English label', () => {
    setTestLocale('en')
    expect(render(3).get('[data-testid="carry-over-dots"]').attributes('aria-label')).toBe('Day 3 on the board')
    setTestLocale('de')
  })

  it('day 6 shows 6 dots without "+" or numeral; day 7+ shows 6 dots, "+" and the exact numeral (#584)', () => {
    const six = render(6).get('[data-testid="carry-over-dots"]')
    expect(six.findAll('.carry-over-dot')).toHaveLength(6)
    expect(six.find('.carry-over-more').exists()).toBe(false)
    expect(six.find('[data-testid="carry-over-count"]').exists()).toBe(false)
    const seven = render(7).get('[data-testid="carry-over-dots"]')
    expect(seven.findAll('.carry-over-dot')).toHaveLength(6)
    expect(seven.get('[data-testid="carry-over-count"]').text()).toBe('7')
    const nine = render(9).get('[data-testid="carry-over-dots"]')
    expect(nine.findAll('.carry-over-dot')).toHaveLength(6)
    expect(nine.find('.carry-over-more').text()).toBe('+')
    expect(nine.get('[data-testid="carry-over-count"]').text()).toBe('9')
    expect(nine.get('[data-testid="carry-over-count"]').attributes('aria-hidden')).toBe('true')
  })

  it('decorative: hidden from assistive tech, no tab stop, no numeral', () => {
    const dots = render(2, true).get('[data-testid="carry-over-dots"]')
    expect(dots.attributes('aria-hidden')).toBe('true')
    expect(dots.attributes('tabindex')).toBeUndefined()
    expect(dots.find('[data-testid="carry-over-count"]').exists()).toBe(false)
  })
})
