# E2E Test: Complete Payment Flow

**Purpose:** Test full payment lifecycle (account opening [RIGHTWARDS] payment [RIGHTWARDS] settlement)

## Test Steps

1. Create Entity A (Alice)
2. Create Entity B (Bob)
3. Open account: Alice [RIGHTWARDS] Bob
4. Wait for bilateral consensus
5. Verify account exists in both entities
6. Send payment: Alice [RIGHTWARDS] Bob (100 USDC)
7. Verify bilateral frame propagation
8. Check balance updates
9. Verify state roots match

## Expected Results

### Account Opening
- Both entities create AccountMachine
- Initial deltas: {balance: 0, creditLimit: 1000, collateral: 0}
- Bilateral consensus: INIT [RIGHTWARDS] frame exchanged

### Payment Processing
- Alice creates payment tx
- Bilateral consensus: PROPOSE [RIGHTWARDS] SIGN [RIGHTWARDS] COMMIT
- Both compute identical state root
- Account frame height increments

### Balance Verification
- Alice balance: -100
- Bob balance: +100
- State roots match (consensus verified)

## Success Criteria

[OK] Account opened bilaterally
[OK] Payment processed via consensus
[OK] Balances updated correctly
[OK] State roots identical
[OK] No consensus failures
[OK] Frame history recorded
