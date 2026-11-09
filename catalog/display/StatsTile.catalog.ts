import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'StatsTile',
  source: 'app',
  alternatives: ['UCollapsible'],
  variants: [
    { id: 'default', props: { n: 2, question: 'Wie lange dauert eine Aufgabe?', line: 'Meist etwas länger als geplant.', open: false } },
    { id: 'elevated', props: { n: 3, question: 'Wo geht die Zeit hin?', line: 'Zwei Drittel in Angeboten.', open: false, tone: 'elevated' } },
    { id: 'wide', props: { n: 4, question: 'Welche Muster gibt es?', line: 'Große Aufgaben laufen über.', open: false, wide: true } },
    { id: 'fixed', props: { n: 5, question: 'Wann arbeite ich?', line: 'Vormittags.', open: true, toggleable: false } },
  ],
  states: [
    { id: 'open', state: 'open', props: { n: 2, question: 'Wie lange dauert eine Aufgabe?', line: 'Meist etwas länger als geplant.', open: true } },
    { id: 'long-text', state: 'long-text', props: { n: 2, question: 'Wie lange dauert eine Aufgabe im Durchschnitt über die letzten vier Wochen?', line: 'Angebot für den Neubau des Gartenhauses mit Terrasse, Pergola und Bewässerungsanlage für Familie Müller-Lüdenscheidt überarbeiten', open: false } },
  ],
} satisfies CatalogEntry
