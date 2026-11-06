import { describe, it, expect } from 'vitest';
import { defineComponent, h, type VNode } from 'vue';
import { mount } from '@vue/test-utils';
import TasksTable from '@/components/statistics/TasksTable.vue';
import type { TaskCompletionRecord } from '@/store/taskStatistics';
import { setTestLocale } from '../../helpers/i18n';

const UBadge = { template: '<span class="u-badge"><slot /></span>', props: ['variant', 'color', 'size'] };
const UIcon = { template: '<i />', props: ['name'] };

/** UTable stand-in that renders headers and cells produced by the column definitions. */
const UTable = defineComponent({
  props: { data: { type: Array, required: true }, columns: { type: Array, required: true } },
  setup(props) {
    return () => {
      const cols = props.columns as Array<{
        header: string;
        cell?: (ctx: { row: { original: unknown; getValue: (k: string) => unknown } }) => VNode | string;
        accessorKey?: string;
      }>;
      return h('table', [
        h('thead', cols.map(c => h('th', c.header))),
        h('tbody', (props.data as Array<Record<string, unknown>>).map(rec =>
          h('tr', cols.map(c => h('td', [
            c.cell?.({ row: { original: rec, getValue: k => rec[k] } }) ?? ''
          ])))
        ))
      ]);
    };
  }
});

const global = { components: { UBadge, UIcon, UTable } };

function record(overrides: Partial<TaskCompletionRecord>): TaskCompletionRecord {
  return {
    taskId: 'x',
    title: 'T',
    completedAt: new Date('2026-01-05T10:00:00'),
    timeBoxSeconds: 600,
    actualTimeSpentSeconds: 600,
    estimationAccuracy: 100,
    topic: null,
    topicColorCode: null,
    activity: null,
    isUnplanned: false,
    ...overrides
  };
}

describe('TasksTable accuracy verdict', () => {
  const records = [
    record({ taskId: 'a', estimationAccuracy: 100 }),
    record({ taskId: 'b', estimationAccuracy: 120 }),
    record({ taskId: 'c', estimationAccuracy: 150 }),
    record({ taskId: 'd', timeBoxSeconds: null, estimationAccuracy: null })
  ];

  const badgeClasses = () =>
    mount(TasksTable, { props: { tasks: records }, global })
      .findAll('span.inline-flex')
      .map(s => s.find('span.rounded-full').exists() ? s.find('span.rounded-full').classes().filter(c => /^bg-(success|warning|error)$/.test(c)).join(' ') : '');

  it('uses the same verdict dot colours in de and en (label text stays neutral)', () => {
    const de = badgeClasses();
    setTestLocale('en');
    const en = badgeClasses();
    expect(de).toEqual([
      'bg-success',
      'bg-warning',
      'bg-error',
      ''
    ]);
    expect(en).toEqual(de);
  });

  it('translates verdict labels and column headers', () => {
    const wrapper = () => mount(TasksTable, { props: { tasks: records }, global });
    expect(wrapper().text()).toContain('Aufgabe');
    expect(wrapper().findAll('span.inline-flex').map(s => s.text())).toEqual(['Ja', 'Fast', 'Nein', 'Keine Timebox']);
    setTestLocale('en');
    expect(wrapper().text()).toContain('Within timebox?');
    expect(wrapper().findAll('span.inline-flex').map(s => s.text())).toEqual(['Yes', 'Almost', 'No', 'No timebox']);
  });

  it('translates the empty-state default', () => {
    setTestLocale('en');
    expect(mount(TasksTable, { props: { tasks: [] }, global }).text()).toContain('No tasks in the selected period');
  });
});
