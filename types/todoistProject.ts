export interface ITodoistProject {
  id: string;
  order: number;
  color: string;
  name: string;
  commentCount: number;
  isShared: boolean;
  isFavorite: boolean;
  isInboxProject: boolean;
  url: string;
}
