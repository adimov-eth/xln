import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log('📸 Simple debug of reserves UI...');
  
  // Go to page
  await page.goto('http://localhost:8080');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'docs/assets/simple-01-loaded.png', fullPage: true });
  console.log('✅ Page loaded');
  
  // Check what's on the page
  const pageTitle = await page.title();
  console.log('📄 Page title:', pageTitle);
  
  // Look for any selects/dropdowns
  const selects = await page.locator('select').count();
  console.log('📋 Number of select elements:', selects);
  
  if (selects > 0) {
    const firstSelect = page.locator('select').first();
    const options = await firstSelect.locator('option').allTextContents();
    console.log('📋 First select options:', options);
    
    // Try to select alice
    if (options.some(opt => opt.includes('alice'))) {
      await firstSelect.selectOption({ label: /alice/ });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'docs/assets/simple-02-alice-selected.png', fullPage: true });
      console.log('✅ Alice selected');
      
      // Look for component headers
      const headers = await page.locator('.component-header .component-title').allTextContents();
      console.log('📋 Component headers:', headers);
      
      // Check if Reserves header exists
      if (headers.some(h => h.includes('Reserves'))) {
        console.log('✅ Reserves header found!');
        await page.locator('.component-header:has(.component-title:has-text("Reserves"))').click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'docs/assets/simple-03-reserves-expanded.png', fullPage: true });
        console.log('✅ Reserves expanded');
      } else {
        console.log('❌ Reserves header not found');
      }
    }
  }
  
  await browser.close();
  console.log('🎉 Simple debug complete!');
})();
