export interface Bullet {
  title: string
  text: string
}
export interface Highlights {
  de: Bullet[]
  en: Bullet[]
}
export interface ParseError {
  line: number
  message: string
}
export type ParseResult = { ok: true; highlights: Highlights | null } | { ok: false; errors: ParseError[] }

export const MAX_BULLETS: number
export function compareVersions(a: string, b: string): number
export function parseReleaseNotes(text: string): ParseResult
