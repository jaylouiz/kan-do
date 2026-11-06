import { describe, it, expect } from 'vitest'
import { buildGroupingOptions } from '~/utils/groupingOptions'
import type { NotionCustomPropertyConfig } from '~/types/notion'

const prop = (over: Partial<NotionCustomPropertyConfig>): NotionCustomPropertyConfig =>
  ({ name: 'Bereich', type: 'select', enabled: true, key: 'bereich', ...over })

const build = (customProperties: NotionCustomPropertyConfig[], mixedBoard: boolean) =>
  buildGroupingOptions({ customProperties, mixedBoard, topicLabel: 'Thema', activityLabel: 'Aktivität', priorityLabel: 'Priorität' })
    .map((o) => o.value)

describe('buildGroupingOptions (#323)', () => {
  it('a one-source board keeps topic, priority and the enabled single-selects', () => {
    expect(build([prop({}), prop({ key: 'tags', type: 'multi_select' }), prop({ key: 'off', enabled: false })], false))
      .toEqual(['topic', 'activity', 'priority', 'custom:bereich'])
  })

  it('a mixed board offers only topic, activity and priority', () => {
    expect(build([prop({})], true)).toEqual(['topic', 'activity', 'priority'])
  })

  it('uses the label override of a custom property', () => {
    const options = buildGroupingOptions({ customProperties: [prop({ label: 'Bereich neu' })], mixedBoard: false, topicLabel: 'a', activityLabel: 'c', priorityLabel: 'b' })
    expect(options.at(-1)).toEqual({ value: 'custom:bereich', label: 'Bereich neu' })
  })
})
