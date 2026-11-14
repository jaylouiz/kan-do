import type { Task } from "~/types/task";
import type { DeletedGap } from "~/types/deletedGap";

/**
 * One rendered element of a standard column's task list: a collapsed stack, the header row of an
 * expanded one, or a card (an ungrouped card, a single-card group or a member of an expanded stack).
 * `card` and `stack` items are sortables (a collapsed stack by its front task, #150); the
 * `stack-header` row carries no `sortableIndex`. A `gap` (#422) is the slot of a card deleted inside its undo window:
 * no sortable, so it never takes part in the drag order. The `capacity` item (#132) is the divider of the Offen list
 * at the point where the day's time is used up: no sortable either, never in the drag order.
 */
export type ColumnItem =
  | {
      kind: "capacity";
      key: "capacity";
      itemIndex: number;
    }
  | {
      kind: "gap";
      key: string;
      gap: DeletedGap;
      itemIndex: number;
    }
  | {
      kind: "stack";
      key: string;
      groupKey: string;
      label: string;
      tasks: Task[];
      muted: boolean;
      /** Position in the list, drives the card z-index (later items overlap earlier ones) */
      itemIndex: number;
      /** Sortable index among the column's draggables: the stack is one, by its front task */
      sortableIndex: number;
    }
  | {
      kind: "stack-header";
      key: string;
      groupKey: string;
      label: string;
      /** Number of members in the expanded group */
      count: number;
      /** The group's front task: the header's pill reads its topic and source */
      firstTask: Task;
      itemIndex: number;
    }
  | {
      kind: "card";
      key: string;
      task: Task;
      muted: boolean;
      itemIndex: number;
      /** Sortable index among the column's draggable cards */
      sortableIndex: number;
      /** Group key of the expanded stack the card belongs to */
      fromStack: string | undefined;
      /** Place of the card in its expanded stack, drives the group spacing */
      stackPosition: "first" | "middle" | "last" | undefined;
      /** 1-based place of the card in its expanded group; undefined for a card outside one */
      stackIndex: number | undefined;
      /** Number of cards in that group */
      stackSize: number | undefined;
      /** Readable group name, for the card's "n of m in <group>" description */
      stackLabel: string | undefined;
    };
