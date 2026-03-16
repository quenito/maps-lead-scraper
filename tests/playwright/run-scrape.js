#!/usr/bin/env node

// Playwright Automated Scrape Runner — Phase 1
// Launches Chrome, navigates to Google Maps, injects the extension's content script
// scraping logic, captures structured output (JSON + CSV), and logs the run.
//
// The same extractBusinessData/scrollResults/getResultsContainer logic from
// content/content.js is injected via page.evaluate(). This ensures Playwright
// scrape results match what the extension produces.
//
// Usage:
//   node run-scrape.js <industry> <city>
//   node run-scrape.js --all                  # Run full 9-query suite
//   node run-scrape.js plumbers Sydney --headless
//
// Requires: Playwright, system Chrome (google-chrome), xvfb (for headed on server)

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================
// Configuration
// ============================================

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const RESULTS_DIR = path.join(__dirname, 'results');
const RUN_LOG_PATH = path.join(__dirname, 'run-log.csv');
const USER_DATA_DIR = path.join(__dirname, '.chrome-profile');

// Phase 1 query set: 3 industries x 3 cities = 9 queries
const PHASE1_QUERIES = [
  { industry: 'plumbers', city: 'Sydney' },
  { industry: 'plumbers', city: 'Melbourne' },
  { industry: 'plumbers', city: 'Brisbane' },
  { industry: 'electricians', city: 'Sydney' },
  { industry: 'electricians', city: 'Melbourne' },
  { industry: 'electricians', city: 'Brisbane' },
  { industry: 'real estate agents', city: 'Sydney' },
  { industry: 'real estate agents', city: 'Melbourne' },
  { industry: 'real estate agents', city: 'Brisbane' },
];

// Timeouts
const MAPS_LOAD_TIMEOUT = 30000;
const SCRAPE_POLL_INTERVAL = 3000;
const SCRAPE_MAX_WAIT = 300000;

// CSV headers matching extension's export format (scrape fields only for Phase 1)
const CSV_HEADERS = [
  'name', 'rating', 'reviewCount', 'category', 'address',
  'phone', 'website', 'googleMapsUrl'
];

// ============================================
// Argument parsing
// ============================================

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const runAll = args.includes('--all');
const filteredArgs = args.filter(a => !a.startsWith('--'));

if (!runAll && filteredArgs.length < 2) {
  console.error('Usage: node run-scrape.js <industry> <city> [--headless]');
  console.error('       node run-scrape.js --all [--headless]');
  console.error('');
  console.error('Examples:');
  console.error('  node run-scrape.js plumbers Sydney');
  console.error('  node run-scrape.js "real estate agents" Melbourne --headless');
  console.error('  node run-scrape.js --all');
  process.exit(1);
}

// ============================================
// CSV helpers
// ============================================

function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function dataToCSV(data) {
  const headerRow = CSV_HEADERS.join(',');
  const rows = data.map(row =>
    CSV_HEADERS.map(h => escapeCSV(row[h])).join(',')
  );
  return [headerRow, ...rows].join('\n');
}

function appendRunLog(entry) {
  const logHeaders = 'timestamp,industry,city,query,result_count,duration_seconds,output_file,status';
  const logExists = fs.existsSync(RUN_LOG_PATH);
  const line = [
    entry.timestamp,
    escapeCSV(entry.industry),
    escapeCSV(entry.city),
    escapeCSV(entry.query),
    entry.resultCount,
    entry.durationSeconds,
    escapeCSV(entry.outputFile),
    entry.status
  ].join(',');

  if (!logExists) {
    fs.writeFileSync(RUN_LOG_PATH, logHeaders + '\n' + line + '\n');
  } else {
    fs.appendFileSync(RUN_LOG_PATH, line + '\n');
  }
}

// ============================================
// Content script injection
// ============================================

// Injects the extension's scraping functions into the page context.
// These functions are copied from content/content.js — the same DOM selectors,
// extraction logic, and scroll behavior the extension uses.
async function injectScrapingFunctions(page) {
  await page.evaluate(() => {
    // --- Scraped from content/content.js (same logic) ---

    window.__pw_scrapedData = [];
    window.__pw_seenUrls = new Set();
    window.__pw_isScrapin = false;

    const MAX_RESULTS = 500;
    const SCROLL_DELAY = 2000;
    const MAX_NO_NEW_RESULTS = 10;
    const LOADING_WAIT_DELAY = 1500;

    window.__pw_isGoogleMapsLoading = function() {
      const spinners = document.querySelectorAll('div[role="progressbar"], svg[class*="progress"], div[class*="loading"]');
      for (const spinner of spinners) {
        const style = window.getComputedStyle(spinner);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          const rect = spinner.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return true;
        }
      }
      const loadingElements = document.querySelectorAll('[class*="loading"], [aria-busy="true"]');
      for (const el of loadingElements) {
        const container = window.__pw_getResultsContainer();
        if (container && container.contains(el)) return true;
      }
      return false;
    };

    window.__pw_getResultsContainer = function() {
      const feedElement = document.querySelector('div[role="feed"]');
      if (feedElement) {
        if (feedElement.scrollHeight > feedElement.clientHeight) return feedElement;
        const parent = feedElement.parentElement;
        if (parent && parent.scrollHeight > parent.clientHeight) return parent;
      }
      const scrollableSelectors = [
        'div.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde',
        'div.m6QErb.DxyBCb.kA9KIf.dS8AEf',
        'div.m6QErb.WNBkOb.XiKgde',
        'div.m6QErb.DxyBCb',
        'div.m6QErb'
      ];
      for (const selector of scrollableSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (el.scrollHeight > el.clientHeight + 100) return el;
        }
      }
      const articles = document.querySelectorAll('div[role="article"]');
      if (articles.length > 0) {
        let container = articles[0].parentElement;
        while (container && container !== document.body) {
          if (container.scrollHeight > container.clientHeight + 100) return container;
          container = container.parentElement;
        }
      }
      return null;
    };

    window.__pw_extractBusinessData = function(element) {
      const data = {
        name: null, rating: null, reviewCount: null, category: null,
        address: null, phone: null, website: null, googleMapsUrl: null
      };
      try {
        const linkElement = element.querySelector('a[href*="/maps/place/"]');
        if (linkElement) {
          data.googleMapsUrl = linkElement.href;
          const ariaLabel = linkElement.getAttribute('aria-label');
          if (ariaLabel) data.name = ariaLabel;
        }
        if (!data.name) {
          const nameElement = element.querySelector('div.fontHeadlineSmall') ||
            element.querySelector('div.qBF1Pd') ||
            element.querySelector('h3') ||
            element.querySelector('[class*="fontHeadline"]');
          if (nameElement) data.name = nameElement.textContent.trim();
        }
        const ratingElement = element.querySelector('span[role="img"][aria-label*="star"]') ||
          element.querySelector('span.MW4etd');
        if (ratingElement) {
          const ratingMatch = ratingElement.textContent.match(/[\d.]+/) ||
            ratingElement.getAttribute('aria-label')?.match(/[\d.]+/);
          if (ratingMatch) data.rating = parseFloat(ratingMatch[0]);
        }
        const reviewElement = element.querySelector('span.UY7F9');
        if (reviewElement) {
          const reviewMatch = reviewElement.textContent.match(/\(([\d,]+)\)/);
          if (reviewMatch) data.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
        } else {
          const ratingImg = element.querySelector('span[role="img"]');
          if (ratingImg) {
            const label = ratingImg.getAttribute('aria-label') || '';
            const reviewMatch = label.match(/([\d,]+)\s*review/i);
            if (reviewMatch) data.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
          }
        }
        const infoElements = element.querySelectorAll('div.W4Efsd');
        const notCategoryPatterns = [
          /^\d/, /^open\s/i, /^closes?\s/i, /reviews?$/i, /^\(/,
          /^·$/, /stars?$/i, /\d+:\d+/, /hours?$/i, /^\+/, /^http/i,
        ];
        for (const el of infoElements) {
          const spans = el.querySelectorAll('span');
          for (const span of spans) {
            const text = span.textContent.trim();
            if (!text || text === '·' || text.length > 40) continue;
            if (notCategoryPatterns.some(p => p.test(text))) continue;
            if (text.length >= 3 && text.length <= 35 && !text.match(/\d/) && !text.includes(',')) {
              data.category = text;
              break;
            }
          }
          if (data.category) break;
        }
        const textParts = [];
        infoElements.forEach(el => {
          const spans = el.querySelectorAll('span:not([role])');
          spans.forEach(span => {
            const text = span.textContent.trim();
            if (text && text !== '·' && text !== data.category) textParts.push(text);
          });
        });
        const possibleAddress = textParts.find(p =>
          (p.includes(',') || p.match(/^\d+\s+\w+/) || p.match(/\d+\/\d+/)) &&
          p.length > 10 && !p.match(/^open\s/i) && !p.match(/^\d+\.\d+/)
        );
        if (possibleAddress) data.address = possibleAddress;
        if (!data.address) {
          const addressSpans = element.querySelectorAll('span.W4Efsd span');
          for (const span of addressSpans) {
            const text = span.textContent.trim();
            if (text.match(/\d+.*\w{2,}/) && text.length > 10) {
              data.address = text;
              break;
            }
          }
        }
        const allText = element.textContent;
        const phoneMatch = allText.match(/(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
        if (phoneMatch) {
          const phone = phoneMatch[0].trim();
          if (phone.length >= 8 && phone.match(/\d/g)?.length >= 7) data.phone = phone;
        }
        const websiteButton = element.querySelector('a[data-value="Website"]') ||
          element.querySelector('a[aria-label*="website" i]');
        if (websiteButton) data.website = websiteButton.href;
      } catch (error) {
        console.warn('Error extracting business data:', error);
      }
      return data;
    };

    window.__pw_getVisibleListings = function() {
      const articles = document.querySelectorAll('div[role="article"]');
      if (articles.length > 0) return Array.from(articles);
      const listings = document.querySelectorAll('div.Nv2PK');
      if (listings.length > 0) return Array.from(listings);
      const links = document.querySelectorAll('a[href*="/maps/place/"]');
      const parentElements = new Set();
      links.forEach(link => {
        const parent = link.closest('div[jsaction]');
        if (parent) parentElements.add(parent);
      });
      return Array.from(parentElements);
    };

    window.__pw_hasReachedEndOfResults = function() {
      const endText = document.querySelector('span.HlvSq');
      if (endText) return true;
      const endPhrases = ["You've reached the end", "Ende der Liste", "Fin de la liste",
        "No more results", "Keine weiteren Ergebnisse"];
      const pageText = document.body?.innerText || '';
      return endPhrases.some(phrase => pageText.includes(phrase));
    };

    window.__pw_scrapeVisibleResults = function() {
      const listings = window.__pw_getVisibleListings();
      let newCount = 0;
      for (const listing of listings) {
        const data = window.__pw_extractBusinessData(listing);
        if (!data.name && !data.googleMapsUrl) continue;
        const identifier = data.googleMapsUrl || data.name;
        if (window.__pw_seenUrls.has(identifier)) continue;
        window.__pw_seenUrls.add(identifier);
        window.__pw_scrapedData.push(data);
        newCount++;
        if (window.__pw_scrapedData.length >= MAX_RESULTS) break;
      }
      return newCount;
    };

    window.__pw_scrollResults = function() {
      const container = window.__pw_getResultsContainer();
      if (!container) return false;
      const prevScrollTop = container.scrollTop;
      container.scrollTop = container.scrollHeight;
      return container.scrollTop > prevScrollTop;
    };
  });
}

// ============================================
// Core scraping logic
// ============================================

async function runScrape(industry, city, browser) {
  const searchQuery = `${industry} in ${city}`;
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const safeIndustry = industry.replace(/\s+/g, '-');
  const safeCity = city.replace(/\s+/g, '-');
  const fileTimestamp = timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const outputBase = `${safeIndustry}_${safeCity}_${fileTimestamp}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scraping: ${searchQuery}`);
  console.log(`Started:  ${timestamp}`);
  console.log(`${'='.repeat(60)}`);

  let page;
  try {
    page = await browser.newPage();

    // Navigate to Google Maps search
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    console.log(`Navigating to: ${mapsUrl}`);
    await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle Google consent dialog if it appears
    const hadConsent = await handleConsentDialog(page);
    if (hadConsent) {
      await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Wait for search results to load
    console.log('Waiting for search results...');
    await page.waitForSelector(
      'div[role="feed"], div[role="article"], div.Nv2PK',
      { timeout: MAPS_LOAD_TIMEOUT }
    );
    await page.waitForTimeout(3000);
    console.log('Search results loaded');

    // Inject the extension's scraping functions
    await injectScrapingFunctions(page);
    console.log('Scraping functions injected');

    // Run the scrape loop
    console.log('Starting scrape...');
    let noNewResultsCount = 0;
    let lastCount = 0;

    while (true) {
      // Scrape visible results
      const newCount = await page.evaluate(() => window.__pw_scrapeVisibleResults());
      const totalCount = await page.evaluate(() => window.__pw_scrapedData.length);

      if (totalCount !== lastCount) {
        console.log(`  Progress: ${totalCount} leads found (+${newCount} new)`);
        lastCount = totalCount;
      }

      if (newCount === 0) {
        noNewResultsCount++;

        // Check if we've reached the end
        const atEnd = await page.evaluate(() => window.__pw_hasReachedEndOfResults());
        if (atEnd) {
          console.log('  Reached end of results');
          break;
        }

        if (noNewResultsCount >= 10) {
          console.log('  No new results after 10 scroll attempts');
          break;
        }
      } else {
        noNewResultsCount = 0;
      }

      // Check max results
      if (totalCount >= 500) {
        console.log('  Reached max results (500)');
        break;
      }

      // Check timeout
      if (Date.now() - startTime > SCRAPE_MAX_WAIT) {
        console.log('  Scrape timeout reached');
        break;
      }

      // Scroll for more results
      const scrolled = await page.evaluate(() => window.__pw_scrollResults());

      // Wait for loading if maps is loading
      if (!scrolled) {
        const isLoading = await page.evaluate(() => window.__pw_isGoogleMapsLoading());
        if (isLoading) {
          await page.waitForTimeout(2000);
          continue;
        }
      }

      await page.waitForTimeout(2000);
    }

    // Get final data
    const data = await page.evaluate(() => window.__pw_scrapedData);
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    console.log(`\nScrape complete: ${data.length} leads in ${durationSeconds}s`);

    // Save results
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    // JSON output
    const jsonPath = path.join(RESULTS_DIR, `${outputBase}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      meta: {
        query: searchQuery,
        industry,
        city,
        timestamp,
        durationSeconds,
        resultCount: data.length
      },
      data
    }, null, 2));
    console.log(`JSON saved: ${jsonPath}`);

    // CSV output
    const csvPath = path.join(RESULTS_DIR, `${outputBase}.csv`);
    const csvContent = '\uFEFF' + dataToCSV(data);
    fs.writeFileSync(csvPath, csvContent);
    console.log(`CSV saved:  ${csvPath}`);

    // Update run log
    appendRunLog({
      timestamp,
      industry,
      city,
      query: searchQuery,
      resultCount: data.length,
      durationSeconds,
      outputFile: `${outputBase}.json`,
      status: 'success'
    });

    return { success: true, count: data.length, durationSeconds, outputBase };

  } catch (error) {
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    console.error(`\nScrape FAILED: ${error.message}`);

    appendRunLog({
      timestamp,
      industry,
      city,
      query: searchQuery,
      resultCount: 0,
      durationSeconds,
      outputFile: '',
      status: `error: ${error.message.slice(0, 100)}`
    });

    return { success: false, error: error.message, durationSeconds };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ============================================
// Google consent dialog handler
// ============================================

async function handleConsentDialog(page) {
  const url = page.url();
  if (!url.includes('consent.google')) {
    return false;
  }

  console.log('Google consent dialog detected, accepting...');

  try {
    const consentSelectors = [
      'button[aria-label="Accept all"]',
      'button[aria-label="Alle akzeptieren"]',
      'button:has-text("Accept all")',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("I agree")',
      'button:has-text("Ich stimme zu")',
      'button:has-text("Tout accepter")',
      'button:has-text("Aceptar todo")',
    ];

    for (const selector of consentSelectors) {
      try {
        const button = await page.waitForSelector(selector, { timeout: 3000 });
        if (button) {
          await button.click();
          await page.waitForURL('**/maps/**', { timeout: 15000 });
          console.log('Consent accepted, redirected to Maps');
          return true;
        }
      } catch {
        // Selector not found, try next
      }
    }
    console.warn('Could not find consent accept button');
    return false;
  } catch (err) {
    console.warn('Consent handling error:', err.message);
    return false;
  }
}

// ============================================
// Browser lifecycle
// ============================================

async function launchBrowser() {
  if (fs.existsSync(USER_DATA_DIR)) {
    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  }

  const launchArgs = [
    '--no-first-run',
    '--no-sandbox',
    '--disable-default-apps',
    '--disable-search-engine-choice-screen',
    '--no-default-browser-check',
  ];

  if (headless) {
    launchArgs.push('--headless=new');
  }

  // Use persistent context to preserve consent cookies across runs
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: '/usr/bin/google-chrome',
    args: launchArgs,
    viewport: { width: 1280, height: 900 },
  });

  return context;
}

// ============================================
// Main
// ============================================

async function main() {
  const queries = runAll
    ? PHASE1_QUERIES
    : [{ industry: filteredArgs[0], city: filteredArgs[1] }];

  console.log(`Playwright Scrape Runner — Phase 1`);
  console.log(`Queries: ${queries.length}`);
  console.log(`Mode: ${headless ? 'headless' : 'headed'}`);
  console.log('');

  const browser = await launchBrowser();

  const results = [];
  for (const { industry, city } of queries) {
    const result = await runScrape(industry, city, browser);
    results.push({ industry, city, ...result });

    if (queries.length > 1) {
      console.log('\nWaiting 5s before next query...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  await browser.close();

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('RUN SUMMARY');
  console.log(`${'='.repeat(60)}`);
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  console.log(`Total: ${results.length} | Passed: ${successful.length} | Failed: ${failed.length}`);
  console.log('');

  for (const r of results) {
    const status = r.success ? `OK ${r.count} leads (${r.durationSeconds}s)` : `FAIL ${r.error}`;
    console.log(`  ${r.industry} in ${r.city}: ${status}`);
  }

  console.log(`\nRun log: ${RUN_LOG_PATH}`);
  if (successful.length > 0) {
    console.log(`Results:  ${RESULTS_DIR}/`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
