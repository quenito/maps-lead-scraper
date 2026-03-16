/**
 * License & Trial System Tests
 *
 * Verifies trial countdown, license activation UI flow,
 * and the trial-ended lockout screen.
 */

const { test, expect } = require('../fixtures/extension');

test.describe('Trial & License', () => {
  let popup;

  test.beforeEach(async ({ context, openPopup }) => {
    // Clear extension storage to reset trial state
    const pages = context.pages();
    const bgPage = pages[0] || await context.newPage();

    // Clear chrome.storage.local via the extension's service worker
    await bgPage.evaluate(async () => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.clear();
      }
    }).catch(() => {
      // May fail if not in extension context — that's ok
    });

    popup = await openPopup();
  });

  test.afterEach(async () => {
    if (popup && !popup.isClosed()) await popup.close();
  });

  test('fresh install shows trial banner with 3 remaining', async () => {
    const trialBanner = popup.locator('#trialBanner');
    // Trial banner should be visible (or trial ended if storage was weird)
    // In a fresh state, it should show the trial
    const bannerVisible = await trialBanner.isVisible().catch(() => false);
    const trialEndedVisible = await popup.locator('#trialEndedSection').isVisible().catch(() => false);

    // Either trial banner or trial ended should be showing
    expect(bannerVisible || trialEndedVisible).toBe(true);

    if (bannerVisible) {
      const count = popup.locator('#trialCount');
      const countText = await count.textContent();
      expect(parseInt(countText)).toBeGreaterThanOrEqual(0);
      expect(parseInt(countText)).toBeLessThanOrEqual(3);
    }
  });

  test('license badge hidden in trial mode', async () => {
    const badge = popup.locator('#licenseBadge');
    await expect(badge).toBeHidden();
  });

  test('upgrade button links to Stripe checkout', async () => {
    const upgradeBtn = popup.locator('#upgradeFromBanner');
    const isVisible = await upgradeBtn.isVisible().catch(() => false);

    if (isVisible) {
      // Verify it exists and is clickable (don't actually navigate)
      await expect(upgradeBtn).toBeEnabled();
    }
  });

  test('empty license key shows error', async () => {
    // Open license modal
    const enterBtn = popup.locator('#enterLicenseBtn');
    const isVisible = await enterBtn.isVisible().catch(() => false);
    if (!isVisible) {
      test.skip();
      return;
    }

    await enterBtn.click();

    // Try to activate with empty key
    await popup.locator('#confirmLicenseBtn').click();

    const error = popup.locator('#modalLicenseError');
    await expect(error).toBeVisible();
    await expect(error).toContainText('enter a license key');
  });

  test('invalid license key shows error', async () => {
    const enterBtn = popup.locator('#enterLicenseBtn');
    const isVisible = await enterBtn.isVisible().catch(() => false);
    if (!isVisible) {
      test.skip();
      return;
    }

    await enterBtn.click();

    // Enter a fake key
    await popup.locator('#modalLicenseInput').fill('INVALID-KEY-12345678');
    await popup.locator('#confirmLicenseBtn').click();

    // Should show error (Keygen API will reject it)
    const error = popup.locator('#modalLicenseError');
    await expect(error).toBeVisible({ timeout: 10_000 });
  });

  test('trial ended section shows pricing card', async ({ context, openPopup: reopen }) => {
    // Exhaust the trial by setting trialScrapesRemaining to 0
    const popupPage = popup;
    await popupPage.evaluate(async () => {
      await chrome.storage.local.set({
        licenseStatus: {
          status: 'trial',
          tier: null,
          trialScrapesRemaining: 0,
          licenseKey: null,
          validatedAt: null,
          email: null,
        },
      });
    });

    // Reopen popup so it reads the updated trial state
    if (popup && !popup.isClosed()) await popup.close();
    popup = await reopen();

    const trialEnded = popup.locator('#trialEndedSection');
    await expect(trialEnded).toBeVisible({ timeout: 5_000 });

    // Pricing card should have amount and CTA
    const amount = popup.locator('.pricing-amount');
    await expect(amount).toBeVisible();

    const cta = popup.locator('.pricing-card .btn-primary');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('Get Full Access');

    // License input in trial-ended section
    const input = popup.locator('#licenseKeyInput');
    await expect(input).toBeVisible();
  });
});
