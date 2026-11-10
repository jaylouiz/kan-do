/**
 * Shared data of the `/ui` fixtures (kd#127): the demo board's statistics, derived once for a fixed day so a sample
 * looks the same on every visit (the style fingerprint records bar heights and ring arcs).
 * Dev only, like everything under `dev-tools/ui-catalog/`.
 */
import { buildDemoDayEndHistory, buildDemoStatisticsHistory, buildDemoWorkSessions } from '~/lib/demo-statistics-history'
import { buildDemoBoard, type DemoBoard } from '~/lib/demo-board'
import { deriveReview, type Review } from '~/lib/statisticsReview'
import type { NotionDatabaseSchema } from '~/types/notion'
import { deriveWorkRhythm } from '~/lib/workRhythm'

/** The day every fixture reads "today" from: a Monday afternoon, so the current week has begun and the last is complete. */
export const FIXTURE_NOW = new Date(2026, 10, 9, 15, 0)

let review: Review | undefined
/** The review `/statistics?seed=demo` shows, for `FIXTURE_NOW`. */
export function demoReview(): Review {
  review ??= deriveReview(buildDemoStatisticsHistory(FIXTURE_NOW), FIXTURE_NOW, buildDemoDayEndHistory(FIXTURE_NOW))
  return review
}

/** The work rhythm of the demo board's sessions, for `FIXTURE_NOW`. */
export const demoRhythm = () => deriveWorkRhythm(buildDemoWorkSessions(FIXTURE_NOW), FIXTURE_NOW)

/** The demo board's completion records, newest first as the statistics list shows them. */
export const demoRecords = () => [...buildDemoStatisticsHistory(FIXTURE_NOW)].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())

/** The demo board built for the real today (`useToday` reads the clock, so a "done yesterday" label needs a real yesterday), with a fixed load id so ids stay the same. */
export const demoBoardToday = (): DemoBoard => buildDemoBoard(new Date(), 'catalog')

/** The schema of a typical Notion task database, as the setup wizard's steps read it from the connected database. */
export function demoNotionSchema(): NotionDatabaseSchema {
  const option = (name: string, color: string) => ({ id: `opt-${name.toLowerCase()}`, name, color })
  return {
    Name: { id: 'title', name: 'Name', type: 'title', title: {} },
    Status: { id: 'status', name: 'Status', type: 'select', select: { options: [option('Today', 'blue'), option('Doing', 'yellow'), option('Waiting', 'orange'), option('Done', 'green'), option('Archived', 'gray')] } },
    Priority: { id: 'priority', name: 'Priority', type: 'select', select: { options: [option('Urgent', 'red'), option('High', 'orange'), option('Medium', 'yellow'), option('Low', 'gray')] } },
    Due: { id: 'due', name: 'Due', type: 'date', date: {} },
    Topic: { id: 'topic', name: 'Topic', type: 'select', select: { options: [option('Baustelle Müller', 'green'), option('Angebote', 'blue'), option('Personal', 'purple')] } },
    Activity: { id: 'activity', name: 'Activity', type: 'select', select: { options: [option('Vor Ort', 'brown'), option('Büro', 'default')] } },
    'Time box (min)': { id: 'timebox', name: 'Time box (min)', type: 'number', number: {} },
    'Time spent (min)': { id: 'spent', name: 'Time spent (min)', type: 'number', number: {} },
    Completed: { id: 'completed', name: 'Completed', type: 'date', date: {} },
    Unplanned: { id: 'unplanned', name: 'Unplanned', type: 'checkbox', checkbox: {} },
    Customer: { id: 'customer', name: 'Customer', type: 'rich_text', rich_text: {} },
    Budget: { id: 'budget', name: 'Budget', type: 'number', number: {} },
    Site: { id: 'site', name: 'Site', type: 'url', url: {} },
  }
}
