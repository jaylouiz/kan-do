# Application Purpose

## Vision

Kan-Do narrows attention to the work already chosen for today. It provides a frictionless flow for updating state, tracking time, and celebrating wins without duplicating upstream task management tooling.

## Core Principles

- **Focus**: Minimize distraction through scoped boards, calm visuals, and intentional affordances.
- **WIP limits**: Encourage controlled throughput; highlight overload quickly.
- **Timeboxing**: Provide timers, summaries, and prompts that improve estimation quality over time.
- **Positive reinforcement**: Reward completion streaks and streak-preserving behaviour.
- **Continuous improvement**: Capture statistics that help users plan better days.

## User Journeys (Canonical)

- **Morning planning**: Pull a small set of tasks from the source of truth into Today. Confirm integrations are synced.
- **In-flow update**: Move tasks across Today → Doing → Waiting → Done; update notes and timeboxes inline.
- **Review**: Close the day by looking at streaks, time distribution, and pending follow-ups.

## Non-goals

- Building a backlog manager, CRM, or document store.
- Replacing integration-specific dashboards.
- Introducing complex hierarchy (projects/epics). Keep data flat and bite-sized.

## Implementation Guardrails

- Keep domain concepts lightweight (`Task`, `BoardColumn`, `Timer`), avoiding deep inheritance.
- Ensure offline-first flows: local cache is authoritative during network gaps, reconcile later.
- Maintain parity between Nuxt and Tauri: feature flags must work identically unless explicitly noted.
