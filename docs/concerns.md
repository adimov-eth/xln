The WAL key structure ${s.height}:${tx.signer}:${tx.entityId} might not handle multiple transactions from the same signer/entity in one block

In applyServerBlock, you're pushing outbox messages back into the mempool of the same server state, which could lead to infinite loops if entities ping-pong messages

Creating new Maps for every state transition is going to create a lot of GC pressure. Have you profiled this under load? Might want to consider a more efficient immutable data structure library.

The WAL replay on startup could be slow if there are many transactions since the last snapshot. Maybe add progress logging there?

Resolution: Channel state as CRDT

. Time & Scheduling
typescripttype TimeEffect<T> = 
  | { tag: 'Delay', duration: Duration, cont: () => Effect<T> }
  | { tag: 'Timeout', deadline: Timestamp, effect: Effect<T>, onTimeout: () => T }
  | { tag: 'Schedule', cron: CronExpr, effect: Effect<void> };

// Temporal state machines
type TemporalTransition<S, E> = {
  on: (event: E) => S;
  after: (duration: Duration) => S;
  at: (timestamp: Timestamp) => S;
};