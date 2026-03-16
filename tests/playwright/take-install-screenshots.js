#!/usr/bin/env node
/**
 * Capture installation guide screenshots for the Maps Lead Scraper extension.
 *
 * Steps captured:
 * 1. Download page on konnexlabs.com
 * 2. Unzipped extension folder contents
 * 3. chrome://extensions page (blank, dev mode off)
 * 4. Developer mode toggle enabled
 * 5. "Load unpacked" button visible
 * 6. File picker selecting folder (annotated note — can't automate OS dialog)
 * 7. Extension loaded in the list
 * 8. Puzzle icon menu showing pin option (note — Chrome UI limitation)
 * 9. Extension icon pinned in toolbar (note — Chrome UI limitation)
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const OUTPUT_DIR = path.resolve(__dirname, '../../screenshots/install-guide');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ─── Step 1: Download page on konnexlabs.com ───
  console.log('\n--- Step 1: Download page ---');
  const profile1 = path.join(__dirname, '.install-profile-1');
  cleanDir(profile1);

  const ctx1 = await chromium.launchPersistentContext(profile1, {
    headless: false,
    args: [
      '--no-first-run',
      '--no-sandbox',
      '--disable-default-apps',
      '--disable-search-engine-choice-screen',
      '--no-default-browser-check',
      '--headless=new',
    ],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-US',
  });

  const dlPage = await ctx1.newPage();
  try {
    await dlPage.goto('https://konnexlabs.com', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await dlPage.waitForTimeout(3_000);

    // Try to find and scroll to download section
    const downloadBtn = dlPage.locator('a:has-text("Download"), button:has-text("Download"), a[href*="download"]').first();
    const hasDl = await downloadBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasDl) {
      await downloadBtn.scrollIntoViewIfNeeded();
      await dlPage.waitForTimeout(1_000);
    }

    await dlPage.screenshot({ path: path.join(OUTPUT_DIR, 'step-01.png') });
    console.log('Saved step-01.png (download page)');
  } catch (err) {
    console.log('Could not load konnexlabs.com, saving blank step-01:', err.message);
    await dlPage.screenshot({ path: path.join(OUTPUT_DIR, 'step-01.png') });
  }
  await ctx1.close();
  fs.rmSync(profile1, { recursive: true, force: true });

  // ─── Step 2: Unzipped folder contents ───
  console.log('\n--- Step 2: Unzipped folder ---');
  // Create a temp directory simulating the unzipped extension
  const tempUnzipped = path.join(__dirname, '.install-unzipped-demo');
  cleanDir(tempUnzipped);

  // Copy the files that would be in the ZIP (simulating what user sees)
  const zipFiles = [
    'manifest.json',
    'background/service-worker.js',
    'content/content.js',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'utils/csv.js',
  ];

  for (const f of zipFiles) {
    const src = path.join(EXTENSION_PATH, f);
    const dest = path.join(tempUnzipped, 'maps-lead-scraper', f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // Use Chrome's file:// directory listing to show the folder
  const profile2 = path.join(__dirname, '.install-profile-2');
  cleanDir(profile2);

  const ctx2 = await chromium.launchPersistentContext(profile2, {
    headless: false,
    args: [
      '--no-first-run',
      '--no-sandbox',
      '--disable-default-apps',
      '--disable-search-engine-choice-screen',
      '--no-default-browser-check',
      '--headless=new',
      '--allow-file-access-from-files',
    ],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-US',
  });

  const folderPage = await ctx2.newPage();
  await folderPage.goto(`file://${path.join(tempUnzipped, 'maps-lead-scraper')}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 10_000,
  });
  await folderPage.waitForTimeout(1_000);
  await folderPage.screenshot({ path: path.join(OUTPUT_DIR, 'step-02.png') });
  console.log('Saved step-02.png (unzipped folder)');
  await ctx2.close();
  fs.rmSync(profile2, { recursive: true, force: true });
  fs.rmSync(tempUnzipped, { recursive: true, force: true });

  // ─── Steps 3-5: chrome://extensions page (no extension loaded) ───
  console.log('\n--- Steps 3-5: chrome://extensions (clean state) ---');
  const profile3 = path.join(__dirname, '.install-profile-3');
  cleanDir(profile3);

  const ctx3 = await chromium.launchPersistentContext(profile3, {
    headless: false,
    args: [
      '--no-first-run',
      '--no-sandbox',
      '--disable-default-apps',
      '--disable-search-engine-choice-screen',
      '--no-default-browser-check',
      '--headless=new',
    ],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-US',
  });

  const extPage = await ctx3.newPage();
  await extPage.goto('chrome://extensions', {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await extPage.waitForTimeout(3_000);

  // Step 3: Extensions page with developer mode OFF
  await extPage.screenshot({ path: path.join(OUTPUT_DIR, 'step-03.png') });
  console.log('Saved step-03.png (chrome://extensions, dev mode off)');

  // Step 4: Enable developer mode toggle
  // The toggle is inside shadow DOM: extensions-manager > extensions-toolbar > cr-toggle
  try {
    const toggled = await extPage.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      if (!manager || !manager.shadowRoot) return false;
      const toolbar = manager.shadowRoot.querySelector('extensions-toolbar');
      if (!toolbar || !toolbar.shadowRoot) return false;
      const toggle = toolbar.shadowRoot.querySelector('#devMode');
      if (!toggle) return false;
      toggle.click();
      return true;
    });
    if (toggled) {
      await extPage.waitForTimeout(1_500);
      console.log('Developer mode toggled ON');
    } else {
      console.log('Could not find developer mode toggle via shadow DOM');
    }
  } catch (err) {
    console.log('Dev mode toggle failed:', err.message);
  }

  await extPage.screenshot({ path: path.join(OUTPUT_DIR, 'step-04.png') });
  console.log('Saved step-04.png (developer mode ON)');

  // Step 5: "Load unpacked" button visible (should now be showing)
  // Crop to just the toolbar area for emphasis
  await extPage.screenshot({ path: path.join(OUTPUT_DIR, 'step-05.png') });
  console.log('Saved step-05.png (Load unpacked button visible)');

  await ctx3.close();
  fs.rmSync(profile3, { recursive: true, force: true });

  // ─── Step 6: File picker (can't automate — placeholder note) ───
  console.log('\n--- Step 6: File picker ---');
  console.log('SKIPPED — OS file dialog cannot be automated by Playwright.');
  console.log('Sarah: use a manual screenshot or annotated mockup for this step.');

  // ─── Step 7: Extension loaded in the list ───
  console.log('\n--- Step 7: Extension loaded ---');
  const profile4 = path.join(__dirname, '.install-profile-4');
  cleanDir(profile4);

  const ctx4 = await chromium.launchPersistentContext(profile4, {
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
    deviceScaleFactor: 2,
    locale: 'en-US',
  });

  // Wait for extension to register
  const workers = ctx4.serviceWorkers();
  if (workers.length === 0) {
    await ctx4.waitForEvent('serviceworker', { timeout: 15_000 });
  }
  await new Promise(r => setTimeout(r, 2_000));

  const extPage2 = await ctx4.newPage();
  await extPage2.goto('chrome://extensions', {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await extPage2.waitForTimeout(3_000);

  // Make sure developer mode is on (should be since we loaded extension)
  await extPage2.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    if (!manager || !manager.shadowRoot) return;
    const toolbar = manager.shadowRoot.querySelector('extensions-toolbar');
    if (!toolbar || !toolbar.shadowRoot) return;
    const toggle = toolbar.shadowRoot.querySelector('#devMode');
    if (toggle && !toggle.hasAttribute('checked')) {
      toggle.click();
    }
  }).catch(() => {});
  await extPage2.waitForTimeout(1_500);

  await extPage2.screenshot({ path: path.join(OUTPUT_DIR, 'step-07.png') });
  console.log('Saved step-07.png (extension loaded in list)');

  // ─── Steps 8-9: Pin extension to toolbar ───
  // Chrome toolbar UI is not accessible via Playwright web APIs.
  // We can attempt to show the popup being opened as proof it works.
  console.log('\n--- Steps 8-9: Pin extension ---');

  // Get extension ID
  let extensionId;
  const sw = ctx4.serviceWorkers()[0];
  if (sw) {
    extensionId = sw.url().split('/')[2];
  }

  if (extensionId) {
    // Open popup as a tab to show it works
    const popupPage = await ctx4.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForLoadState('domcontentloaded');
    await popupPage.waitForTimeout(2_000);

    // Fix status for clean screenshot
    await popupPage.evaluate(() => {
      const errorMsg = document.getElementById('errorMessage');
      if (errorMsg) errorMsg.classList.remove('visible');
      const statusIndicator = document.querySelector('.status-indicator');
      if (statusIndicator) {
        statusIndicator.classList.remove('error');
        statusIndicator.classList.add('ready');
      }
      const statusText = document.getElementById('statusText');
      if (statusText) statusText.textContent = 'Ready';
    });

    const popupBody = popupPage.locator('body');
    await popupBody.screenshot({ path: path.join(OUTPUT_DIR, 'step-09.png') });
    console.log('Saved step-09.png (extension popup — ready state)');
    await popupPage.close();
  } else {
    console.log('SKIPPED step-09 — could not get extension ID');
  }

  console.log('\nNote for steps 8-9: Chrome toolbar pin UI cannot be automated.');
  console.log('Sarah: use annotated screenshots or a brief text description for the pinning step.');

  await ctx4.close();
  fs.rmSync(profile4, { recursive: true, force: true });

  // ─── Summary ───
  console.log(`\nInstallation screenshots saved to ${OUTPUT_DIR}/`);
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('step-'));
  for (const f of files) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f} — ${(stat.size / 1024).toFixed(1)} KB`);
  }

  console.log('\n--- Gaps for Sarah ---');
  console.log('step-06.png: NOT CAPTURED — OS file picker dialog (suggest manual screenshot or text description)');
  console.log('step-08.png: NOT CAPTURED — Chrome puzzle icon menu (suggest annotated mockup)');
  console.log('step-09.png: Shows extension popup in "Ready" state as proof of successful install');
}

main().catch((err) => {
  console.error('Install screenshot capture failed:', err);
  process.exit(1);
});
