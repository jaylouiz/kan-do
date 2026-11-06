import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import AppNav from '~/components/nav/AppNav.vue'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useBoardDragState } from '~/composables/useBoardDragState'

const route = reactive<{ path: string; fullPath: string; meta: Record<string, unknown> }>({ path: '/tasks', fullPath: '/tasks', meta: {} })
const navigateTo = vi.fn()
const openDayClose = vi.fn()
// The bar reads the live router route (#507); other composables in the tree still call `useRoute()`
vi.mock('nuxt/app', () => ({
  useRouter: () => ({ currentRoute: ref(route) }),
  useRoute: () => route,
  navigateTo: (to: string) => navigateTo(to),
}))
vi.mock('~/composables/useDayClose', () => ({ useDayClose: () => ({ open: openDayClose }) }))
vi.mock('~/components/nav/MorePanel.vue', () => ({
  default: {
    emits: ['close', 'dayClose'],
    template: '<div data-testid="more-panel"><button data-testid="day" @click="$emit(\'dayClose\')" /><button data-testid="row" @click="$emit(\'close\')" /></div>',
  },
}))

const stubs = {
  // The popover keeps its content mounted only while open, like Reka's
  UPopover: {
    props: ['open'],
    emits: ['update:open'],
    template: '<div><div @click="$emit(\'update:open\', !open)"><slot /></div><slot v-if="open" name="content" /></div>',
  },
  UTooltip: { props: ['text', 'kbds', 'disabled'], template: '<div :data-tooltip="disabled ? undefined : text" :data-kbds="kbds?.join(\'+\')"><slot /></div>' },
  UChip: { props: ['show', 'ui'], template: '<span :data-dot="show ? ui.base : undefined"><slot /></span>' },
  UIcon: true,
  NuxtLink: {
    props: ['to'],
    template: '<slot :href="to" :navigate="() => $emit(\'go\', to)" />',
  },
}

const render = (): VueWrapper => mount(AppNav, { global: { stubs }, attachTo: document.body })

function go(path: string) {
  route.path = path
  route.fullPath = path
}

describe('AppNav: the global app bar (#470)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    go('/tasks')
    route.meta = {}
    navigateTo.mockClear()
    openDayClose.mockClear()
    document.body.innerHTML = ''
  })

  const place = (w: VueWrapper, id: 'board' | 'statistics') => w.find(`[data-testid="app-nav-place-${id}"]`)
  const more = (w: VueWrapper) => w.find('[data-testid="app-nav-more"]')
  const third = (w: VueWrapper) => w.find('[data-testid="app-nav-place-more"]')

  it('renders nothing on a route with appNav: false', () => {
    route.meta = { appNav: false }
    expect(render().find('[data-testid="app-nav"]').exists()).toBe(false)
  })

  it('links the brand and Heute to /tasks and Statistik to /statistics; the brand is never current', () => {
    const w = render()
    expect(w.find('[data-testid="app-nav-brand"]').attributes('href')).toBe('/tasks')
    expect(w.find('[data-testid="app-nav-brand"]').attributes('aria-current')).toBeUndefined()
    expect(place(w, 'board').attributes('href')).toBe('/tasks')
    expect(place(w, 'statistics').attributes('href')).toBe('/statistics')
  })

  it.each([
    ['/tasks', 'board'],
    ['/tasks/add', 'board'],
    ['/statistics', 'statistics'],
    ['/trash', 'more'],
    ['/settings', 'more'],
    ['/settings/topics', 'more'],
  ])('on %s exactly the %s control is current', async (path, expected) => {
    const w = render()
    go(path)
    await nextTick()
    const current = w.findAll('[aria-current="page"]').map(el => el.attributes('data-testid'))
    const id = { board: 'app-nav-place-board', statistics: 'app-nav-place-statistics', more: 'app-nav-place-more' }[expected as 'board' | 'statistics' | 'more']
    expect(current).toEqual([id])
  })

  it('no control is current on an unknown route', async () => {
    const w = render()
    go('/somewhere')
    await nextTick()
    expect(w.findAll('[aria-current="page"]')).toHaveLength(0)
  })

  it('an open panel is an overlay: Heute stays current, ⋯ is open but not current', async () => {
    const w = render()
    await more(w).trigger('click')
    expect(w.find('[data-testid="more-panel"]').exists()).toBe(true)
    expect(place(w, 'board').attributes('aria-current')).toBe('page')
    expect(more(w).attributes('aria-current')).toBeUndefined()
    expect(more(w).classes()).toContain('is-open')
    expect(more(w).classes()).not.toContain('is-selected')

    await more(w).trigger('click')
    expect(place(w, 'board').attributes('aria-current')).toBe('page')
  })

  it('on /trash the open panel leaves the third segment selected; ⋯ is open, never selected', async () => {
    go('/trash')
    const w = render()
    await more(w).trigger('click')
    expect(third(w).attributes('aria-current')).toBe('page')
    expect(third(w).text()).toBe('Papierkorb')
    expect(more(w).attributes('aria-current')).toBeUndefined()
    expect(more(w).classes()).toContain('is-open')
    expect(more(w).classes()).not.toContain('is-selected')
    expect(place(w, 'board').attributes('aria-current')).toBeUndefined()
    expect(place(w, 'statistics').attributes('aria-current')).toBeUndefined()
  })

  describe('third segment (#583)', () => {
    it.each([
      ['/settings', '/settings', 'Einstellungen'],
      ['/settings/topics', '/settings?tab=manage', 'Einstellungen'],
      ['/settings/updates', '/settings?tab=manage', 'Einstellungen'],
      ['/trash', '/trash', 'Papierkorb'],
    ])('on %s the pill shows %s as "%s", selected, and ⋯ is a plain button', (path, href, label) => {
      go(path)
      const w = render()
      expect(third(w).attributes('href')).toBe(href)
      expect(third(w).text()).toBe(label)
      expect(third(w).attributes('aria-current')).toBe('page')
      expect(third(w).classes()).toContain('is-selected')
      expect(more(w).attributes('aria-current')).toBeUndefined()
      expect(more(w).classes()).not.toContain('is-selected')
      expect(w.find('[data-testid="app-nav"]').classes()).toContain('has-third')
    })

    it.each(['/tasks', '/statistics', '/somewhere'])('on %s there is no third segment', (path) => {
      go(path)
      const w = render()
      expect(w.find('[data-testid="app-nav-third"]').exists()).toBe(false)
      expect(w.find('[data-testid="app-nav"]').classes()).not.toContain('has-third')
    })

    it('a direct load shows the segment at once, and its panel keeps ⋯ without aria-current', async () => {
      go('/settings')
      const w = render()
      await more(w).trigger('click')
      expect(third(w).exists()).toBe(true)
      expect(more(w).attributes('aria-current')).toBeUndefined()
      expect(w.findAll('[aria-current="page"]')).toHaveLength(1)
    })

    it('Heute -> Einstellungen -> Papierkorb -> Heute: the segment appears, relabels and leaves', async () => {
      const w = render()
      expect(third(w).exists()).toBe(false)

      go('/settings')
      await nextTick()
      expect(third(w).text()).toBe('Einstellungen')

      go('/trash')
      await nextTick()
      expect(third(w).text()).toBe('Papierkorb')
      expect(third(w).attributes('href')).toBe('/trash')
      expect(w.findAll('[aria-current="page"]')).toHaveLength(1)

      go('/tasks')
      await nextTick()
      // The leave animation (no WAAPI in jsdom: gone at once); the segment is no longer current either way
      expect(w.findAll('[aria-current="page"]').map(el => el.attributes('data-testid'))).toEqual(['app-nav-place-board'])
      await vi.waitFor(() => expect(w.find('[data-testid="app-nav-third"]').exists()).toBe(false))
      expect(w.find('[data-testid="app-nav"]').classes()).not.toContain('has-third')
    })

    it('a segment that is leaving is inert and not current, and comes back when the page returns', async () => {
      go('/settings')
      const w = render()
      const el = w.find('[data-testid="app-nav-third"]').element as HTMLElement
      // A leave animation that never finishes keeps the segment mounted
      el.animate = (() => ({ cancel: vi.fn(), finished: new Promise(() => {}) })) as unknown as typeof el.animate

      go('/tasks')
      await nextTick()
      await nextTick()
      expect(w.find('[data-testid="app-nav-third"]').exists()).toBe(true)
      expect(w.find('[data-testid="app-nav-third"]').attributes('inert')).toBeDefined()
      expect(third(w).attributes('aria-current')).toBeUndefined()

      go('/trash')
      await nextTick()
      expect(w.find('[data-testid="app-nav-third"]').attributes('inert')).toBeUndefined()
      expect(third(w).attributes('aria-current')).toBe('page')
      expect(third(w).text()).toBe('Papierkorb')
    })
  })

  it('closes the panel on a route change and when a row asks for it', async () => {
    const w = render()
    await more(w).trigger('click')
    go('/settings')
    await nextTick()
    expect(w.find('[data-testid="more-panel"]').exists()).toBe(false)

    await more(w).trigger('click')
    await w.find('[data-testid="row"]').trigger('click')
    expect(w.find('[data-testid="more-panel"]').exists()).toBe(false)
  })

  it('Tag abschließen closes the panel, focuses ⋯ and only then opens the dialog', async () => {
    const w = render()
    await more(w).trigger('click')
    const order: string[] = []
    openDayClose.mockImplementation(() => order.push(`open (active: ${document.activeElement?.getAttribute('data-testid')})`))

    await w.find('[data-testid="day"]').trigger('click')
    await vi.waitFor(() => expect(openDayClose).toHaveBeenCalledTimes(1))

    expect(order).toEqual(['open (active: app-nav-more)'])
    expect(w.find('[data-testid="more-panel"]').exists()).toBe(false)
  })

  it('a failing source puts a dot on ⋯ and changes its accessible name; repairing removes it', async () => {
    const health = useIntegrationHealthStore()
    const w = render()
    expect(more(w).attributes('aria-label')).toBe('Mehr')
    expect(w.find('[data-dot]').exists()).toBe(false)

    health.markBroken('notion', 'Unauthorized')
    await nextTick()
    expect(more(w).attributes('aria-label')).toBe('Mehr, Verbindungsproblem')
    expect(w.find('[data-dot]').attributes('data-dot')).toBe('bg-error-700')

    health.markOffline('notion', 'Network')
    await nextTick()
    expect(w.find('[data-dot]').attributes('data-dot')).toBe('bg-warning-700')

    health.recordSuccessfulSync('notion')
    await nextTick()
    expect(more(w).attributes('aria-label')).toBe('Mehr')
    expect(w.find('[data-dot]').exists()).toBe(false)
  })

  it('teaches the palette in the ⋯ tooltip on the board only', async () => {
    const w = render()
    expect(w.find('[data-tooltip]').attributes('data-kbds')).toBe('meta+k')
    expect(w.find('[data-tooltip]').attributes('data-tooltip')).toBe('Mehr · Befehle')

    go('/settings')
    await nextTick()
    expect(w.find('[data-tooltip]').attributes('data-kbds')).toBeUndefined()
    expect(w.find('[data-tooltip]').attributes('data-tooltip')).toBe('Mehr')
  })

  it('fades while a card is dragged', async () => {
    const w = render()
    const { dragState } = useBoardDragState()
    expect(w.find('[data-testid="app-nav"]').classes()).not.toContain('is-dragging')
    dragState.value.isDragging = true
    await nextTick()
    expect(w.find('[data-testid="app-nav"]').classes()).toContain('is-dragging')
    dragState.value.isDragging = false
  })
})
