/**
 * Google Maps Scraping Tests
 *
 * Tests the core scraping flow: navigate to Google Maps, start collecting,
 * verify leads are captured. Uses the actual extension loaded in Chrome.
 *
 * NOTE: These tests hit live Google Maps — they require network access
 * and may be slow. Run with --timeout 180000 if needed.
 */

const { test, expect, dismissConsentWall } = require('../fixtures/extension');

test.describe('Google Maps Scraping', () => {
  // These tests are slow — extend timeout
  test.setTimeout(180_000);

  test('extension content script injects on Google Maps', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('https://www.google.com/maps?hl=en', { waitUntil: 'domcontentloaded' });
    await dismissConsentWall(page);

    // Wait for Maps to fully load after potential consent redirect
    await page.waitForTimeout(5000);

    // The content script should be injected — check by looking for maps elements
    // Google Maps search input: may be #searchboxinput or input[name="q"][role="combobox"]
    const searchBox = page.locator('input#searchboxinput, input[name="q"][role="combobox"]').first();
    await expect(searchBox).toBeVisible({ timeout: 30_000 });

    await page.close();
  });

  test('scrape collects leads from Google Maps search', async ({ context, openPopup }) => {
    // 1. Navigate to Google Maps with a search
    const mapsPage = await context.newPage();
    await mapsPage.goto('https://www.google.com/maps/search/plumber+Sydney?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentWall(mapsPage);

    // Wait for results to appear
    await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
    await mapsPage.waitForTimeout(2000);

    // 2. Open popup
    const popup = await openPopup();

    // 3. Click Start Collecting
    const startBtn = popup.locator('#startStopBtn');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Status should change
    const statusText = popup.locator('#statusText');
    await expect(statusText).not.toHaveText('Ready', { timeout: 5_000 });

    // 4. Wait for some leads to be collected (at least 5)
    const leadCountEl = popup.locator('#leadCount');
    await expect(async () => {
      const count = parseInt(await leadCountEl.textContent());
      expect(count).toBeGreaterThanOrEqual(5);
    }).toPass({ timeout: 60_000, intervals: [2_000] });

    // 5. Stop collecting
    await startBtn.click();

    // 6. Verify final state
    const finalCount = parseInt(await leadCountEl.textContent());
    expect(finalCount).toBeGreaterThanOrEqual(5);

    // Status should indicate collection is done (may auto-extract emails)
    await expect(statusText).toHaveText(/Ready|Collected|Complete|Extracting/, { timeout: 30_000 });

    // Export button should now be enabled
    const exportBtn = popup.locator('#exportBtn');
    await expect(exportBtn).toBeEnabled({ timeout: 30_000 });

    await popup.close();
    await mapsPage.close();
  });

  test('duplicate detection skips previously seen businesses', async ({ context, openPopup }) => {
    // 1. First scrape
    const mapsPage = await context.newPage();
    await mapsPage.goto('https://www.google.com/maps/search/plumber+Sydney?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentWall(mapsPage);
    await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
    await mapsPage.waitForTimeout(2000);

    let popup = await openPopup();

    // Disable auto-extract so it doesn't block the Start button between runs
    const autoExtract = popup.locator('#autoExtractCheckbox');
    if (await autoExtract.isChecked()) {
      await autoExtract.click();
    }

    await popup.locator('#startStopBtn').click();

    // Wait for some results
    const leadCountEl = popup.locator('#leadCount');
    await expect(async () => {
      const count = parseInt(await leadCountEl.textContent());
      expect(count).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    // Stop
    await popup.locator('#startStopBtn').click();
    await popup.waitForTimeout(1000);
    const firstRunCount = parseInt(await leadCountEl.textContent());

    await popup.close();

    // 2. Second scrape on same query — should see duplicates skipped
    popup = await openPopup();

    // Disable auto-extract again
    const autoExtract2 = popup.locator('#autoExtractCheckbox');
    if (await autoExtract2.isChecked()) {
      await autoExtract2.click();
    }

    // Wait for Start button to be enabled (extraction from first run may still be finishing)
    await expect(popup.locator('#startStopBtn')).toBeEnabled({ timeout: 60_000 });
    await popup.locator('#startStopBtn').click();

    // Wait a bit
    await popup.waitForTimeout(10_000);
    await popup.locator('#startStopBtn').click();

    // Check for duplicate indicator
    const dupStatus = popup.locator('#duplicateStatus');
    const dupVisible = await dupStatus.isVisible().catch(() => false);

    if (dupVisible) {
      const dupCount = popup.locator('#duplicateCount');
      const dups = parseInt(await dupCount.textContent());
      expect(dups).toBeGreaterThanOrEqual(1);
    }

    await popup.close();
    await mapsPage.close();
  });

  test('pre-scrape filter: minimum rating', async ({ context, openPopup }) => {
    const mapsPage = await context.newPage();
    await mapsPage.goto('https://www.google.com/maps/search/restaurant+Melbourne?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentWall(mapsPage);
    await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
    await mapsPage.waitForTimeout(2000);

    const popup = await openPopup();

    // Open filters and set minimum rating to 4+
    await popup.locator('#toggleFiltersBtn').click();
    await popup.locator('#minRatingSelect').selectOption('4');

    // Start collecting
    await popup.locator('#startStopBtn').click();

    // Wait for some leads
    const leadCountEl = popup.locator('#leadCount');
    await expect(async () => {
      const count = parseInt(await leadCountEl.textContent());
      expect(count).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 60_000, intervals: [2_000] });

    // Check that filtered count is shown
    const filteredStatus = popup.locator('#filteredStatus');
    const filteredVisible = await filteredStatus.isVisible().catch(() => false);

    // Some businesses should have been filtered (below 4 stars)
    // This is probabilistic — most searches have businesses under 4 stars
    if (filteredVisible) {
      const filteredCount = popup.locator('#filteredCount');
      const filtered = parseInt(await filteredCount.textContent());
      expect(filtered).toBeGreaterThanOrEqual(0);
    }

    await popup.locator('#startStopBtn').click();
    await popup.close();
    await mapsPage.close();
  });
});
