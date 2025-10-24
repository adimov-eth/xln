# E2E Testing Quick Start

## [WARN] PREREQUISITE: Server Must Be Running

**E2E tests will fail with "Connection Refused" if the dev server isn't running.**

## Running Your First E2E Test

### 1. Start the Development Server (REQUIRED)

**In a separate terminal, run:**

```bash
bun run dev
```

**Wait for this confirmation:**
```
[OK] [OK] [OK] DEVELOPMENT ENVIRONMENT READY [OK] [OK] [OK]

[WEB] Frontend: http://localhost:8080
[WEB] HTTPS:    https://localhost:8080  [LEFTWARDS] E2E tests use HTTPS
[LINK] Blockchain: http://localhost:8545 (anvil)
[PKG] Auto-rebuild: Enabled (runtime.js + frontend)
```

**Keep this terminal running.** All E2E tests require:
- [OK] HTTPS server at https://localhost:8080
- [OK] Anvil blockchain at http://localhost:8545
- [OK] Auto-rebuild watching for changes

### 2. Run the Smoke Test

Ask Claude Code:

```
Run E2E smoke test
```

Or manually navigate:

```
Navigate to https://localhost:8080 and verify XLN loads
```

### 3. Claude Will Execute

Claude uses Playwright MCP tools to:

1. **Navigate**: Opens browser to https://localhost:8080
2. **Snapshot**: Captures page accessibility tree
3. **Evaluate**: Runs JavaScript to check window.XLN
4. **Verify**: Confirms no console errors
5. **Screenshot**: Saves visual proof

### 4. View Results

Check screenshots:
```bash
open tests/e2e/screenshots/
```

## Example Test Session

**User:** "Run E2E smoke test"

**Claude:**
```
[TEST] Running Smoke Test...

1. Navigating to https://localhost:8080
   [OK] Page loaded

2. Checking XLN runtime
   [OK] window.XLN exists
   [OK] window.xlnEnv exists

3. Verifying environment state
   Height: 0
   Replicas: 0
   [OK] Initial state correct

4. Checking console errors
   [OK] No errors found

5. Taking screenshot
   [CAM] Saved: smoke-test-2025-10-10.png

[OK] SMOKE TEST PASSED
```

## Available Tests

| Test | Command | Duration |
|------|---------|----------|
| Smoke | `Run E2E smoke test` | ~5s |
| Entity Creation | `Run E2E entity creation test` | ~10s |
| Payment Flow | `Run E2E payment flow test` | ~15s |

## Troubleshooting

**Error: `net::ERR_CONNECTION_REFUSED at https://localhost:8080/`**

This means the dev server isn't running.

**Fix:**
1. Open a new terminal
2. Run: `bun run dev`
3. Wait for "DEVELOPMENT ENVIRONMENT READY"
4. Keep that terminal open
5. Now run E2E tests

---

**Error: `net::ERR_CERT_AUTHORITY_INVALID` (HTTPS certificate)**

XLN uses self-signed HTTPS certificates for localhost.

**Fix:**
- Playwright should automatically accept self-signed certs
- If it doesn't, navigate manually once in Chrome and accept the certificate
- Or use HTTP for testing: Update tests to use `http://localhost:8080`

---

**Error: XLN not defined**
[RIGHTWARDS] Wait for runtime to load (use `waitForXLNReady()`)

---

**Error: Blockchain tx failed**
[RIGHTWARDS] Check Anvil is running (should start automatically with `bun run dev`)

## Next Steps

1. [OK] Run smoke test
2. Run entity creation test
3. Run payment flow test
4. Write custom tests for your features

See `tests/e2e/README.md` for full documentation.
