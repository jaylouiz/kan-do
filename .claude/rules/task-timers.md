---
paths:
  - "composables/useTaskTimerDriver.ts"
  - "lib/taskTimers.ts"
  - "store/tasks.ts"
  - "app.vue"
  - "composables/useWorkSessionTracking.ts"
  - "lib/liveTime.ts"
  - "tests/e2e/timer-lifecycle.spec.ts"
---
# Task timer rules (#352)

- **Task timers (#352):** a task in Jetzt is timed by `useTaskTimerDriver` (started once in `app.vue`; the status decides, no card and no page involved), intervals live only in `lib/taskTimers.ts`. `task.timerId` is a handle of this page load (reset at driver start, never passed to `clearInterval`); stop a timer through `stopTaskTimer(id)` (`clearInterval(task.timerId)` is an ESLint error). Time while the app is closed is not counted.
- **Checkpointed time (#286):** a tick writes no store: the second is collected in `lib/liveTime` (runtime-only, never persisted) and the driver writes it into `tasks-store` through `tasksStore.addTrackedSeconds` every `LIVE_CHECKPOINT_SECONDS` (10), in `stopTaskTimer`, driver `stop`, on `pagehide` and when the page turns hidden. What the user sees reads `liveTimeSpent(task)` (stored + collected: card chip, sheet, completion snapshot); code that needs the exact total of a task that may be in Jetzt either reads `liveTimeSpent` or runs after a stop. A hard crash loses at most the 10 s collected. The user's time edit (`setTimeSpent`) discards the collected seconds.
- **Work sessions (#600):** the driver tells `composables/useWorkSessionTracking` where it arms and stops a timer (`armJetztTask`, `stopTaskTimer`, driver `stop`); the session list grows by that module's own 60 s heartbeat. Never write a session from `tick`, `updateTaskTimespent` or `addTrackedSeconds`.
