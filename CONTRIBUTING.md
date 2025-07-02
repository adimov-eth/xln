_All business logic lives in `src/core` and must be pure functions._  
_Side-effects, timers, LevelDB, logs stay in `src/infra`._
Use RO-RO signatures: `(state, input) → { state, outbox }`.  
Follow Prettier + ESLint rules (`bun run format`, `bun run lint`).
