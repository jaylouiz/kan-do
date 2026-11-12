/**
 * @composable useBoardFocus
 * @description The topic focus of the board (#161): hide the cards of every other topic in Offen, Wartet and
 * Erledigt so one stretch of work stays in view. State lives in the board store (`focus`, one local day);
 * this composable is the read side the board and the drag-and-drop order go through.
 * - A card in Jetzt is never hidden, whatever the focus (the user wants to see that Jetzt is occupied)
 * - Only the board's column lists and the drag order are filtered; the store's getters, statistics, day close, the
 *   recap and the WIP rule keep seeing every task
 * - Chip counts and the hidden number leave Jetzt out, so they count what the focus can keep or hide
 * @responsibility Filter, counts and the chip row's open state; never mutates tasks
 */
import { computed, ref } from 'vue'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

/** The chip row (the funnel's open state): transient, shared by the funnel in the app bar and the row on the board */
const chipsOpen = ref(false)
/** The funnel's button (BoardFocusTrigger registers it): Esc in the chip row closes the row and puts focus back here */
const triggerEl = ref<HTMLElement | null>(null)

/** Pure filter: with a focus, a task stays when it runs in Jetzt or carries the topic. */
export function applyTopicFocus<T extends Pick<Task, 'status' | 'topic'>>(tasks: readonly T[], topic: string | null): T[] {
  if (topic === null) return [...tasks]
  return tasks.filter(task => task.status === TaskStatus.Progress || task.topic === topic)
}

export interface TopicChoice {
  topic: string
  count: number
}

export function useBoardFocus() {
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()

  const focusTopic = computed(() => boardStore.activeFocusTopic ?? null)

  /** The cards the focus can keep or hide: Offen, Wartet and today's Erledigt (Jetzt is never hidden) */
  const filterable = computed(() => [...tasksStore.tasksOpen, ...tasksStore.tasksWaiting, ...tasksStore.tasksDoneToday])

  /** The topics on those cards with their card count, most cards first, then by name */
  const topicChoices = computed<TopicChoice[]>(() => {
    const counts = new Map<string, number>()
    for (const task of filterable.value) {
      if (task.topic) counts.set(task.topic, (counts.get(task.topic) ?? 0) + 1)
    }
    return [...counts]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
  })

  /** Cards the focus hides right now (cards without a topic included, Jetzt excluded) */
  const hiddenCount = computed(() => {
    const topic = focusTopic.value
    return topic === null ? 0 : filterable.value.filter(task => task.topic !== topic).length
  })

  /** The funnel has a job while a focus is on or a card has a topic to focus on */
  const hasFocusJob = computed(() => focusTopic.value !== null || topicChoices.value.length > 0)

  /** Applies the focus to one column's tasks (Jetzt's list passes through unchanged because its task is never hidden) */
  function applyFocus<T extends Pick<Task, 'status' | 'topic'>>(tasks: readonly T[]): T[] {
    return applyTopicFocus(tasks, focusTopic.value)
  }

  function setFocus(topic: string) {
    boardStore.setFocus(topic)
    chipsOpen.value = false
  }

  function clearFocus() {
    boardStore.clearFocus()
    chipsOpen.value = false
  }

  /** Esc: closes the chip row and returns focus to the funnel */
  function closeChips() {
    chipsOpen.value = false
    triggerEl.value?.focus({ preventScroll: true })
  }

  return { focusTopic, topicChoices, hiddenCount, hasFocusJob, chipsOpen, triggerEl, applyFocus, setFocus, clearFocus, closeChips }
}
