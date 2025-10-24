import { expect, test } from './global-setup';

test('Gossip + Account Input UI Flow', async ({ page }) => {
  // === STEP 1: Navigate and Setup ===
  console.log('[PIN] STEP 1: Navigate to XLN and wait for environment');

  await page.goto('http://localhost:8080');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => (window as any).xlnEnv !== undefined, { timeout: 10000 });
  await page.waitForTimeout(1000); // Allow page to fully render

  // Run demo to create entities (alice, bob, chat, trading, governance entities)
  console.log('[ROLES] Creating demo entities...');
  await page.locator('button[title="Run Demo"]').click();
  await page.waitForTimeout(2000); // Wait for demo to complete
  console.log('[OK] Demo entities created successfully');

  console.log('[GOAL] Adding entity panel and selecting Alice...');
  await page.locator('.admin-topbar').getByTitle('Add Entity Panel').click();
  await page.waitForTimeout(800); // Allow panel to appear

  // Select Alice first
  const firstPanel = page.locator('.entity-panel').first();
  const entityDropdown = firstPanel.locator('.unified-dropdown').first();
  await entityDropdown.click();
  await page.waitForTimeout(300);

  const aliceOption = firstPanel
    .locator('[data-value="Ethereum:alice:0x2bd72c34b6cf4dc3580ab7b8c06319fa71b23df11c016e9d834f8f5222104803"]')
    .first();
  await aliceOption.click();
  await page.waitForTimeout(500);
  console.log('[OK] Alice entity selected in panel');

  // === STEP 2: Navigate to Network Tab ===
  console.log('[PIN] STEP 2: Navigate to Network Directory tab');

  const networkTab = page.locator('#networkTab');
  await expect(networkTab).toBeVisible();
  await networkTab.click();
  await page.waitForTimeout(800); // Allow tab switch animation
  console.log('[ANTENNA] Clicked Network Directory tab');

  // Wait for Network Directory to be visible
  await expect(page.locator('.network-directory')).toBeVisible();
  await page.waitForTimeout(600); // Allow network directory to fully load
  console.log('[OK] Network Directory loaded successfully');

  // === STEP 3: Announce gossip profile using UI ===
  console.log("[PIN] STEP 3: Creating and announcing Alice's hub profile");
  const myProfileButton = page.getByRole('button', { name: '> [USER] My Profile' });
  await expect(myProfileButton).toBeVisible();
  await myProfileButton.click();
  await page.waitForTimeout(700); // Allow profile form to expand
  console.log('[USER] Opened My Profile form');

  await page.getByTestId('capabilities-multiselect').click();
  await page.getByRole('option', { name: 'trading' }).click();
  await page.getByRole('option', { name: 'routing' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500); // Allow multiselect to close
  console.log('[SET] Selected trading and routing capabilities');

  await page.getByText('* Register as Hub').click();
  await page.getByRole('textbox', { name: 'Hub Name:' }).fill('HubX1');
  await page.waitForTimeout(500); // Allow text input to register
  console.log('* Configured Alice as Hub with name "HubX1"');

  await page.getByTestId('announce-profile-button').click();
  await page.waitForTimeout(1200); // Allow profile announcement and card creation
  console.log("[PA] Announced Alice's hub profile to gossip layer");

  const aliceProfileCard = page.getByTestId('profile-card').first();
  await aliceProfileCard.scrollIntoViewIfNeeded();
  await expect(aliceProfileCard).toBeVisible();
  console.log("[JOKER] Alice's profile card appeared in Network Directory");

  await expect(aliceProfileCard.getByText('[OFFICE] HubX').first()).toBeVisible();
  await expect(aliceProfileCard.getByText('* Hub').first()).toBeVisible();
  await expect(aliceProfileCard.getByText('name: "HubX1"').first()).toBeVisible();
  await expect(aliceProfileCard.getByText('Your Hub').first()).toBeVisible();
  await page.waitForTimeout(800); // Allow profile card to fully render
  console.log("[OK] Verified Alice's hub profile details and 'Your Hub' status");

  // === STEP 4: Choose Bob as the entity to join the hub ===
  console.log('[PIN] STEP 4: Switching to Bob to test hub joining functionality');
  await entityDropdown.click();
  await page.waitForTimeout(300);

  const bobOption = firstPanel
    .locator('[data-value="Ethereum:bob:0x37214fa5196f5bba427e84b86e317c1b1829fe5010069dce10cd795cbc48dd66"]')
    .first();
  await bobOption.click();
  await page.waitForTimeout(800); // Allow entity switch and UI update
  console.log('[USER] Switched to Bob entity');

  await aliceProfileCard.getByTestId('join-hub-button').first().scrollIntoViewIfNeeded();
  await expect(aliceProfileCard.getByTestId('join-hub-button').first()).toBeVisible();
  await page.waitForTimeout(600); // Allow button state to update
  console.log("[HANDSHAKE] Found 'Join Hub' button for Alice's hub (Bob's perspective)");

  await aliceProfileCard.getByTestId('join-hub-button').first().click();
  await page.waitForTimeout(1000); // Allow channel creation and UI update
  console.log('[LINK] Bob clicked "Join Hub" button - creating symmetric channel');

  await expect(aliceProfileCard.getByText('[OK] Already joined this hub').first()).toBeVisible();
  await page.waitForTimeout(800); // Allow status change to be visible
  console.log('[OK] UI updated to show "Already joined this hub" status');

  // === STEP 5: Verify Bob's account channels ===
  console.log("[PIN] STEP 5: Verifying Bob's account channels show connection to Alice");

  await firstPanel.getByRole('button', { name: '[LINK] Account Channels ▼' }).scrollIntoViewIfNeeded();
  await expect(firstPanel.getByRole('button', { name: '[LINK] Account Channels ▼' })).toBeVisible();

  await firstPanel.getByRole('button', { name: '[LINK] Account Channels ▼' }).click();
  await page.waitForTimeout(700); // Allow channels section to expand
  console.log("[LINK] Expanded Bob's Account Channels section");

  await expect(
    firstPanel
      .getByTestId('account-channels')
      .first()
      .getByText('[OFFICE] 0x2bd72c34b6cf4dc3580ab7b8c06319fa71b23df11c016e9d834f8f5222104803')
      .first(),
  ).toBeVisible();
  await page.waitForTimeout(600); // Allow channel data to be visible
  console.log("[OK] Verified Bob has channel with Alice (Alice's entity ID visible)");

  // === STEP 6: Switch to Alice and verify symmetric account channels ===
  console.log('[PIN] STEP 6: Switching back to Alice to verify symmetric channel creation');

  await entityDropdown.click();
  await page.waitForTimeout(300);
  await aliceOption.click();
  await page.waitForTimeout(800); // Allow entity switch back to Alice
  console.log('[USER] Switched back to Alice entity');

  await expect(
    firstPanel
      .getByTestId('account-channels')
      .first()
      .getByText('[OFFICE] 0x37214fa5196f5bba427e84b86e317c1b1829fe5010069dce10cd795cbc48dd66')
      .first(),
  ).toBeVisible();
  await page.waitForTimeout(1000); // Final pause to show completed state
  console.log("[OK] Verified Alice has symmetric channel with Bob (Bob's entity ID visible)");
  console.log('[DONE] TEST COMPLETED: Gossip + Account Input UI Flow successful!');
  console.log('   - Alice announced hub profile to gossip layer');
  console.log("   - Bob successfully joined Alice's hub");
  console.log('   - Symmetric channels created between Alice and Bob');
  console.log('   - UI correctly shows channel status from both perspectives');
});
