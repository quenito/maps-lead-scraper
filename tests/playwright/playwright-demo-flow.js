#!/usr/bin/env node

// Playwright Demo Flow — Mirrors Sarah's Demo Video Script Scene-by-Scene
//
// This script automates the exact user journey shown in the demo video.
// It runs in HEADED mode (not headless) so the screen can be captured via OBS.
// Human-emulation delays and realistic pacing throughout.
//
// Scenes:
//   1. Hook — quick montage (Google Maps search, extension open, CSV)
//   2. Install — skipped (extension is pre-loaded)
//   3. First Scrape — Google Maps "plumber new york"
//   4. Email Extraction & Verification — show results with verification badges
//   5. Export to CSV — trigger export, show download
//   6. Bing Maps — same search, different results (future: not automated yet)
//   7. Results Recap — summary stats
//   8. CTA — navigate to konnexlabs.com
//
// Usage:
//   node playwright-demo-flow.js
//   node playwright-demo-flow.js --headless    # For testing only
//
// Requires: Playwright, google-chrome with extension loaded

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================
// Configuration
// ============================================

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const USER_DATA_DIR = path.join(__dirname, '.demo-chrome-profile');
const VIEWPORT = { width: 1920, height: 1080 };
const SEARCH_QUERY = 'plumber new york';
const MAPS_URL = `https://www.google.com/maps/search/${encodeURIComponent(SEARCH_QUERY)}`;

const args = process.argv.slice(2);
const headless = args.includes('--headless');

// ============================================
// Human Emulation Utilities
// ============================================

function randomDelay(min = 500, max = 1500) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pause with human-like timing between actions */
async function humanPause(label, min = 500, max = 1500) {
  const ms = randomDelay(min, max);
  if (label) console.log(`  [${label}] pausing ${ms}ms`);
  await sleep(ms);
}

/** Type text character by character with realistic speed */
async function humanType(page, selector, text) {
  await page.click(selector);
  await humanPause(null, 300, 600);
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(50, 150) });
  }
}

/** Smooth scroll simulation */
async function humanScroll(page, selector, distance, steps = 5) {
  const stepSize = Math.floor(distance / steps);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(([sel, px]) => {
      const el = sel ? document.querySelector(sel) : window;
      if (el && el.scrollBy) el.scrollBy(0, px);
      else if (el) window.scrollBy(0, px);
    }, [selector, stepSize]);
    await sleep(randomDelay(100, 300));
  }
}

// ============================================
// Scraping Logic (injected into page)
// ============================================

// Same extraction logic as content.js / run-scrape.js
const INJECT_SCRAPE_FUNCTIONS = `
  window.__demo_scrapedData = window.__demo_scrapedData || [];
  window.__demo_seenUrls = window.__demo_seenUrls || new Set();

  window.__demo_getResultsContainer = () => {
    const selectors = [
      'div[role="feed"]',
      'div.m6QErb[aria-label]',
      'div.m6QErb.DxyBCb',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  window.__demo_extractBusinessData = (el) => {
    try {
      const nameEl = el.querySelector('.fontHeadlineSmall, .qBF1Pd');
      if (!nameEl) return null;
      const name = nameEl.textContent.trim();
      if (!name) return null;

      const ratingEl = el.querySelector('.MW4etd');
      const rating = ratingEl ? parseFloat(ratingEl.textContent) : null;

      const reviewEl = el.querySelector('.UY7F9');
      let reviewCount = null;
      if (reviewEl) {
        const m = reviewEl.textContent.match(/([\\d,]+)/);
        if (m) reviewCount = parseInt(m[1].replace(/,/g, ''), 10);
      }

      const categoryEl = el.querySelector('.W4Efsd .W4Efsd:nth-child(1) > span:first-child');
      const category = categoryEl ? categoryEl.textContent.replace(/^·\\s*/, '').trim() : '';

      const addressEl = el.querySelector('.W4Efsd .W4Efsd:nth-child(1) > span:nth-child(2)');
      const address = addressEl ? addressEl.textContent.replace(/^·\\s*/, '').trim() : '';

      let phone = '';
      const phoneEl = el.querySelector('.W4Efsd .W4Efsd:nth-child(2) > span:nth-child(2)');
      if (phoneEl) {
        const phoneText = phoneEl.textContent.trim();
        if (/[\\d\\(\\+]/.test(phoneText)) phone = phoneText.replace(/^·\\s*/, '');
      }

      let website = '';
      const linkEls = el.querySelectorAll('a[href]');
      for (const a of linkEls) {
        const href = a.href;
        if (href && !href.includes('google.com/maps') && !href.startsWith('javascript')
            && (href.startsWith('http://') || href.startsWith('https://'))) {
          website = href;
          break;
        }
      }

      const mapLink = el.querySelector('a.hfpxzc');
      const googleMapsUrl = mapLink ? mapLink.href : '';

      return { name, rating, reviewCount, category, address, phone, website, googleMapsUrl };
    } catch { return null; }
  };

  window.__demo_scrapeVisible = () => {
    const container = window.__demo_getResultsContainer();
    if (!container) return 0;
    let newCount = 0;
    const items = container.querySelectorAll('[jsaction*="mouseover"]');
    for (const item of items) {
      const data = window.__demo_extractBusinessData(item);
      if (!data) continue;
      const key = data.googleMapsUrl || data.name;
      if (window.__demo_seenUrls.has(key)) continue;
      window.__demo_seenUrls.add(key);
      window.__demo_scrapedData.push(data);
      newCount++;
    }
    return newCount;
  };

  window.__demo_scrollResults = () => {
    const container = window.__demo_getResultsContainer();
    if (!container) return false;
    container.scrollTop += 800;
    return true;
  };

  window.__demo_hasReachedEnd = () => {
    const endEl = document.querySelector('.m6QErb .PbZDve > p.fontBodyMedium > span > span');
    return !!endEl;
  };
`;

// ============================================
// Scene Functions
// ============================================

/**
 * SCENE 1 — HOOK
 * Quick montage: navigate to Google Maps, show search results loading.
 */
async function scene1_hook(page) {
  console.log('\n=== SCENE 1 — HOOK ===');
  console.log('Navigating to Google Maps...');

  // Navigate directly to Google consent page first to dismiss it
  await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanPause('Google loaded', 1000, 1500);

  // Accept cookies if prompted
  try {
    const consentBtn = await page.$('button:has-text("Accept all"), button:has-text("Alle akzeptieren"), button[id*="agree"]');
    if (consentBtn) {
      await humanPause('consent dialog', 500, 1000);
      await consentBtn.click();
      await humanPause('consent accepted', 1000, 2000);
    }
  } catch {}

  console.log('  Google consent handled — ready for Maps');
}

/**
 * SCENE 2 — INSTALL (Skipped)
 * Extension is pre-loaded via launch args. Just log it.
 */
function scene2_install() {
  console.log('\n=== SCENE 2 — INSTALL (pre-loaded) ===');
  console.log('  Extension loaded from:', EXTENSION_PATH);
}

/**
 * SCENE 3 — FIRST SCRAPE (Google Maps)
 * Search "plumber new york", open extension, show filters, run scrape.
 */
async function scene3_firstScrape(page) {
  console.log('\n=== SCENE 3 — FIRST SCRAPE ===');

  // Navigate directly to Maps search URL (reliable in headless and headed)
  console.log(`  Searching: "${SEARCH_QUERY}"`);
  await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('  Search submitted — waiting for results...');
  await humanPause('results loading', 3000, 5000);

  // Wait for results container
  try {
    await page.waitForSelector('div[role="feed"], div.m6QErb[aria-label]', { timeout: 15000 });
  } catch {
    console.log('  Warning: Results container not found, continuing...');
  }
  await humanPause('results visible', 1500, 2500);

  // Inject scraping functions
  await page.evaluate(INJECT_SCRAPE_FUNCTIONS);

  // --- SCRAPE LOOP ---
  console.log('  Starting scrape...');
  const scrapeStart = Date.now();
  let totalLeads = 0;
  let noNewCount = 0;
  const maxLeads = 60; // Keep it short for demo — enough to show value

  while (true) {
    const newCount = await page.evaluate(() => window.__demo_scrapeVisible());
    totalLeads = await page.evaluate(() => window.__demo_scrapedData.length);

    if (newCount > 0) {
      noNewCount = 0;
      console.log(`  Scraped: ${totalLeads} leads (+${newCount} new)`);
    } else {
      noNewCount++;
    }

    // Stop conditions
    const atEnd = await page.evaluate(() => window.__demo_hasReachedEnd());
    if (atEnd || noNewCount >= 8 || totalLeads >= maxLeads) break;
    if (Date.now() - scrapeStart > 120000) break; // 2-min timeout for demo

    // Scroll for more results
    await page.evaluate(() => window.__demo_scrollResults());
    await humanPause(null, 1500, 2500); // Realistic scroll wait
  }

  const durationSec = ((Date.now() - scrapeStart) / 1000).toFixed(1);
  console.log(`  Scrape complete: ${totalLeads} businesses in ${durationSec}s`);

  // Get scraped data for later scenes
  const scrapedData = await page.evaluate(() => window.__demo_scrapedData);
  return scrapedData;
}

/**
 * SCENE 4 — EMAIL EXTRACTION & VERIFICATION
 * Show the results with email data. For demo purposes, we display a summary
 * rather than running live extraction (which takes minutes).
 */
async function scene4_emailExtraction(scrapedData) {
  console.log('\n=== SCENE 4 — EMAIL EXTRACTION & VERIFICATION ===');
  console.log(`  ${scrapedData.length} businesses ready for email extraction`);
  console.log('  (In the demo video, email extraction runs live — takes 1-2 minutes)');
  console.log('  (This script captures the pre/post state for screen recording)');
  await humanPause('viewing results', 2000, 3000);

  // Count businesses with websites (proxy for email extraction potential)
  const withWebsite = scrapedData.filter((b) => b.website).length;
  const withPhone = scrapedData.filter((b) => b.phone).length;
  console.log(`  Businesses with website: ${withWebsite} (${Math.round((withWebsite / scrapedData.length) * 100)}%)`);
  console.log(`  Businesses with phone: ${withPhone} (${Math.round((withPhone / scrapedData.length) * 100)}%)`);
}

/**
 * SCENE 5 — EXPORT TO CSV
 * Generate and save a CSV file from scraped data.
 */
async function scene5_exportCSV(scrapedData) {
  console.log('\n=== SCENE 5 — EXPORT TO CSV ===');

  const CSV_HEADERS = [
    'name', 'rating', 'reviewCount', 'category', 'address',
    'phone', 'website', 'googleMapsUrl',
  ];

  function escapeCSV(val) {
    const str = val == null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const csvLines = [CSV_HEADERS.join(',')];
  for (const row of scrapedData) {
    csvLines.push(CSV_HEADERS.map((h) => escapeCSV(row[h])).join(','));
  }

  const csvContent = '\uFEFF' + csvLines.join('\n');
  const outputDir = path.join(__dirname, 'results');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csvPath = path.join(outputDir, `demo-flow_${timestamp}.csv`);
  fs.writeFileSync(csvPath, csvContent);

  console.log(`  CSV exported: ${csvPath}`);
  console.log(`  ${scrapedData.length} rows, ${CSV_HEADERS.length} columns`);
  await humanPause('export complete', 1000, 2000);

  return csvPath;
}

/**
 * SCENE 6 — BING MAPS (placeholder)
 * Bing Maps scraping in the demo requires Edge. Logged as a placeholder.
 */
async function scene6_bingMaps() {
  console.log('\n=== SCENE 6 — BING MAPS (placeholder) ===');
  console.log('  Bing Maps demo requires separate recording in Edge.');
  console.log('  This scene will be recorded manually for the demo video.');
  await humanPause('scene transition', 1000, 1500);
}

/**
 * SCENE 7 — RESULTS RECAP
 * Display summary stats from the scrape.
 */
async function scene7_recap(scrapedData) {
  console.log('\n=== SCENE 7 — RESULTS RECAP ===');
  const withPhone = scrapedData.filter((b) => b.phone).length;
  const withWebsite = scrapedData.filter((b) => b.website).length;
  const avgRating = scrapedData
    .filter((b) => b.rating)
    .reduce((sum, b) => sum + b.rating, 0) / scrapedData.filter((b) => b.rating).length;

  console.log(`  Total businesses scraped: ${scrapedData.length}`);
  console.log(`  With phone numbers: ${withPhone}`);
  console.log(`  With websites: ${withWebsite}`);
  console.log(`  Average rating: ${avgRating.toFixed(1)}`);
  console.log(`  Data fields per lead: 8 (scrape) / 19 (with email extraction)`);
  await humanPause('recap display', 2000, 3000);
}

/**
 * SCENE 8 — CTA
 * Navigate to konnexlabs.com to show pricing.
 */
async function scene8_cta(page) {
  console.log('\n=== SCENE 8 — CTA ===');
  console.log('  Navigating to konnexlabs.com...');

  await page.goto('https://konnexlabs.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await humanPause('site loaded', 2000, 3000);

  // Scroll to pricing section
  await humanScroll(page, null, 600, 4);
  await humanPause('viewing pricing', 3000, 5000);

  console.log('  Website and pricing visible — end of demo flow');
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('=== Playwright Demo Flow — Scene-by-Scene ===');
  console.log(`Mode: ${headless ? 'headless (testing)' : 'headed (for recording)'}`);
  console.log(`Search: "${SEARCH_QUERY}"`);
  console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log('');

  // Launch Chrome with the extension loaded
  const launchArgs = [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-sandbox',
    '--disable-default-apps',
    '--disable-search-engine-choice-screen',
    '--no-default-browser-check',
  ];

  if (headless) {
    launchArgs.push('--headless=new');
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: '/usr/bin/google-chrome',
    args: launchArgs,
    viewport: VIEWPORT,
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // --- SCENE 1: HOOK ---
    await scene1_hook(page);

    // --- SCENE 2: INSTALL (pre-loaded) ---
    scene2_install();

    // --- SCENE 3: FIRST SCRAPE ---
    const scrapedData = await scene3_firstScrape(page);

    // --- SCENE 4: EMAIL EXTRACTION ---
    await scene4_emailExtraction(scrapedData);

    // --- SCENE 5: EXPORT CSV ---
    const csvPath = await scene5_exportCSV(scrapedData);

    // --- SCENE 6: BING MAPS (placeholder) ---
    await scene6_bingMaps();

    // --- SCENE 7: RESULTS RECAP ---
    await scene7_recap(scrapedData);

    // --- SCENE 8: CTA ---
    await scene8_cta(page);

    console.log('\n' + '='.repeat(50));
    console.log('DEMO FLOW COMPLETE');
    console.log('='.repeat(50));
    console.log(`CSV output: ${csvPath}`);
    console.log(`Total leads: ${scrapedData.length}`);
    console.log('');
    console.log('For video recording:');
    console.log('  1. Run this script in headed mode (no --headless flag)');
    console.log('  2. Start OBS screen capture before running');
    console.log('  3. The script will pace through each scene automatically');
    console.log('  4. Add voiceover and overlays in post-production');

  } catch (err) {
    console.error('\nError during demo flow:', err.message);
    throw err;
  } finally {
    await humanPause('closing', 1000, 2000);
    await context.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
