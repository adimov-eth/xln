# E2E Test: Smoke Test

**Purpose:** Verify XLN loads and basic functionality works

## Test Steps

1. Navigate to https://localhost:8080
2. Wait for XLN runtime to load
3. Verify window.XLN exists
4. Verify window.xlnEnv exists
5. Check initial state (height=0, no entities)
6. Verify no console errors

## Expected Results

- Runtime loads successfully
- Environment initialized
- No JavaScript errors
- UI renders correctly

## Success Criteria

[OK] XLN runtime available
[OK] Environment store reactive
[OK] Zero console errors
[OK] Initial height = 0
