import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePropertyOptionsStore } from '~/store/propertyOptions';
import type { NotionDatabaseSchema, NotionPropertyMapping } from '~/types/notion';

describe('store/propertyOptions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('initializes topic/activity options from Notion database schema using mapping', () => {
    const store = usePropertyOptionsStore();

    const schema: NotionDatabaseSchema = {
      Topic: {
        id: 'topic-prop',
        name: 'Topic',
        type: 'select',
        select: {
          options: [
            { id: 't1', name: 'Marketing', color: 'blue' },
            { id: 't2', name: 'Ops', color: 'gray' },
          ],
        },
      },
      Activity: {
        id: 'activity-prop',
        name: 'Activity',
        type: 'multi_select',
        multi_select: {
          options: [
            { id: 'a1', name: 'Review', color: 'yellow' },
            { id: 'a2', name: 'Build', color: 'green' },
          ],
        },
      },
    };

    const mapping: NotionPropertyMapping = {
      title: 'Name',
      status: 'Status',
      topic: 'Topic',
      activity: 'Activity',
    };

    store.initializeTopicAndActivityFromSchema(schema, mapping);

    expect(store.getTopicOptions).toEqual(['Marketing', 'Ops']);
    expect(store.getActivityOptions).toEqual(['Build', 'Review']);
  });
});
