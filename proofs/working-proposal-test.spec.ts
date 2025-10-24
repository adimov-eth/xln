import { expect, Page, test } from '@playwright/test';

// Helper functions
async function setThreshold(page: Page, value: number) {
  const slider = page.locator('#thresholdSlider');
  await slider.evaluate((el: HTMLInputElement, v: number) => {
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

async function selectEntityAndSigner(page: Page, signerIndex: number) {
  // Wait for entity panels to be visible
  await page.waitForSelector('.entity-panel', { timeout: 5000 });

  // Click the first entity dropdown to select the entity
  const entityDropdown = page.locator('.unified-dropdown').first();
  await entityDropdown.click();
  await page.waitForTimeout(200);

  // Select the first entity that appears
  const firstEntity = page.locator('#dropdownResults .dropdown-item').first();
  await expect(firstEntity).toBeVisible();
  await firstEntity.click();
  await page.waitForTimeout(200);

  // Now select the signer (second dropdown)
  const signerDropdown = page.locator('.unified-dropdown').nth(1);
  await signerDropdown.click();
  await page.waitForTimeout(200);

  // Select the signer by index
  const signerOption = page.locator('#dropdownResults .dropdown-item').nth(signerIndex);
  await expect(signerOption).toBeVisible();
  await signerOption.click();
  await page.waitForTimeout(200);
}

test.describe('Working Proposal Test', () => {
  test('CREATE ENTITY -> PROPOSAL -> VOTING WORKFLOW', async ({ page }) => {
    console.log('[TAKE] Starting COMPLETE proposal workflow...');

    // Step 1: Navigate and wait for app
    await page.goto('http://localhost:8080');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => (window as any).xlnEnv !== undefined, { timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/working-01-loaded.png', fullPage: true });
    console.log('[CAM] Screenshot: App loaded');

    // Step 2: Create entity with validators
    console.log('[BUILD] STEP 2: Creating entity with alice and bob');

    await page.locator('text=Formation').click();
    await page.fill('#entityNameInput', 'Governance Entity');

    await addValidator(page);
    await pickSignerInRow(page, 0, 'alice');
    await pickSignerInRow(page, 1, 'bob');
    await setThreshold(page, 2); // Both must vote

    await page.screenshot({ path: 'e2e/screenshots/working-02-entity-form.png', fullPage: true });
    console.log('[CAM] Screenshot: Entity form filled');

    // Track state before creation
    const beforeState = await page.evaluate(() => {
      const env = (window as any).xlnEnv;
      return {
        replicas: env?.replicas?.size ?? 0,
        height: env?.height ?? 0,
      };
    });

    // Create entity
    await page.getByRole('button', { name: /Create Entity/i }).click();

    // Wait for entity creation (fast timeout)
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

    await page.screenshot({ path: 'e2e/screenshots/working-03-entity-created.png', fullPage: true });
    console.log('[OK] Entity created successfully');

    // Step 3: Select entity and Alice as signer
    console.log('[GOAL] STEP 3: Selecting entity and Alice as signer');
    // await selectEntityAndSigner(page, 0); // alice = index 0
    await expect(page.locator('.entity-panel').first()).toBeVisible();
    const firstPanel = page.locator('.entity-panel').first();
    expect(firstPanel.getByText('Signer: alice').first()).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/working-04-alice-selected.png', fullPage: true });
    console.log('[CAM] Screenshot: Alice selected as signer');

    // Step 4: Open entity panel and expand Controls
    console.log('[MEMO] STEP 4: Opening controls for proposal creation');

    // Find and click the Controls section header to expand it
    const controlsHeader = firstPanel.getByRole('button', { name: '[SET] Controls ▼' });
    await expect(controlsHeader).toBeVisible();
    await controlsHeader.click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/working-05-controls-expanded.png', fullPage: true });
    console.log('[CAM] Screenshot: Controls section expanded');

    // Step 5: Fill and submit proposal
    console.log('[WRITE] STEP 5: Creating proposal');

    // First, select "proposal" from the controls dropdown
    await firstPanel.getByRole('combobox').first().selectOption('proposal');
    await page.waitForTimeout(200);

    // Wait for proposal form fields to be visible
    await expect(firstPanel.getByRole('textbox', { name: 'Enter proposal title...' })).toBeVisible();
    await expect(firstPanel.getByRole('textbox', { name: 'Enter proposal description...' })).toBeVisible();

    // Fill proposal form
    await firstPanel.getByRole('textbox', { name: 'Enter proposal title...' }).fill('Q4 Budget Allocation');
    await firstPanel
      .getByRole('textbox', { name: 'Enter proposal description...' })
      .fill('Approve $100K budget for Q4 marketing campaign');

    await page.screenshot({ path: 'e2e/screenshots/working-06-proposal-form-filled.png', fullPage: true });
    console.log('[CAM] Screenshot: Proposal form filled');

    // Submit proposal
    await firstPanel.getByRole('button', { name: 'Create Proposal' }).click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/working-07-proposal-created.png', fullPage: true });
    console.log('[CAM] Screenshot: Proposal created');

    // Step 6: Verify proposal appears
    console.log('[FIND] STEP 6: Verifying proposal appears');

    // Expand Proposals section to see the proposal
    const proposalsHeader = firstPanel.getByRole('button', { name: '[LIST] Proposals ▼' });
    if (await proposalsHeader.isVisible()) {
      await proposalsHeader.click();
      await page.waitForTimeout(300);
    }

    // Check that proposal appears
    await expect(firstPanel.locator('.proposal-item')).toBeVisible();
    await expect(firstPanel.locator('#proposals-tab-1').getByText('Q4 Budget Allocation: Approve')).toBeVisible();

    console.log('[OK] Proposal visible in UI');

    // Step 7: Switch to Bob and vote
    console.log('[VOTE] STEP 7: Switching to Bob for voting');
    const secondPanel = page.locator('.entity-panel').nth(1);
    expect(secondPanel.getByText('Signer: bob').first()).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/working-08-bob-selected.png', fullPage: true });
    console.log('[CAM] Screenshot: Bob selected as signer');

    // Expand Bob's controls
    const bobControlsHeader = secondPanel.getByRole('button', { name: '[SET] Controls ▼' });
    await bobControlsHeader.click();
    await page.waitForTimeout(300);

    // Vote on the proposal
    console.log('[OK] Bob voting YES on the proposal...');

    // First, select "vote" from the controls dropdown
    await secondPanel.getByRole('combobox').selectOption('vote');
    await page.waitForTimeout(200);

    // Select the proposal in voting section
    await secondPanel.getByRole('combobox').nth(1).selectOption({ index: 1 });

    await page.waitForTimeout(200);

    // Choose YES vote
    await secondPanel.getByRole('combobox').nth(2).selectOption('yes');
    await secondPanel
      .getByRole('textbox', { name: 'Add a comment to your vote...' })
      .fill('I approve this budget allocation');

    // Submit vote
    await secondPanel.getByRole('button', { name: 'Submit Vote' }).click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/working-09-bob-voted.png', fullPage: true });
    console.log('[CAM] Screenshot: Bob voted');

    // Step 8: Verify final state
    console.log('[DONE] STEP 8: Verifying final proposal state');

    // Expand proposals section to check final status
    expect(proposalsHeader).toBeVisible();

    // Check that proposal is approved
    await expect(firstPanel.getByText('APPROVED')).toBeVisible();
    await expect(firstPanel.getByText('[OK] 2 yes')).toBeVisible(); // Both alice and bob voted yes

    // Check for collective message
    const chatMessages = firstPanel.locator('.chat-messages');
    expect(chatMessages).toBeVisible();

    // Verify collective message appears
    await expect(chatMessages).toContainText('[COLLECTIVE]');
    await expect(chatMessages).toContainText('Q4 Budget Allocation');

    await page.screenshot({ path: 'e2e/screenshots/working-10-final-success.png', fullPage: true });
    console.log('[CAM] Screenshot: Final success state');

    console.log('[DONE] COMPLETE SUCCESS!');
    console.log('[OK] Entity created with validators');
    console.log('[OK] Alice created proposal');
    console.log('[OK] Bob voted and approved proposal');
    console.log('[OK] Collective message executed');
    console.log('[OK] Full workflow completed successfully!');
  });
});
