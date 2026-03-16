#!/usr/bin/env node

// EOOC Campaign #5 — Broad accountant sweep across 30 Sydney suburbs
//
// Scrapes "accountant" + each suburb on Google Maps, saves individual + combined
// results, and generates a summary table for Brian's suburb selection.
//
// Usage:
//   node run-eooc-campaign5.js --headless          # Full 30-suburb sweep
//   node run-eooc-campaign5.js --suburb "Newtown"   # Single suburb test
//   node run-eooc-campaign5.js --resume --headless   # Resume from last run

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================
// Configuration
// ============================================

const USER_DATA_DIR = path.join(__dirname, '.chrome-profile');
const CAMPAIGN_DIR = path.join(__dirname, 'results', 'eooc_campaign5');

const INDUSTRY = 'accountant';

// 30 suburbs grouped by region
const SUBURBS = [
  // Inner City / CBD
  'Sydney CBD', 'Surry Hills', 'Pyrmont', 'Ultimo',
  // Inner West
  'Newtown', 'Leichhardt', 'Balmain', 'Marrickville', 'Ashfield',
  // Inner East
  'Bondi Junction', 'Randwick', 'Paddington', 'Woollahra',
  // North Sydney
  'North Sydney', 'Crows Nest', 'Neutral Bay', 'St Leonards', 'Chatswood',
  // West
  'Parramatta', 'Westmead', 'Strathfield', 'Burwood',
  // South
  'Hurstville', 'Kogarah', 'Rockdale', 'Miranda',
  // Northern Beaches
  'Manly', 'Dee Why', 'Mona Vale',
];

// Timeouts
const MAPS_LOAD_TIMEOUT = 30000;
const SCRAPE_MAX_WAIT = 300000; // 5 min per suburb

// CSV headers for the combined output
const CSV_HEADERS = [
  'name', 'suburb', 'address', 'website', 'phone', 'email',
  'rating', 'reviewCount', 'category', 'googleMapsUrl'
];

// Progress tracking file (for --resume)
const PROGRESS_FILE = path.join(CAMPAIGN_DIR, '_progress.json');

// ============================================
// Argument parsing
// ============================================

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const resume = args.includes('--resume');
const singleSuburbIdx = args.indexOf('--suburb');
const singleSuburb = singleSuburbIdx !== -1 ? args[singleSuburbIdx + 1] : null;

if (singleSuburb && !SUBURBS.includes(singleSuburb)) {
  console.error(`Unknown suburb: "${singleSuburb}"`);
  console.error(`Available suburbs:\n  ${SUBURBS.join('\n  ')}`);
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

function dataToCSV(data, headers) {
  const headerRow = headers.join(',');
  const rows = data.map(row =>
    headers.map(h => escapeCSV(row[h])).join(',')
  );
  return [headerRow, ...rows].join('\n');
}

// ============================================
// Progress tracking
// ============================================

function loadProgress() {
  if (!resume || !fs.existsSync(PROGRESS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ============================================
// Content script injection (from run-scrape.js)
// ============================================

async function injectScrapingFunctions(page) {
  await page.evaluate(() => {
    window.__pw_scrapedData = [];
    window.__pw_seenUrls = new Set();
    window.__pw_isScrapin = false;

    const MAX_RESULTS = 500;

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
// Google consent handler
// ============================================

async function handleConsentDialog(page) {
  const url = page.url();
  if (!url.includes('consent.google')) return false;

  console.log('  Google consent dialog detected, accepting...');
  try {
    const consentSelectors = [
      'button[aria-label="Accept all"]',
      'button[aria-label="Alle akzeptieren"]',
      'button:has-text("Accept all")',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("I agree")',
      'button:has-text("Tout accepter")',
      'button:has-text("Hyväksy kaikki")',
    ];
    for (const selector of consentSelectors) {
      try {
        const button = await page.waitForSelector(selector, { timeout: 3000 });
        if (button) {
          await button.click();
          await page.waitForURL('**/maps/**', { timeout: 15000 });
          console.log('  Consent accepted');
          return true;
        }
      } catch { /* try next */ }
    }
    return false;
  } catch (err) {
    console.warn('  Consent handling error:', err.message);
    return false;
  }
}

// ============================================
// Core scraping — single suburb
// ============================================

async function scrapeSuburb(suburb, browser) {
  const searchQuery = `${INDUSTRY} in ${suburb} Sydney`;
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n--- Scraping: ${searchQuery} ---`);

  let page;
  try {
    page = await browser.newPage();

    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=en`;
    await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const hadConsent = await handleConsentDialog(page);
    if (hadConsent) {
      await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Wait for results
    console.log('  Waiting for results...');
    await page.waitForSelector(
      'div[role="feed"], div[role="article"], div.Nv2PK',
      { timeout: MAPS_LOAD_TIMEOUT }
    );
    await page.waitForTimeout(3000);

    // Inject scraping functions
    await injectScrapingFunctions(page);

    // Scrape loop
    let noNewResultsCount = 0;
    let lastCount = 0;

    while (true) {
      const newCount = await page.evaluate(() => window.__pw_scrapeVisibleResults());
      const totalCount = await page.evaluate(() => window.__pw_scrapedData.length);

      if (totalCount !== lastCount) {
        console.log(`  ${totalCount} leads (+${newCount})`);
        lastCount = totalCount;
      }

      if (newCount === 0) {
        noNewResultsCount++;
        const atEnd = await page.evaluate(() => window.__pw_hasReachedEndOfResults());
        if (atEnd) {
          console.log('  End of results');
          break;
        }
        if (noNewResultsCount >= 10) {
          console.log('  No new results after 10 scrolls');
          break;
        }
      } else {
        noNewResultsCount = 0;
      }

      if (totalCount >= 500) {
        console.log('  Max results (500)');
        break;
      }

      if (Date.now() - startTime > SCRAPE_MAX_WAIT) {
        console.log('  Timeout');
        break;
      }

      const scrolled = await page.evaluate(() => window.__pw_scrollResults());
      if (!scrolled) {
        const isLoading = await page.evaluate(() => window.__pw_isGoogleMapsLoading());
        if (isLoading) {
          await page.waitForTimeout(2000);
          continue;
        }
      }
      await page.waitForTimeout(2000);
    }

    const data = await page.evaluate(() => window.__pw_scrapedData);
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    // Add suburb tag to each record
    for (const record of data) {
      record.suburb = suburb;
      // email placeholder (no email extraction in scrape phase)
      record.email = '';
    }

    console.log(`  Done: ${data.length} leads in ${durationSeconds}s`);

    // Save individual suburb JSON
    const safeSuburb = suburb.replace(/\s+/g, '-').toLowerCase();
    const jsonPath = path.join(CAMPAIGN_DIR, `accountant_${safeSuburb}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      meta: { query: searchQuery, suburb, timestamp, durationSeconds, resultCount: data.length },
      data
    }, null, 2));

    return { suburb, success: true, count: data.length, durationSeconds, data };

  } catch (error) {
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    console.error(`  FAILED: ${error.message}`);
    return { suburb, success: false, error: error.message, durationSeconds, data: [] };

  } finally {
    if (page) await page.close().catch(() => {});
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
  const suburbs = singleSuburb ? [singleSuburb] : SUBURBS;
  const progress = loadProgress();
  const completedSuburbs = new Set(Object.keys(progress).filter(s => progress[s]?.success));

  // Determine which suburbs still need scraping
  let toScrape = suburbs;
  if (resume && completedSuburbs.size > 0) {
    toScrape = suburbs.filter(s => !completedSuburbs.has(s));
    console.log(`Resuming: ${completedSuburbs.size} done, ${toScrape.length} remaining`);
  }

  console.log(`EOOC Campaign #5 — Accountant Sweep`);
  console.log(`Suburbs: ${toScrape.length} of ${suburbs.length}`);
  console.log(`Mode: ${headless ? 'headless' : 'headed'}`);
  console.log('');

  fs.mkdirSync(CAMPAIGN_DIR, { recursive: true });

  const browser = await launchBrowser();
  const allResults = [];

  // Load previously completed results for aggregation
  if (resume) {
    for (const suburb of Object.keys(progress)) {
      if (progress[suburb]?.success && progress[suburb]?.data) {
        allResults.push(progress[suburb]);
      }
    }
  }

  for (let i = 0; i < toScrape.length; i++) {
    const suburb = toScrape[i];
    console.log(`\n[${i + 1}/${toScrape.length}] ${suburb}`);

    const result = await scrapeSuburb(suburb, browser);
    allResults.push(result);

    // Save progress
    progress[suburb] = {
      success: result.success,
      count: result.count || 0,
      durationSeconds: result.durationSeconds,
      error: result.error || null,
      data: result.data,
    };
    saveProgress(progress);

    // Delay between suburbs to avoid rate limiting
    if (i < toScrape.length - 1) {
      console.log('  Waiting 5s...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  await browser.close();

  // ─── Aggregate Results ───

  console.log(`\n${'='.repeat(60)}`);
  console.log('AGGREGATING RESULTS');
  console.log(`${'='.repeat(60)}\n`);

  // Combine all lead data
  const allData = [];
  const summaryRows = [];

  for (const suburb of suburbs) {
    const suburbProgress = progress[suburb];
    if (!suburbProgress) {
      summaryRows.push({ suburb, resultCount: 0, emailsFound: 0, status: 'SKIPPED' });
      continue;
    }
    if (!suburbProgress.success) {
      summaryRows.push({ suburb, resultCount: 0, emailsFound: 0, status: 'FAILED' });
      continue;
    }

    const data = suburbProgress.data || [];
    allData.push(...data);
    const emailsFound = data.filter(d => d.email && d.email.trim()).length;
    summaryRows.push({ suburb, resultCount: data.length, emailsFound, status: 'OK' });
  }

  // Deduplicate by googleMapsUrl
  const seen = new Set();
  const uniqueData = [];
  for (const record of allData) {
    const key = record.googleMapsUrl || record.name;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueData.push(record);
  }

  const dupeCount = allData.length - uniqueData.length;
  console.log(`Total leads: ${allData.length} (${dupeCount} cross-suburb duplicates removed → ${uniqueData.length} unique)`);

  // Save combined CSV
  const csvPath = path.join(CAMPAIGN_DIR, 'eooc_campaign5_accountants_sydney_raw.csv');
  const csvContent = '\uFEFF' + dataToCSV(uniqueData, CSV_HEADERS);
  fs.writeFileSync(csvPath, csvContent);
  console.log(`Combined CSV: ${csvPath}`);

  // Save combined JSON
  const jsonPath = path.join(CAMPAIGN_DIR, 'eooc_campaign5_accountants_sydney_raw.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    meta: {
      campaign: 'EOOC Campaign #5',
      industry: INDUSTRY,
      city: 'Sydney',
      suburbCount: suburbs.length,
      totalLeads: uniqueData.length,
      duplicatesRemoved: dupeCount,
      timestamp: new Date().toISOString(),
    },
    data: uniqueData
  }, null, 2));

  // ─── Summary Table ───

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY TABLE');
  console.log(`${'='.repeat(60)}\n`);

  const colW = { suburb: 22, count: 8, emails: 8, status: 8 };
  const header = `${'Suburb'.padEnd(colW.suburb)} | ${'Results'.padStart(colW.count)} | ${'Emails'.padStart(colW.emails)} | ${'Status'.padEnd(colW.status)}`;
  const divider = '-'.repeat(header.length);

  console.log(header);
  console.log(divider);

  let totalLeads = 0;
  let totalEmails = 0;

  for (const row of summaryRows) {
    totalLeads += row.resultCount;
    totalEmails += row.emailsFound;
    console.log(
      `${row.suburb.padEnd(colW.suburb)} | ${String(row.resultCount).padStart(colW.count)} | ${String(row.emailsFound).padStart(colW.emails)} | ${row.status.padEnd(colW.status)}`
    );
  }

  console.log(divider);
  console.log(`${'TOTAL'.padEnd(colW.suburb)} | ${String(totalLeads).padStart(colW.count)} | ${String(totalEmails).padStart(colW.emails)} |`);
  console.log(`${'UNIQUE (deduped)'.padEnd(colW.suburb)} | ${String(uniqueData.length).padStart(colW.count)} |`);

  // Save summary as text file
  const summaryPath = path.join(CAMPAIGN_DIR, 'summary.txt');
  let summaryText = `EOOC Campaign #5 — Accountant Sweep Summary\n`;
  summaryText += `Generated: ${new Date().toISOString()}\n\n`;
  summaryText += `${header}\n${divider}\n`;
  for (const row of summaryRows) {
    summaryText += `${row.suburb.padEnd(colW.suburb)} | ${String(row.resultCount).padStart(colW.count)} | ${String(row.emailsFound).padStart(colW.emails)} | ${row.status.padEnd(colW.status)}\n`;
  }
  summaryText += `${divider}\n`;
  summaryText += `${'TOTAL'.padEnd(colW.suburb)} | ${String(totalLeads).padStart(colW.count)} | ${String(totalEmails).padStart(colW.emails)} |\n`;
  summaryText += `${'UNIQUE (deduped)'.padEnd(colW.suburb)} | ${String(uniqueData.length).padStart(colW.count)} |\n`;
  fs.writeFileSync(summaryPath, summaryText);

  // Save summary as JSON (for Notion posting)
  const summaryJsonPath = path.join(CAMPAIGN_DIR, 'summary.json');
  fs.writeFileSync(summaryJsonPath, JSON.stringify({
    summaryRows,
    totalLeads,
    totalEmails,
    uniqueLeads: uniqueData.length,
    duplicatesRemoved: dupeCount,
  }, null, 2));

  console.log(`\nSummary saved: ${summaryPath}`);
  console.log(`\nDone.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
