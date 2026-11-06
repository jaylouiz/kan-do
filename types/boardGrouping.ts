export type GroupKey =
  | "topic"
  | "activity"
  | "priority"
  | `custom:${string}`;

export interface BoardGroupingState {
  enabled: boolean;
  key: GroupKey | null;
}

export interface GroupingOption {
  value: GroupKey;
  label: string;
}
