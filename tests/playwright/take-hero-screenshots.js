#!/usr/bin/env node
/**
 * Take hero screenshots for Google Maps Scraper and Bing Maps Scraper pages.
 *
 * Approach:
 * 1. Navigate to Google Maps with a search query, screenshot the results
 * 2. Navigate to Bing Maps with a search query, screenshot the results
 * 3. Open extension popup with mock data in active scraping state, screenshot it
 * 4. Composite the popup onto each map screenshot using ImageMagick
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const USER_DATA_DIR = path.join(__dirname, '.hero-chrome-profile');
const OUTPUT_DIR = path.resolve(__dirname, '../../screenshots');

// Mock leads for active scraping state
const MOCK_LEADS = [
  { name: 'Manhattan Mortgage Group', address: '350 Fifth Ave, New York, NY 10118', phone: '(212) 555-1234', website: 'https://manhattanmortgage.com', rating: 4.7, reviewCount: 189, category: 'Mortgage Broker', googleMapsUrl: 'https://www.google.com/maps/place/1' },
  { name: 'Empire State Lending', address: '1 Penn Plaza, New York, NY 10119', phone: '(212) 555-5678', website: 'https://empirestatelending.com', rating: 4.9, reviewCount: 312, category: 'Mortgage Lender', googleMapsUrl: 'https://www.google.com/maps/place/2' },
  { name: 'Midtown Home Loans', address: '500 Park Ave, New York, NY 10022', phone: '(212) 555-3456', website: 'https://midtownhomeloans.com', rating: 4.5, reviewCount: 267, category: 'Mortgage Broker', googleMapsUrl: 'https://www.google.com/maps/place/3' },
  { name: 'Brooklyn Bridge Mortgages', address: '1 Main St, Brooklyn, NY 11201', phone: '(718) 555-7890', website: 'https://brooklynbridgemortgages.com', rating: 4.8, reviewCount: 145, category: 'Mortgage Broker', googleMapsUrl: 'https://www.google.com/maps/place/4' },
  { name: 'Wall Street Home Finance', address: '40 Wall St, New York, NY 10005', phone: '(212) 555-2345', website: 'https://wallstreethomefinance.com', rating: 4.6, reviewCount: 98, category: 'Mortgage Lender', googleMapsUrl: 'https://www.google.com/maps/place/5' },
  { name: 'Hudson Valley Mortgage Co', address: '100 Broadway, New York, NY 10005', phone: '(212) 555-6789', website: 'https://hudsonvalleymortgage.com', rating: 4.4, reviewCount: 423, category: 'Mortgage Broker', googleMapsUrl: 'https://www.google.com/maps/place/6' },
  { name: 'Chelsea Rate Lock', address: '245 W 17th St, New York, NY 10011', phone: '(212) 555-4567', website: 'https://chelsearatelock.com', rating: 4.3, reviewCount: 76, category: 'Mortgage Broker', googleMapsUrl: 'https://www.google.com/maps/place/7' },
  { name: 'SoHo Lending Partners', address: '580 Broadway, New York, NY 10012', phone: '(212) 555-8901', website: 'https://soholending.com', rating: 4.7, reviewCount: 201, category: 'Mortgage Lender', googleMapsUrl: 'https://www.google.com/maps/place/8' },
];

/**
 * Dismiss Google cookie consent wall if it appears (VPS is in Helsinki).
 */
async function dismissConsentWall(page) {
  try {
    const consentBtn = page.locator(
      'button:has-text("Accept all"), button:has-text("Alle akzeptieren"), button:has-text("Hyväksy kaikki"), button:has-text("Accepter tout"), form[action*="consent"] button:first-of-type'
    );
    const visible = await consentBtn.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (visible) {
      await consentBtn.first().click();
      await page.waitForTimeout(3_000);
    }
  } catch {
    // No consent wall
  }
}

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

  const sw = context.serviceWorkers()[0];
  await new Promise(r => setTimeout(r, 2000));

  // ─── Step 1: Screenshot Google Maps ───
  console.log('\n--- Google Maps Screenshot ---');
  const gmapsPage = await context.newPage();
  await gmapsPage.goto('https://www.google.com/maps/search/mortgage+broker+New+York?hl=en', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await dismissConsentWall(gmapsPage);

  // Wait for maps to load and results to appear
  await gmapsPage.waitForTimeout(5_000);

  // Try to wait for result cards
  try {
    await gmapsPage.waitForSelector('div[role="article"], div.Nv2PK, a[href*="/maps/place/"]', { timeout: 10_000 });
    console.log('Google Maps results loaded');
  } catch {
    console.log('Google Maps results selector not found, continuing anyway');
  }
  await gmapsPage.waitForTimeout(2_000);

  await gmapsPage.screenshot({
    path: path.join(OUTPUT_DIR, 'gmaps-background.png'),
  });
  console.log('Saved gmaps-background.png');
  await gmapsPage.close();

  // ─── Step 2: Screenshot Bing Maps ───
  console.log('\n--- Bing Maps Screenshot ---');
  const bingPage = await context.newPage();
  await bingPage.goto('https://www.bing.com/maps?q=mortgage+broker+New+York', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await bingPage.waitForTimeout(5_000);

  // Dismiss Bing cookie consent if present
  try {
    const bingConsent = bingPage.locator('#bnp_btn_accept, .bnp_btn_accept, button:has-text("Accept"), #consent-banner button:first-of-type');
    const bingConsentVisible = await bingConsent.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (bingConsentVisible) {
      await bingConsent.first().click();
      await bingPage.waitForTimeout(3_000);
      console.log('Dismissed Bing cookie consent');
    }
  } catch {
    // No Bing consent
  }

  // Try to wait for Bing Maps results
  try {
    await bingPage.waitForSelector('.taskCard, .b_entityTP, .overlay-container', { timeout: 10_000 });
    console.log('Bing Maps results loaded');
  } catch {
    console.log('Bing Maps results selector not found, continuing anyway');
  }
  await bingPage.waitForTimeout(2_000);

  // Try JS-based consent dismissal as fallback
  await bingPage.evaluate(() => {
    // Try clicking accept button by various selectors
    const selectors = ['#bnp_btn_accept', '.bnp_btn_accept', '#accept-banner', '.accept-btn'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return; }
    }
    // Try by text content
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'Accept') { btn.click(); return; }
    }
    // Try removing consent banner entirely
    const banner = document.querySelector('#bnp_cookie_banner, .bnp_cookie_banner, #consent-banner, [class*="consent"], [id*="consent"]');
    if (banner) banner.remove();
  }).catch(() => {});
  await bingPage.waitForTimeout(1_000);

  await bingPage.screenshot({
    path: path.join(OUTPUT_DIR, 'bing-background.png'),
  });
  console.log('Saved bing-background.png');
  await bingPage.close();

  // ─── Step 3: Screenshot Extension Popup (active scraping state) ───
  console.log('\n--- Extension Popup Screenshot ---');

  // Inject licensed state + mock data showing active scraping
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
        current: 5,
        total: 8,
        businessName: 'Wall Street Home Finance',
      },
      autoExtractEmails: true,
      notificationsEnabled: true,
    });
  }, MOCK_LEADS);
  console.log('Injected licensed state + 8 mock leads + extraction progress');

  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(2000);

  // Fix status display for hero shots
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

  // Screenshot just the popup body (tight crop, transparent background if possible)
  const popupBody = popup.locator('body');
  await popupBody.screenshot({
    path: path.join(OUTPUT_DIR, 'popup-overlay.png'),
  });
  console.log('Saved popup-overlay.png');
  await popup.close();

  await context.close();

  // ─── Step 4: Composite screenshots ───
  console.log('\n--- Compositing hero screenshots ---');

  const gmapsBg = path.join(OUTPUT_DIR, 'gmaps-background.png');
  const bingBg = path.join(OUTPUT_DIR, 'bing-background.png');
  const popupOverlay = path.join(OUTPUT_DIR, 'popup-overlay.png');
  const gmapsHero = path.join(OUTPUT_DIR, 'hero-google-maps-scraper.png');
  const bingHero = path.join(OUTPUT_DIR, 'hero-bing-maps-scraper.png');

  // Get dimensions of background images
  const gmapsDims = execSync(`identify -format "%wx%h" "${gmapsBg}"`).toString().trim();
  const popupDims = execSync(`identify -format "%wx%h" "${popupOverlay}"`).toString().trim();
  console.log(`Google Maps background: ${gmapsDims}`);
  console.log(`Popup overlay: ${popupDims}`);

  const [bgW, bgH] = gmapsDims.split('x').map(Number);
  const [popW, popH] = popupDims.split('x').map(Number);

  // Position popup on the right side of the map, vertically centered with slight top offset
  // The popup should appear like it's floating over the map on the right side
  const xOffset = Math.round(bgW - popW - Math.round(bgW * 0.05)); // 5% from right edge
  const yOffset = Math.round((bgH - popH) / 2 - Math.round(bgH * 0.05)); // slightly above center

  // Add a subtle shadow to the popup before compositing
  // First, create a version with drop shadow
  execSync(`convert "${popupOverlay}" \\( +clone -background black -shadow 60x8+0+4 \\) +swap -background none -layers merge +repage "${path.join(OUTPUT_DIR, 'popup-with-shadow.png')}"`);

  const popupShadow = path.join(OUTPUT_DIR, 'popup-with-shadow.png');
  const shadowDims = execSync(`identify -format "%wx%h" "${popupShadow}"`).toString().trim();
  const [shadowW, shadowH] = shadowDims.split('x').map(Number);

  // Recalculate offset for shadow version (slightly larger)
  const sxOffset = Math.round(bgW - shadowW - Math.round(bgW * 0.04));
  const syOffset = Math.max(0, Math.round((bgH - shadowH) / 2 - Math.round(bgH * 0.03)));

  // Composite: Google Maps + popup
  execSync(`composite -geometry +${sxOffset}+${syOffset} "${popupShadow}" "${gmapsBg}" "${gmapsHero}"`);
  console.log(`Saved hero-google-maps-scraper.png`);

  // Composite: Bing Maps + popup
  const bingDims = execSync(`identify -format "%wx%h" "${bingBg}"`).toString().trim();
  const [bingW, bingH] = bingDims.split('x').map(Number);
  const bxOffset = Math.round(bingW - shadowW - Math.round(bingW * 0.04));
  const byOffset = Math.max(0, Math.round((bingH - shadowH) / 2 - Math.round(bingH * 0.03)));

  execSync(`composite -geometry +${bxOffset}+${byOffset} "${popupShadow}" "${bingBg}" "${bingHero}"`);
  console.log(`Saved hero-bing-maps-scraper.png`);

  // Clean up intermediate files
  fs.unlinkSync(path.join(OUTPUT_DIR, 'gmaps-background.png'));
  fs.unlinkSync(path.join(OUTPUT_DIR, 'bing-background.png'));
  fs.unlinkSync(path.join(OUTPUT_DIR, 'popup-overlay.png'));
  fs.unlinkSync(path.join(OUTPUT_DIR, 'popup-with-shadow.png'));

  console.log(`\nHero screenshots saved to ${OUTPUT_DIR}/`);
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('hero-'));
  for (const f of files) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f} — ${(stat.size / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error('Hero screenshot failed:', err);
  process.exit(1);
});
