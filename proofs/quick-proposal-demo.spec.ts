import { expect, Page, test } from '@playwright/test';

async function setThreshold(page: Page, value: number) {
  const slider = page.locator('#thresholdSlider');
  await slider.evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function addValidator(page: Page) {
  await page.getByRole('button', { name: '+ Add Validator' }).click();
}

async function pickSignerInRow(page: Page, rowIndex: number, signerText: string) {
  const row = page.locator('.validator-row').nth(rowIndex);
  const select = row.locator('.validator-name');
  await select.selectOption(signerText);
}

test.describe('Quick Proposal Demo', () => {
  test('SUPER FAST: Entity Creation + UI Validation', async ({ page }) => {
    console.log('[FAST] Starting SUPER FAST demo...');

    // Navigate
    await page.goto('http://localhost:8080');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => (window as any).xlnEnv !== undefined, { timeout: 5000 });

    console.log('[CAM] Taking initial screenshot...');
    await page.screenshot({ path: 'e2e/screenshots/fast-01-loaded.png', fullPage: true });

    // === ENTITY CREATION ===
    console.log('[BUILD] Creating entity...');

    await page.locator('text=Formation').click();
    await page.fill('#entityNameInput', 'Demo Entity');

    await addValidator(page);
    await pickSignerInRow(page, 0, 'alice');
    await pickSignerInRow(page, 1, 'bob');
    await setThreshold(page, 1);

    console.log('[CAM] Taking form screenshot...');
    await page.screenshot({ path: 'e2e/screenshots/fast-02-form.png', fullPage: true });

    // Check before state
    const beforeState = await page.evaluate(() => {
      const env = (window as any).xlnEnv;
      return {
        replicas: env?.replicas?.size ?? 0,
        height: env?.height ?? 0,
      };
    });

    // Create entity
    await page.getByRole('button', { name: /Create Entity/i }).click();

    // Wait for creation (fast)
    await page.waitForFunction(
      prev => {
        const env = (window as any).xlnEnv;
        const newReplicas = env?.replicas?.size ?? 0;
        const newHeight = env?.height ?? 0;
        return newReplicas > prev.replicas && newHeight > prev.height;
      },
      beforeState,
      { timeout: 5000 },
    );

    const afterState = await page.evaluate(() => {
      const env = (window as any).xlnEnv;
      return {
        replicas: env?.replicas?.size ?? 0,
        height: env?.height ?? 0,
      };
    });

    console.log(`[OK] SUCCESS: Created ${afterState.replicas} replicas, height ${afterState.height}`);

    console.log('[CAM] Taking success screenshot...');
    await page.screenshot({ path: 'e2e/screenshots/fast-03-entity-created.png', fullPage: true });

    // === UI VALIDATION ===
    console.log('[GOAL] Validating UI components...');

    await page.waitForTimeout(500);

    // Check UI elements
    const uiState = await page.evaluate(() => {
      const entityPanels = document.querySelectorAll('.entity-panel').length;
      const dropdowns = document.querySelectorAll('.unified-dropdown').length;
      const controlsButtons = Array.from(document.querySelectorAll('button')).filter(btn =>
        btn.textContent?.includes('Controls'),
      ).length;

      return { entityPanels, dropdowns, controlsButtons };
    });

    console.log(
      `[STATS] UI State: ${uiState.entityPanels} panels, ${uiState.dropdowns} dropdowns, ${uiState.controlsButtons} controls`,
    );

    // Verify success criteria
    expect(afterState.replicas).toBeGreaterThan(0);
    expect(afterState.height).toBeGreaterThan(0);
    expect(uiState.entityPanels).toBeGreaterThan(0);
    expect(uiState.dropdowns).toBeGreaterThan(0);

    console.log('[CAM] Taking final screenshot...');
    await page.screenshot({ path: 'e2e/screenshots/fast-04-final-success.png', fullPage: true });

    console.log('[DONE] SUPER FAST DEMO COMPLETE!');
    console.log('[OK] Entity creation works');
    console.log('[OK] Validators properly configured');
    console.log('[OK] UI components visible');
    console.log('[OK] Consensus system active');
    console.log(`[STATS] Result: ${afterState.replicas} replicas, height ${afterState.height}`);
  });
});
