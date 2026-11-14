/**
 * @module lib/taskCardMenu
 * @description The hand-over between `TaskCardContextMenu` and the `TaskCard` inside it (#296): the menu provides a
 * function that opens it anchored at a trigger element, the card renders its corner menu button only when it is
 * provided (a trash entry, the add-sheet draft, a static-mode card and the drag preview have no menu, so no button).
 */
import type { InjectionKey } from 'vue'

export type OpenTaskCardMenu = (trigger: HTMLElement) => void

export const TASK_CARD_MENU_KEY: InjectionKey<OpenTaskCardMenu> = Symbol('task-card-menu')
