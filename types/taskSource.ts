/**
 * @module types/taskSource
 * @description Task sources (epic #264, decisions D1/D2). Terms: `GLOSSARY.md`.
 * Local is implicit and always available; integrations (Notion, Todoist) are connected on top of it.
 */

/** An integration that can be connected as a task source. */
export type IntegrationSourceId = 'notion' | 'todoist';

/** Where a task lives. `local` is the app itself: no upstream, persisted through Pinia only. */
export type SourceId = 'local' | IntegrationSourceId;

export const INTEGRATION_SOURCE_IDS: readonly IntegrationSourceId[] = ['notion', 'todoist'];
export const SOURCE_IDS: readonly SourceId[] = ['local', ...INTEGRATION_SOURCE_IDS];

/**
 * `boardConfig.sources`: which integrations are connected and where new tasks go.
 * Local is not listed in `connected`. `null` on the board config means "never onboarded".
 * Credentials stay in `notionConfig` / the Keychain (ADR 007), never here.
 */
export interface TaskSourcesConfig {
  connected: IntegrationSourceId[];
  default: SourceId;
}
