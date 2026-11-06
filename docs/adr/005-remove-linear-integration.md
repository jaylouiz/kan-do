# ADR 005: Remove the Linear integration

## Status

Accepted

## Context

The Linear integration depended on `@linear/sdk`, which had fallen roughly 18 major versions behind. Upgrading would have meant rewriting the adapter, the stub and the setup wizard for an integration with low usage compared to local, Todoist and Notion.

## Decision

Remove Linear entirely instead of upgrading: adapter, stub, setup modal, config store, types, fixtures, E2E helpers, styling tokens and the `@linear/sdk` dependency.

## Consequences

- Users whose persisted `board-store` has `taskService: 'linear'` are reset to `null` on hydration (`sanitizeBoardConfig` in `store/board.ts`) and land on the welcome/setup flow. A persisted `linearApiKey` is dropped; other persisted board fields are preserved.
- A stale `linearConfig` localStorage key is no longer read; it is removed on board-store hydration, and the sanitised board config is written back immediately.
- Linear tasks are not migrated. They remain in `tasks-store` until the user picks a new backend, at which point setup replaces or merges them.
- Breaking change for anyone depending on the `linear` task service (`feat!`).
