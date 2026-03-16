/**
 * Takes a high-res screenshot of the extension popup with realistic data.
 * Run: cd tests/playwright && xvfb-run node screenshot.js
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const USER_DATA_DIR = path.join(__dirname, '.screenshot-chrome-profile');

async function dismissConsentWall(page) {
  try {
    const consentBtn = page.locator(
      'button:has-text("Accept all"), button:has-text("Alle akzeptieren"), button:has-text("Hyväksy kaikki"), form[action*="consent"] button:first-of-type'
    );
    const visible = await consentBtn.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (visible) {
      await consentBtn.first().click();
      await page.waitForURL(/google\.com\/maps/, { timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2_000);
    }
  } catch {}
}

(async () => {
  // Clean profile
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-sandbox',
      '--disable-default-apps',
      '--disable-search-engine-choice-screen',
      '--no-default-browser-check',
      '--headless=new',
    ],
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    deviceScaleFactor: 3, // 3x resolution for crisp screenshot
  });

  // Discover extension ID
  let extensionId;
  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    extensionId = workers[0].url().split('/')[2];
  } else {
    const sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    extensionId = sw.url().split('/')[2];
  }
  console.log('Extension ID:', extensionId);

  // Navigate to Google Maps with a search
  const mapsPage = await context.newPage();
  await mapsPage.goto('https://www.google.com/maps/search/plumber+Sydney?hl=en', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await dismissConsentWall(mapsPage);
  await mapsPage.waitForSelector('div[role="article"], div[role="feed"]', { timeout: 20_000 });
  await mapsPage.waitForTimeout(3000);

  // Open popup with the chrome.tabs.query patch
  const mapsTabUrl = mapsPage.url();
  await mapsPage.bringToFront();

  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const popupPage = await context.newPage();

  await popupPage.addInitScript(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const originalQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = function (queryInfo) {
        if (queryInfo.active && queryInfo.currentWindow) {
          return originalQuery({}).then((allTabs) => {
            const mapsTab = allTabs.find((t) => t.url && t.url.includes('google.com/maps'));
            return mapsTab ? [mapsTab] : originalQuery(queryInfo);
          });
        }
        return originalQuery(queryInfo);
      };
    }
  });

  await popupPage.goto(popupUrl);
  await popupPage.waitForLoadState('domcontentloaded');
  await popupPage.waitForTimeout(1000);

  // Start scraping to get some real data
  const startBtn = popupPage.locator('#startStopBtn');
  const isEnabled = await startBtn.isEnabled({ timeout: 10_000 }).catch(() => false);

  if (isEnabled) {
    await startBtn.click();

    // Wait for a good number of leads
    const leadCountEl = popupPage.locator('#leadCount');
    let collected = false;
    for (let i = 0; i < 30; i++) {
      await popupPage.waitForTimeout(2000);
      const count = parseInt(await leadCountEl.textContent());
      if (count >= 8) {
        collected = true;
        break;
      }
    }

    // Stop collecting
    await startBtn.click();
    await popupPage.waitForTimeout(1500);
  }

  // Take screenshot of just the popup content
  const outputDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Screenshot 1: Full popup as-is (with leads collected)
  await popupPage.screenshot({
    path: path.join(outputDir, 'popup-with-data.png'),
    fullPage: true,
  });
  console.log('Saved: screenshots/popup-with-data.png');

  // Screenshot 2: Clip to just the popup body (no browser chrome)
  // The popup has a fixed width of ~350px — let's get its bounding box
  const body = popupPage.locator('body');
  const box = await body.boundingBox();
  if (box) {
    await popupPage.screenshot({
      path: path.join(outputDir, 'popup-cropped.png'),
      clip: { x: 0, y: 0, width: Math.min(box.width, 400), height: box.height },
    });
    console.log('Saved: screenshots/popup-cropped.png');
  }

  // Screenshot 3: Fresh/clean state popup (no data, ready state)
  const cleanPopup = await context.newPage();
  await cleanPopup.addInitScript(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const originalQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = function (queryInfo) {
        if (queryInfo.active && queryInfo.currentWindow) {
          return originalQuery({}).then((allTabs) => {
            const mapsTab = allTabs.find((t) => t.url && t.url.includes('google.com/maps'));
            return mapsTab ? [mapsTab] : originalQuery(queryInfo);
          });
        }
        return originalQuery(queryInfo);
      };
    }
  });
  await cleanPopup.goto(popupUrl);
  await cleanPopup.waitForLoadState('domcontentloaded');
  await cleanPopup.waitForTimeout(1000);

  await cleanPopup.screenshot({
    path: path.join(outputDir, 'popup-clean.png'),
    fullPage: true,
  });
  console.log('Saved: screenshots/popup-clean.png');

  await context.close();

  // Clean up profile
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });

  console.log('\nDone! Screenshots saved to tests/playwright/screenshots/');
  console.log('At 3x device scale factor for crisp rendering.');
})();
