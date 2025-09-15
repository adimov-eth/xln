# Architecture Gaps (Reality Check)

Three engines run well in isolation — Trading, Channels, Consensus — but they don’t acknowledge each other. The result is phantom liquidity, non‑settled trades, and “theatrical” consensus.

## 1) Trades don’t change channels
- A trade executes: “Alice buys 100 USDC from Bob”.
- No channel settlement happens. Channel deltas/capacity stay unchanged.
- Next trade may rely on funds that were never actually moved.

Why it matters: the order book reflects intent, not enforceable capacity. You can “trade” forever without moving value.

## 2) Channels change, trading doesn’t know
- A channel rebalances, settles, or hits a dispute.
- The order book still assumes old capacity/limits.
- Subsequent orders may be unfillable or unsafe.

Why it matters: stale liquidity enables invalid matches and forces ad‑hoc failure paths.

## 3) Consensus commits are ignored
- Consensus records state/snapshots.
- Trading and channels don’t consume those commits.
- The agreed state is not the operating state.

Why it matters: consensus becomes a log for UI, not the source of truth. Disputes can’t be resolved deterministically.

## Smallest useful fix (doors between rooms)
No frameworks. No new object tax. Just events.

```ts
// When a trade happens → settle value
matchingEngine.on('trade', (match) => {
  // choose settlement path per side
  // custodial↔custodial: update balances atomically
  // trustless↔trustless or cross: build channel batch/HTLC and apply
  channels.settle(match);
});

// When channel capacity changes → update trading limits
enhancedChannel.on('update_applied', (state) => {
  orderBook.updateLiquidity(state); // reduce/remove orders, adjust limits
});

// When a dispute occurs → ask consensus to judge
enhancedChannel.on('channel_disputed', (evidence) => {
  consensus.propose('judge', evidence); // record and resolve deterministically
});
```

## Next steps (minimal, real)
- Add three handlers as above (one file of glue).
- Make one integration test: place orders → observe channel/state changes and a consensus record.
- Only after that: idempotency, retries, durable logs. Diagram tools become useful once the doors exist.
