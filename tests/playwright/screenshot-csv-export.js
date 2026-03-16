#!/usr/bin/env node

// Playwright Script — CSV Export Screenshot for Homepage Carousel
// Launches Chrome, renders scraped lead data as a clean spreadsheet-style table,
// and captures a polished screenshot suitable for marketing use.
//
// Uses real campaign data from previous scrape runs to ensure the screenshot
// always has verified emails and realistic business data.
//
// Usage:
//   node screenshot-csv-export.js
//   node screenshot-csv-export.js --headless
//
// Output:
//   /home/olivia/projects/konnex-labs-site/assets/images/screenshot-csv-export.png

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================
// Configuration
// ============================================

const RESULTS_DIR = path.join(__dirname, 'results');
const OUTPUT_PATH = '/home/olivia/projects/konnex-labs-site/assets/images/screenshot-csv-export.png';
const VIEWPORT_WIDTH = 1400;
const VIEWPORT_HEIGHT = 900;

const args = process.argv.slice(2);
const headless = args.includes('--headless');

// Human-emulation delays (ms)
function randomDelay(min = 500, max = 1500) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================
// Data Loading
// ============================================

/**
 * Find the most recent email-extracted CSV in the results directory.
 */
function findEmailCSV() {
  if (!fs.existsSync(RESULTS_DIR)) {
    throw new Error(`Results directory not found: ${RESULTS_DIR}`);
  }

  const files = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.includes('_emails_') && f.endsWith('.csv'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No email CSV files found in results directory. Run extract-emails.js first.');
  }

  return path.join(RESULTS_DIR, files[0]);
}

/**
 * Parse CSV file into array of objects.
 */
function parseCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''); // Strip BOM
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const headers = lines[0].split(',');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse — handles basic cases (our data doesn't have quoted commas in fields)
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Select the best rows for the screenshot — prioritize verified emails, diverse data.
 */
function selectBestRows(rows, count = 8) {
  // First: rows with verified emails
  const verified = rows.filter((r) => r.email && r.emailStatus === 'Verified');
  // Then: rows with unverified emails
  const unverified = rows.filter((r) => r.email && r.emailStatus === 'Unverified');
  // Then: rows with no email (show "Not Found" status)
  const noEmail = rows.filter((r) => !r.email || r.emailStatus === 'Not Found');

  // Mix: mostly verified, one or two unverified/not-found for realism
  const selected = [];
  const verifiedCount = Math.min(verified.length, count - 1);
  for (let i = 0; i < verifiedCount; i++) selected.push(verified[i]);

  // Add one not-found for realism (shows the tool is honest)
  if (noEmail.length > 0 && selected.length < count) {
    // Pick one that has other data (phone, website) to look good
    const goodNoEmail = noEmail.find((r) => r.phone && r.website) || noEmail[0];
    selected.push(goodNoEmail);
  }

  // Fill remaining with unverified if needed
  while (selected.length < count && unverified.length > selected.length - verifiedCount) {
    selected.push(unverified[selected.length - verifiedCount]);
  }

  // Fill any remaining slots
  const used = new Set(selected);
  for (const r of rows) {
    if (selected.length >= count) break;
    if (!used.has(r)) selected.push(r);
  }

  return selected.slice(0, count);
}

// ============================================
// HTML Table Renderer
// ============================================

/**
 * Generate a clean, styled HTML page that displays lead data as a spreadsheet.
 */
function renderTableHTML(rows) {
  // Columns to display — ordered for marketing impact
  const columns = [
    { key: 'name', label: 'Business Name', width: '220px' },
    { key: 'phone', label: 'Phone', width: '140px' },
    { key: 'website', label: 'Website', width: '200px' },
    { key: 'email', label: 'Email', width: '220px' },
    { key: 'emailStatus', label: 'Email Status', width: '110px' },
    { key: 'rating', label: 'Rating', width: '60px' },
    { key: 'category', label: 'Category', width: '140px' },
  ];

  function escapeHTML(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatCell(row, key) {
    const val = row[key] || '';
    if (!val || val === 'Not Found') {
      if (key === 'email') return '<span class="empty">—</span>';
      if (key === 'emailStatus') return '<span class="badge badge-notfound">Not Found</span>';
      return '<span class="empty">—</span>';
    }

    switch (key) {
      case 'emailStatus':
        if (val === 'Verified') return '<span class="badge badge-verified">✅ Verified</span>';
        if (val === 'Unverified') return '<span class="badge badge-unverified">⚠️ Unverified</span>';
        if (val === 'Invalid') return '<span class="badge badge-invalid">❌ Invalid</span>';
        return escapeHTML(val);
      case 'website': {
        // Show clean domain only
        const domain = val.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        return `<span class="website">${escapeHTML(domain)}</span>`;
      }
      case 'email':
        return `<span class="email">${escapeHTML(val)}</span>`;
      case 'rating':
        return val ? `⭐ ${val}` : '—';
      case 'category':
        // Fix German locale categories from VPS scrapes
        return escapeHTML(val.replace(/Hypothekenmakler/g, 'Mortgage Broker'));
      default:
        return escapeHTML(val);
    }
  }

  const tableRows = rows.map((row, idx) => {
    const cells = columns.map((col) =>
      `<td class="cell cell-${col.key}">${formatCell(row, col.key)}</td>`
    ).join('\n          ');
    return `        <tr class="${idx % 2 === 0 ? 'row-even' : 'row-odd'}">\n          ${cells}\n        </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8f9fa;
      padding: 32px 40px;
      color: #1a1a2e;
    }

    .export-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }
    .export-header h2 {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a2e;
    }
    .export-badge {
      background: #e8f5e9;
      color: #2e7d32;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 12px;
    }
    .export-info {
      font-size: 13px;
      color: #666;
      margin-left: auto;
    }

    .table-wrapper {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead th {
      background: #f1f5f9;
      color: #475569;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 14px;
      text-align: left;
      border-bottom: 2px solid #e2e8f0;
      white-space: nowrap;
    }

    td {
      padding: 11px 14px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-even { background: #fff; }
    .row-odd { background: #fafbfc; }
    tr:hover { background: #f0f4ff !important; }

    .cell-name { font-weight: 500; color: #1a1a2e; }
    .cell-phone { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: #334155; }

    .website {
      color: #3b82f6;
      font-size: 12px;
    }
    .email {
      color: #1e40af;
      font-weight: 500;
      font-size: 12px;
    }

    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .badge-verified { background: #dcfce7; color: #166534; }
    .badge-unverified { background: #fef9c3; color: #854d0e; }
    .badge-invalid { background: #fee2e2; color: #991b1b; }
    .badge-notfound { background: #f1f5f9; color: #64748b; }

    .empty { color: #cbd5e1; }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      font-size: 12px;
      color: #94a3b8;
    }
    .footer-logo {
      font-weight: 600;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="export-header">
    <h2>CSV Export — google-maps-leads.csv</h2>
    <span class="export-badge">${rows.length} leads</span>
    <span class="export-info">Exported from Maps Lead Scraper</span>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          ${columns.map((c) => `<th style="width:${c.width}">${c.label}</th>`).join('\n          ')}
        </tr>
      </thead>
      <tbody>
${tableRows}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span class="footer-logo">Maps Lead Scraper v2.5</span>
    <span>Emails verified via MX record lookup</span>
  </div>
</body>
</html>`;
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('=== CSV Export Screenshot Script ===\n');

  // Step 1: Load data
  const csvPath = findEmailCSV();
  console.log(`Loading data from: ${path.basename(csvPath)}`);
  const allRows = parseCSV(csvPath);
  console.log(`  ${allRows.length} total rows loaded`);

  // Step 2: Select best rows for screenshot
  const selectedRows = selectBestRows(allRows, 8);
  const withEmail = selectedRows.filter((r) => r.email).length;
  const verified = selectedRows.filter((r) => r.emailStatus === 'Verified').length;
  console.log(`  Selected ${selectedRows.length} rows (${withEmail} with email, ${verified} verified)\n`);

  // Step 3: Render HTML table
  const html = renderTableHTML(selectedRows);

  // Step 4: Launch browser and screenshot
  console.log(`Launching Chrome (${headless ? 'headless' : 'headed'})...`);
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 2, // Retina-quality screenshot
  });

  const page = await context.newPage();

  // Human-emulation: realistic pacing
  await sleep(randomDelay(500, 1000));

  // Load the rendered table
  await page.setContent(html, { waitUntil: 'networkidle' });
  await sleep(randomDelay(800, 1200));

  // Take screenshot locally first, then copy to Olivia's assets
  const localCopy = path.join(__dirname, 'screenshot-csv-export.png');

  // Take screenshot — full page captures the table cleanly
  await page.screenshot({
    path: localCopy,
    fullPage: true,
    type: 'png',
  });

  console.log(`Screenshot saved locally: ${localCopy}`);
  console.log(`\nTo deploy to Olivia's assets folder, run:`);
  console.log(`  sudo cp ${localCopy} ${OUTPUT_PATH}`);
  console.log(`  sudo chown olivia:olivia ${OUTPUT_PATH}`);

  await sleep(randomDelay(300, 600));
  await browser.close();

  // Verify output
  const stats = fs.statSync(localCopy);
  console.log(`\nDone! Screenshot: ${(stats.size / 1024).toFixed(0)}KB, ${VIEWPORT_WIDTH * 2}px wide (2x retina)`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
