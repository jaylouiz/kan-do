/**
 * @module feedback/types
 * @description Shared shapes of the in-app feedback pipeline (#227). Pure data, no Vue.
 */

/** Rounded CSS-pixel box of a picked element. */
export interface ElementRect {
  x: number
  y: number
  width: number
  height: number
}

/** What the element picker records about one DOM element. */
export interface ElementInfo {
  /** Nearest component names, innermost first (at most 3). Empty when no marker is present. */
  chain: string[]
  /** `data-testid` of the element or its nearest ancestor. */
  testId: string | null
  /** Short stable selector: nearest test-id/id ancestor plus a tag/`:nth-of-type` path. */
  selector: string
  rect: ElementRect
  /** Nearest `[data-task-id]`. The title is only added by the user in the review step. */
  taskId: string | null
}

/** Environment facts. Each group is one removable item in the review step. */
export interface EnvironmentInfo {
  route: string
  viewport: { width: number, height: number }
  locale: string
}

export interface VersionInfo {
  version: string | null
  os: string | null
}

/**
 * The screenshot of a report (#247). `upload` puts the image into the repo (path below) and links it;
 * `clipboard` only names the paste step (token without Contents: write, or no token at all).
 */
export type ScreenshotDelivery = 'upload' | 'clipboard'

export interface ScreenshotInfo {
  delivery: ScreenshotDelivery
  /** Repo path of the uploaded PNG on the feedback branch, fixed when the image is flattened. */
  path: string
}

/** The issue-body input after the user's context choices were applied: absent means "not sent". */
export interface IssueBodyInput {
  description: string
  element?: ElementInfo
  /** Only set when the user ticked "Titel einfügen". */
  taskTitle?: string
  environment?: EnvironmentInfo
  versionInfo?: VersionInfo
  /** TODO(#225): the app log tail, once the log file exists on main. Never contains a token. */
  logTail?: string
  screenshot?: ScreenshotInfo
}

export const FEEDBACK_REPO = 'jaylouiz/kan-do'
/** Orphan branch that holds the report screenshots (ADR 014). Rust only lets the feedback token write here. */
export const FEEDBACK_ASSETS_BRANCH = 'feedback-assets'
export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 4000
export const LOG_TAIL_LINES = 30
