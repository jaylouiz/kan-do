---
paths:
  - "composables/useTaskTimerDriver.ts"
  - "lib/taskTimers.ts"
  - "store/tasks.ts"
  - "app.vue"
  - "composables/useWorkSessionTracking.ts"
  - "tests/e2e/timer-lifecycle.spec.ts"
---
# Task timer rules (#352)

- **Task timers (#352):** a task in Jetzt is timed by `useTaskTimerDriver` (started once in `app.vue`; the status decides, no card and no page involved), intervals live only in `lib/taskTimers.ts`. `task.timerId` is a handle of this page load (reset at driver start, never passed to `clearInterval`); stop a timer through `stopTaskTimer(id)` (`clearInterval(task.timerId)` is an ESLint error). Time while the app is closed is not counted.
- **Work sessions (#600):** the driver tells `composables/useWorkSessionTracking` where it arms and stops a timer (`armJetztTask`, `stopTaskTimer`, driver `stop`); the session list grows by that module's own 60 s heartbeat. Never write a session from `tick` or `updateTaskTimespent`.
