/**
 * Custom Playwright fixture that launches Chrome with the Maps Lead Scraper
 * extension loaded via --load-extension. Provides:
 *
 *   context  — BrowserContext with extension loaded
 *   extensionId — the chrome-extension:// ID (for opening popup directly)
 *   openPopup() — helper that navigates to the popup page
 *
 * Uses Playwright's bundled Chromium (Chrome for Testing) which handles
 * --load-extension correctly. System Chrome has compatibility issues.
 */

const { test: base, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../../../');
const USER_DATA_DIR = path.join(__dirname, '..', '.e2e-chrome-profile');

/**
 * Dismiss Google cookie consent wall if it appears.
 * VPS is in Helsinki so Google shows EU consent dialog.
 * After dismissal, waits for the redirect back to the target page.
 */
async function dismissConsentWall(page) {
  try {
    // Check if we landed on the consent page (consent.google.com or inline consent)
    const url = page.url();
    const isConsentPage = url.includes('consent.google') || url.includes('consent?');

    // Look for the consent "Accept all" button (multiple language variants)
    const consentBtn = page.locator(
      'button:has-text("Accept all"), button:has-text("Alle akzeptieren"), button:has-text("Hyväksy kaikki"), button:has-text("Accepter tout"), form[action*="consent"] button:first-of-type'
    );
    const visible = await consentBtn.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (visible) {
      await consentBtn.first().click();
      // Wait for redirect back to the target page after consent
      if (isConsentPage) {
        await page.waitForURL(/google\.com\/maps/, { timeout: 15_000 }).catch(() => {});
      }
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2_000);
    }
  } catch {
    // No consent wall — continue
  }
}

/**
 * Clean the Chrome profile directory to ensure idempotent test runs.
 * Preserves the directory structure but removes session/state data.
 */
function cleanChromeProfile() {
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true, mode: 0o755 });
}

const test = base.extend({
  // Override context to use persistent context with extension loaded
  context: async ({}, use) => {
    // Clean profile before each test suite for idempotent runs
    cleanChromeProfile();

    const headed = process.env.HEADED === '1';
    const launchArgs = [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-sandbox',
      '--disable-default-apps',
      '--disable-search-engine-choice-screen',
      '--no-default-browser-check',
    ];

    if (!headed) {
      launchArgs.push('--headless=new');
    }

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false, // Always false — --headless=new flag handles it
      // No executablePath — use Playwright's bundled Chromium (Chrome for Testing)
      args: launchArgs,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });

    await use(context);
    await context.close();
  },

  // Discover the extension's internal chrome-extension:// ID
  extensionId: async ({ context }, use) => {
    let extensionId;

    // Try existing service workers first
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      extensionId = workers[0].url().split('/')[2];
    } else {
      // Wait for service worker — MV3 extensions register on startup
      const sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
      extensionId = sw.url().split('/')[2];
    }

    if (!extensionId) {
      throw new Error('Could not discover extension ID. Is the extension loaded?');
    }

    await use(extensionId);
  },

  // Helper: opens the extension popup in a new tab and returns the Page.
  // Patches chrome.tabs.query so the popup sees the Maps tab as active,
  // since opening popup as a standalone tab makes IT the active tab.
  openPopup: async ({ context, extensionId }, use) => {
    const opener = async () => {
      // Find the Maps tab URL for the init script patch
      const pages = context.pages();
      const mapsPage = pages.find((p) => p.url().includes('google.com/maps'));

      if (mapsPage) {
        await mapsPage.bringToFront();
      }

      const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
      const page = await context.newPage();

      // Monkey-patch chrome.tabs.query BEFORE popup.js runs.
      // In Playwright, the popup opens as its own tab, so it becomes the
      // "active" tab. This patch makes queries for {active, currentWindow}
      // return the Maps tab instead.
      await page.addInitScript(() => {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          const originalQuery = chrome.tabs.query.bind(chrome.tabs);
          chrome.tabs.query = function (queryInfo) {
            if (queryInfo.active && queryInfo.currentWindow) {
              // Query ALL tabs and return the Maps tab instead
              return originalQuery({}).then((allTabs) => {
                const mapsTab = allTabs.find((t) => t.url && t.url.includes('google.com/maps'));
                return mapsTab ? [mapsTab] : originalQuery(queryInfo);
              });
            }
            return originalQuery(queryInfo);
          };
        }
      });

      await page.goto(popupUrl);
      await page.waitForLoadState('domcontentloaded');
      // Let popup.js query the active tab and initialize
      await page.waitForTimeout(1000);
      return page;
    };
    await use(opener);
  },
});

const { expect } = require('@playwright/test');

module.exports = { test, expect, dismissConsentWall };
