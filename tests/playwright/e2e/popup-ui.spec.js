/**
 * Popup UI State Tests
 *
 * Verifies the extension popup renders correctly and all UI elements
 * are present and interactive. Tests run against the actual extension
 * loaded in Chrome.
 */

const { test, expect } = require('../fixtures/extension');

test.describe('Popup UI', () => {
  let popup;

  test.beforeEach(async ({ openPopup }) => {
    popup = await openPopup();
  });

  test.afterEach(async () => {
    if (popup && !popup.isClosed()) await popup.close();
  });

  test('popup loads successfully', async () => {
    // Collect uncaught exceptions (not console.error — those are expected for non-Maps tabs)
    const pageErrors = [];
    popup.on('pageerror', (err) => pageErrors.push(err.message));

    await popup.waitForLoadState('networkidle');

    // Title should be present
    const title = await popup.title();
    expect(title).toBe('Google Maps Lead Scraper');

    // No uncaught JS exceptions
    expect(pageErrors).toHaveLength(0);
  });

  test('header renders with icon and title', async () => {
    const header = popup.locator('header h1');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Maps Lead Scraper');

    const icon = popup.locator('header .header-icon');
    await expect(icon).toBeVisible();
  });

  test('status section renders', async () => {
    const statusText = popup.locator('#statusText');
    await expect(statusText).toBeVisible();

    // When not on a Google Maps page, status shows Error (expected)
    // When on Google Maps, status shows Ready
    const text = await statusText.textContent();
    expect(['Ready', 'Error']).toContain(text);

    const leadCount = popup.locator('#leadCount');
    await expect(leadCount).toHaveText('0');
  });

  test('Start Collecting button is present', async () => {
    const btn = popup.locator('#startStopBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Start Collecting');
    // Button is disabled when not on Google Maps tab (expected)
  });

  test('Extract Emails button is present and disabled initially', async () => {
    const btn = popup.locator('#extractEmailsBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('Export CSV button is present and disabled initially', async () => {
    const btn = popup.locator('#exportBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('options checkboxes render correctly', async () => {
    const autoExtract = popup.locator('#autoExtractCheckbox');
    await expect(autoExtract).toBeVisible();
    await expect(autoExtract).toBeChecked();

    const notifications = popup.locator('#notificationsCheckbox');
    await expect(notifications).toBeVisible();
    await expect(notifications).toBeChecked();

    const socialSearch = popup.locator('#socialSearchCheckbox');
    await expect(socialSearch).toBeVisible();
    await expect(socialSearch).not.toBeChecked();
  });

  test('Lead Filters toggle opens filters section', async () => {
    const filtersSection = popup.locator('#filtersSection');
    await expect(filtersSection).toBeHidden();

    const toggle = popup.locator('#toggleFiltersBtn');
    await toggle.click();

    await expect(filtersSection).toBeVisible();
  });

  test('filter controls render with defaults', async () => {
    // Open filters
    await popup.locator('#toggleFiltersBtn').click();

    const minRating = popup.locator('#minRatingSelect');
    await expect(minRating).toHaveValue('0');

    const minReview = popup.locator('#minReviewInput');
    await expect(minReview).toHaveValue('0');

    const mustHaveWebsite = popup.locator('#mustHaveWebsiteCheckbox');
    await expect(mustHaveWebsite).not.toBeChecked();

    const mustHavePhone = popup.locator('#mustHavePhoneCheckbox');
    await expect(mustHavePhone).not.toBeChecked();
  });

  test('Customize Export Fields toggle opens fields section', async () => {
    const fieldsSection = popup.locator('#fieldsSection');
    await expect(fieldsSection).toBeHidden();

    const toggle = popup.locator('#toggleFieldsBtn');
    await toggle.click();

    await expect(fieldsSection).toBeVisible();
  });

  test('export field checkboxes render correctly', async () => {
    await popup.locator('#toggleFieldsBtn').click();

    // Name field should be checked and disabled (always required)
    const nameField = popup.locator('input[data-field="name"]');
    await expect(nameField).toBeChecked();
    await expect(nameField).toBeDisabled();

    // Email field should be checked and enabled
    const emailField = popup.locator('input[data-field="email"]');
    await expect(emailField).toBeChecked();
    await expect(emailField).toBeEnabled();

    // All expected fields exist
    const expectedFields = [
      'name', 'email', 'emailSource', 'rating', 'reviewCount',
      'category', 'address', 'phone', 'website', 'contactPageUrl',
      'hasContactForm', 'facebookUrl', 'instagramUrl', 'linkedinUrl',
      'twitterUrl', 'socialSearchUrl', 'googleMapsUrl'
    ];

    for (const field of expectedFields) {
      const checkbox = popup.locator(`input[data-field="${field}"]`);
      await expect(checkbox).toBeAttached();
    }
  });

  test('search history section renders', async () => {
    const historyHeader = popup.locator('#historyHeader');
    await expect(historyHeader).toBeVisible();

    // History list starts hidden
    const historyList = popup.locator('#historyList');
    await expect(historyList).toBeHidden();

    // Click to expand
    await historyHeader.click();
    await expect(historyList).toBeVisible();
  });

  test('footer shows version number and license link', async () => {
    const version = popup.locator('.version');
    await expect(version).toBeVisible();
    const versionText = await version.textContent();
    expect(versionText).toMatch(/^v\d+\.\d+\.\d+$/);

    const licenseBtn = popup.locator('#enterLicenseBtn');
    await expect(licenseBtn).toBeVisible();
  });

  test('license modal opens and closes', async () => {
    const modal = popup.locator('#licenseModal');
    await expect(modal).toBeHidden();

    // Open
    await popup.locator('#enterLicenseBtn').click();
    await expect(modal).toBeVisible();

    // Has input and buttons
    const input = popup.locator('#modalLicenseInput');
    await expect(input).toBeVisible();

    const activateBtn = popup.locator('#confirmLicenseBtn');
    await expect(activateBtn).toBeVisible();

    // Close via X button
    await popup.locator('#closeLicenseModalBtn').click();
    await expect(modal).toBeHidden();
  });

  test('license modal cancel button closes modal', async () => {
    await popup.locator('#enterLicenseBtn').click();
    const modal = popup.locator('#licenseModal');
    await expect(modal).toBeVisible();

    await popup.locator('#cancelLicenseBtn').click();
    await expect(modal).toBeHidden();
  });
});
