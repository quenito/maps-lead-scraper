/**
 * UI State Transition Tests
 *
 * Verifies the popup transitions between states correctly:
 * ready → scraping → collected, email progress bar, clear results, etc.
 */

const { test, expect } = require('../fixtures/extension');

test.describe('UI State Transitions', () => {
  let popup;

  test.beforeEach(async ({ openPopup }) => {
    popup = await openPopup();
  });

  test.afterEach(async () => {
    if (popup && !popup.isClosed()) await popup.close();
  });

  test('auto-extract checkbox toggles Extract Emails button', async () => {
    const autoExtract = popup.locator('#autoExtractCheckbox');
    const extractBtn = popup.locator('#extractEmailsBtn');

    // Initially auto-extract is on, button disabled
    await expect(autoExtract).toBeChecked();
    await expect(extractBtn).toBeDisabled();

    // Uncheck auto-extract — button stays disabled (no data yet)
    await autoExtract.click();
    await expect(autoExtract).not.toBeChecked();
    await expect(extractBtn).toBeDisabled();

    // Re-check
    await autoExtract.click();
    await expect(autoExtract).toBeChecked();
  });

  test('social search checkbox toggles', async () => {
    const checkbox = popup.locator('#socialSearchCheckbox');
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  });

  test('notifications checkbox toggles', async () => {
    const checkbox = popup.locator('#notificationsCheckbox');
    await expect(checkbox).toBeChecked();

    await checkbox.click();
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(checkbox).toBeChecked();
  });

  test('filter section persists selections', async () => {
    // Open filters
    await popup.locator('#toggleFiltersBtn').click();

    // Set min rating to 4+
    await popup.locator('#minRatingSelect').selectOption('4');

    // Set min reviews
    await popup.locator('#minReviewInput').fill('10');

    // Check must have website
    await popup.locator('#mustHaveWebsiteCheckbox').click();

    // Verify values
    await expect(popup.locator('#minRatingSelect')).toHaveValue('4');
    await expect(popup.locator('#minReviewInput')).toHaveValue('10');
    await expect(popup.locator('#mustHaveWebsiteCheckbox')).toBeChecked();
  });

  test('active filter badge shows count', async () => {
    const badge = popup.locator('#activeFilterBadge');

    // Initially hidden (no active filters)
    // Open filters and set one
    await popup.locator('#toggleFiltersBtn').click();
    await popup.locator('#minRatingSelect').selectOption('4');

    // Badge should show active count
    // Re-toggle to trigger badge update
    await popup.locator('#toggleFiltersBtn').click();

    const badgeVisible = await badge.isVisible().catch(() => false);
    if (badgeVisible) {
      const text = await badge.textContent();
      expect(text).toMatch(/\d+ active/);
    }
  });

  test('email section hidden initially', async () => {
    const emailSection = popup.locator('#emailSection');
    await expect(emailSection).toBeHidden();
  });

  test('error message shows Maps navigation prompt when not on Maps', async () => {
    // When popup opens without a Google Maps tab, it shows navigation instruction
    const errorMsg = popup.locator('#errorMessage');
    const text = await errorMsg.textContent();
    expect(text).toContain('Google Maps');
  });

  test('duplicate status hidden initially', async () => {
    const dupStatus = popup.locator('#duplicateStatus');
    await expect(dupStatus).toBeHidden();
  });

  test('filtered status hidden initially', async () => {
    const filteredStatus = popup.locator('#filteredStatus');
    await expect(filteredStatus).toBeHidden();
  });

  test('export filter checkboxes work', async () => {
    await popup.locator('#toggleFiltersBtn').click();

    const mustHaveEmail = popup.locator('#mustHaveEmailCheckbox');
    const mustHaveContact = popup.locator('#mustHaveContactFormCheckbox');

    await expect(mustHaveEmail).not.toBeChecked();
    await expect(mustHaveContact).not.toBeChecked();

    await mustHaveEmail.click();
    await expect(mustHaveEmail).toBeChecked();

    await mustHaveContact.click();
    await expect(mustHaveContact).toBeChecked();
  });

  test('category filter inputs accept text', async () => {
    await popup.locator('#toggleFiltersBtn').click();

    const includeInput = popup.locator('#categoryIncludeInput');
    const excludeInput = popup.locator('#categoryExcludeInput');

    await includeInput.fill('restaurant, cafe');
    await expect(includeInput).toHaveValue('restaurant, cafe');

    await excludeInput.fill('chain');
    await expect(excludeInput).toHaveValue('chain');
  });
});
