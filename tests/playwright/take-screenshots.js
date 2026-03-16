#!/usr/bin/env node
/**
 * Take hero screenshots of the extension popup in licensed state.
 * Uses Playwright to load the extension, inject licensed state + mock data,
 * then captures screenshots at 3x device scale factor.
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const USER_DATA_DIR = path.join(__dirname, '.demo-chrome-profile');
const OUTPUT_DIR = '/tmp/extension-screenshots';

// 10 mock businesses for the "with data" state
const MOCK_LEADS = [
  { name: 'Harbour View Café', address: '12 Circular Quay, Sydney NSW', phone: '(02) 9241 1234', website: 'https://harbourviewcafe.com.au', rating: 4.6, reviewCount: 342, category: 'Café', googleMapsUrl: 'https://www.google.com/maps/place/1' },
  { name: 'Bondi Beach Yoga Studio', address: '45 Campbell Parade, Bondi NSW', phone: '(02) 9130 5678', website: 'https://bondiyoga.com.au', rating: 4.8, reviewCount: 218, category: 'Yoga Studio', googleMapsUrl: 'https://www.google.com/maps/place/2' },
  { name: 'The Grounds of Alexandria', address: '7a Huntley St, Alexandria NSW', phone: '(02) 9699 2225', website: 'https://thegrounds.com.au', rating: 4.5, reviewCount: 1847, category: 'Restaurant', googleMapsUrl: 'https://www.google.com/maps/place/3' },
  { name: 'Surry Hills Dental', address: '320 Crown St, Surry Hills NSW', phone: '(02) 9360 4321', website: 'https://surryhillsdental.com.au', rating: 4.9, reviewCount: 156, category: 'Dentist', googleMapsUrl: 'https://www.google.com/maps/place/4' },
  { name: 'Newtown Auto Repairs', address: '88 King St, Newtown NSW', phone: '(02) 9557 8899', website: 'https://newtownauto.com.au', rating: 4.3, reviewCount: 89, category: 'Auto Repair', googleMapsUrl: 'https://www.google.com/maps/place/5' },
  { name: 'Manly Surf School', address: '1 North Steyne, Manly NSW', phone: '(02) 9977 6677', website: 'https://manlysurfschool.com.au', rating: 4.7, reviewCount: 523, category: 'Surf School', googleMapsUrl: 'https://www.google.com/maps/place/6' },
  { name: 'Darlinghurst Pet Clinic', address: '200 Oxford St, Darlinghurst NSW', phone: '(02) 9331 2233', website: 'https://darlinghurstpet.com.au', rating: 4.4, reviewCount: 134, category: 'Veterinarian', googleMapsUrl: 'https://www.google.com/maps/place/7' },
  { name: 'Redfern Physiotherapy', address: '55 Redfern St, Redfern NSW', phone: '(02) 9698 4455', website: 'https://redfernphysio.com.au', rating: 4.8, reviewCount: 267, category: 'Physiotherapist', googleMapsUrl: 'https://www.google.com/maps/place/8' },
  { name: 'Glebe Bookshop', address: '191 Glebe Point Rd, Glebe NSW', phone: '(02) 9660 7788', website: 'https://glebebooks.com.au', rating: 4.6, reviewCount: 412, category: 'Book Store', googleMapsUrl: 'https://www.google.com/maps/place/9' },
  { name: 'Balmain Italian Kitchen', address: '26 Darling St, Balmain NSW', phone: '(02) 9810 9900', website: 'https://balmainkitchen.com.au', rating: 4.5, reviewCount: 298, category: 'Italian Restaurant', googleMapsUrl: 'https://www.google.com/maps/place/10' },
];

async function main() {
  // Clean profile
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Launching browser with extension...');
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
    deviceScaleFactor: 3,
    locale: 'en-US',
  });

  // Get extension ID
  let extensionId;
  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    extensionId = workers[0].url().split('/')[2];
  } else {
    const sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    extensionId = sw.url().split('/')[2];
  }
  console.log(`Extension ID: ${extensionId}`);

  // Wait for service worker initialization to complete
  const sw = context.serviceWorkers()[0];
  await new Promise(r => setTimeout(r, 2000));

  // Inject licensed state + mock data via service worker
  await sw.evaluate((leads) => {
    return chrome.storage.local.set({
      licenseStatus: {
        status: 'active',
        tier: 'standard',
        trialScrapesRemaining: 0,
        licenseKey: 'DEMO-XXXX-XXXX-XXXX',
        validatedAt: new Date().toISOString(),
        email: 'user@example.com',
      },
      scrapedData: leads,
      scrapedDataWithEmails: [],
      isScrapin: false,
      isExtractingEmails: true,
      emailExtractionProgress: {
        current: 4,
        total: 10,
        businessName: 'Surry Hills Dental',
      },
      autoExtractEmails: true,
      notificationsEnabled: true,
    });
  }, MOCK_LEADS);

  // Verify storage was set correctly
  const storedStatus = await sw.evaluate(() => chrome.storage.local.get(['licenseStatus']));
  console.log('Stored license status:', JSON.stringify(storedStatus.licenseStatus?.status));

  console.log('Injected licensed state + 10 mock leads + email extraction progress');

  // Open popup
  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(2000);

  // Verify licensed state
  const trialBannerHidden = await popup.locator('#trialBanner').evaluate(el => el.style.display === 'none' || getComputedStyle(el).display === 'none');
  const licenseBadgeVisible = await popup.locator('#licenseBadge').evaluate(el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
  console.log(`Trial banner hidden: ${trialBannerHidden}`);
  console.log(`License badge visible: ${licenseBadgeVisible}`);

  // Hide the error message and fix status for hero shots
  // (popup shows error because we're not on a Maps tab — not relevant for screenshots)
  await popup.evaluate(() => {
    const errorMsg = document.getElementById('errorMessage');
    if (errorMsg) errorMsg.classList.remove('visible');
    const statusIndicator = document.querySelector('.status-indicator');
    if (statusIndicator) {
      statusIndicator.classList.remove('error');
      statusIndicator.classList.add('scraping');
    }
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.textContent = 'Extracting Contact Info...';
  });

  if (!trialBannerHidden) {
    console.error('WARNING: Trial banner is still visible!');
  }

  // Screenshot 1: popup-with-data.png — full viewport with 10 leads + extraction progress
  await popup.screenshot({
    path: path.join(OUTPUT_DIR, 'popup-with-data.png'),
    fullPage: true,
  });
  console.log('Saved popup-with-data.png');

  // Screenshot 2: popup-cropped.png — tight crop of just the popup body
  const popupBody = popup.locator('body');
  await popupBody.screenshot({
    path: path.join(OUTPUT_DIR, 'popup-cropped.png'),
  });
  console.log('Saved popup-cropped.png');

  // Screenshot 3: popup-clean.png — clean state (no data)
  await popup.close();

  // Clear scraped data for clean state
  await sw.evaluate(() => {
    return chrome.storage.local.set({
      scrapedData: [],
      scrapedDataWithEmails: [],
      isScrapin: false,
      isExtractingEmails: false,
      emailExtractionProgress: null,
    });
  });

  const popup2 = await context.newPage();
  await popup2.goto(popupUrl);
  await popup2.waitForLoadState('domcontentloaded');
  await popup2.waitForTimeout(2000);

  // Hide error and show Ready status for clean state
  await popup2.evaluate(() => {
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

  await popup2.screenshot({
    path: path.join(OUTPUT_DIR, 'popup-clean.png'),
    fullPage: true,
  });
  console.log('Saved popup-clean.png');

  await popup2.close();
  await context.close();

  console.log(`\nAll screenshots saved to ${OUTPUT_DIR}/`);
  const files = fs.readdirSync(OUTPUT_DIR);
  for (const f of files) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f} — ${(stat.size / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
