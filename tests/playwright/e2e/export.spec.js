/**
 * Export & CSV Tests
 *
 * Verifies CSV export functionality, field selection, and export filters.
 * Requires leads to be collected first, so includes a scraping step.
 */

const { test, expect, dismissConsentWall } = require('../fixtures/extension');
const fs = require('fs');
const path = require('path');

test.describe('Export & CSV', () => {
  test.setTimeout(180_000);

  test('CSV export downloads with correct headers', async ({ context, openPopup }) => {
    // 1. Navigate and scrape a few leads
    const mapsPage = await context.newPage();
    await mapsPage.goto('https://www.google.com/maps/search/cafe+Brisbane?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentWall(mapsPage);
    await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
    await mapsPage.waitForTimeout(2000);

    const popup = await openPopup();

    // Uncheck auto-extract so we can export immediately after scraping
    const autoExtract = popup.locator('#autoExtractCheckbox');
    if (await autoExtract.isChecked()) {
      await autoExtract.click();
    }

    // Start collecting
    await popup.locator('#startStopBtn').click();

    // Wait for leads
    const leadCountEl = popup.locator('#leadCount');
    await expect(async () => {
      const count = parseInt(await leadCountEl.textContent());
      expect(count).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 60_000, intervals: [2_000] });

    // Stop
    await popup.locator('#startStopBtn').click();
    await popup.waitForTimeout(1000);

    // 2. Set up download listener and click Export
    const downloadPromise = popup.waitForEvent('download', { timeout: 15_000 });
    const exportBtn = popup.locator('#exportBtn');
    await expect(exportBtn).toBeEnabled({ timeout: 5_000 });
    await exportBtn.click();

    // 3. Verify download
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/\.csv$/);

    // Save and read the CSV
    const downloadPath = path.join(__dirname, '..', 'test-results', filename);
    await download.saveAs(downloadPath);

    const csvContent = fs.readFileSync(downloadPath, 'utf-8');
    const lines = csvContent.split('\n').filter((l) => l.trim());

    // Should have header + at least 3 data rows
    expect(lines.length).toBeGreaterThanOrEqual(4);

    // Header should contain expected fields (lowercase, may have BOM prefix)
    const header = lines[0].toLowerCase();
    expect(header).toContain('name');
    expect(header).toContain('rating');
    expect(header).toContain('address');
    expect(header).toContain('phone');

    // Clean up
    fs.unlinkSync(downloadPath);
    await popup.close();
    await mapsPage.close();
  });

  test('field deselection removes column from CSV', async ({ context, openPopup }) => {
    // Navigate and scrape
    const mapsPage = await context.newPage();
    await mapsPage.goto('https://www.google.com/maps/search/dentist+Sydney?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentWall(mapsPage);
    await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
    await mapsPage.waitForTimeout(2000);

    const popup = await openPopup();

    // Disable auto-extract
    const autoExtract = popup.locator('#autoExtractCheckbox');
    if (await autoExtract.isChecked()) {
      await autoExtract.click();
    }

    await popup.locator('#startStopBtn').click();

    const leadCountEl = popup.locator('#leadCount');
    await expect(async () => {
      const count = parseInt(await leadCountEl.textContent());
      expect(count).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 60_000, intervals: [2_000] });

    await popup.locator('#startStopBtn').click();
    await popup.waitForTimeout(1000);

    // Open field customization and uncheck "Rating"
    await popup.locator('#toggleFieldsBtn').click();
    const ratingField = popup.locator('input[data-field="rating"]');
    if (await ratingField.isChecked()) {
      await ratingField.click();
    }

    // Export
    const downloadPromise = popup.waitForEvent('download', { timeout: 15_000 });
    await popup.locator('#exportBtn').click();
    const download = await downloadPromise;

    const downloadPath = path.join(__dirname, '..', 'test-results', download.suggestedFilename());
    await download.saveAs(downloadPath);

    const csvContent = fs.readFileSync(downloadPath, 'utf-8');
    const header = csvContent.split('\n')[0];

    // Rating should NOT be in header (lowercase, may have BOM prefix)
    expect(header.toLowerCase()).not.toContain('rating');

    // But Name should still be there
    expect(header.toLowerCase()).toContain('name');

    fs.unlinkSync(downloadPath);
    await popup.close();
    await mapsPage.close();
  });

  test('Clear Results button appears and works', async ({ context, openPopup }) => {
    const mapsPage = await context.newPage();
    await mapsPage.goto('https://www.google.com/maps/search/bakery+Perth?hl=en', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await dismissConsentWall(mapsPage);
    await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
    await mapsPage.waitForTimeout(2000);

    const popup = await openPopup();

    // Disable auto-extract
    const autoExtract = popup.locator('#autoExtractCheckbox');
    if (await autoExtract.isChecked()) {
      await autoExtract.click();
    }

    await popup.locator('#startStopBtn').click();

    const leadCountEl = popup.locator('#leadCount');
    await expect(async () => {
      const count = parseInt(await leadCountEl.textContent());
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 60_000, intervals: [2_000] });

    await popup.locator('#startStopBtn').click();
    await popup.waitForTimeout(1000);

    // Clear Results button should be visible
    const clearBtn = popup.locator('#clearResultsBtn');
    await expect(clearBtn).toBeVisible({ timeout: 5_000 });

    // Click clear
    await clearBtn.click();

    // Lead count should reset to 0
    await expect(leadCountEl).toHaveText('0', { timeout: 5_000 });

    // Export button should be disabled again
    const exportBtn = popup.locator('#exportBtn');
    await expect(exportBtn).toBeDisabled();

    await popup.close();
    await mapsPage.close();
  });
});
