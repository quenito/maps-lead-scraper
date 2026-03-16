#!/usr/bin/env node
/**
 * PPC Landing Page Carousel — 5 product demo screenshots
 *
 * 1. Maps loaded, keyword typed, extension open — pre-click (Ready state)
 * 2. Counter mid-run — scraping in progress with leads counting up
 * 3. Extraction in progress 65/99
 * 4. Extraction complete, export button visible, verification summary shown
 * 5. CSV table showing email + email source + verification status columns
 *
 * Usage:
 *   node take-carousel-screenshots.js
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const USER_DATA_DIR = path.join(__dirname, '.carousel-chrome-profile');
const OUTPUT_DIR = path.resolve(__dirname, '../../screenshots/carousel');

// NJ plumber leads for realistic data
const MOCK_LEADS = [
  { name: 'Von Plumbing & Heating', address: '12 Arden Rd, NJ 07054', phone: '(973) 224-3899', website: 'https://vonplumbing.com', rating: 5.0, reviewCount: 160, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/1' },
  { name: 'M J Grove Inc', address: '55 N Main St, NJ 08060', phone: '(609) 448-6083', website: null, rating: 5.0, reviewCount: 11, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/2' },
  { name: 'FIXALL Plumbing Heating & Air', address: '57 NJ-35, NJ 07755', phone: '(732) 991-2211', website: 'https://fixallplumbing.com', rating: 4.9, reviewCount: 257, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/3' },
  { name: 'Maccabi Plumbing & Heating', address: '79 Stanford Ave, NJ 07039', phone: '(908) 376-9159', website: 'https://maccabiplumbing.com', rating: 4.9, reviewCount: 217, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/4' },
  { name: 'Angler Plumbing & Heating', address: '598 Hickory Ave, NJ 07003', phone: '(201) 822-3899', website: 'https://anglerplumbing.com', rating: 5.0, reviewCount: 216, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/5' },
  { name: 'Chapman Bros Plumbing', address: '123 Commerce St, NJ 07201', phone: '(908) 356-3456', website: 'https://chapmanplumbing.com', rating: 4.8, reviewCount: 312, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/6' },
  { name: 'Schaaf Plumbing & Heating', address: '456 River Rd, NJ 07024', phone: '(201) 445-7890', website: 'https://schaafplumbing.com', rating: 4.7, reviewCount: 189, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/7' },
  { name: 'Dean Plumbing & Heating', address: '789 Main St, NJ 08901', phone: '(732) 555-1234', website: 'https://deanplumbing.com', rating: 4.9, reviewCount: 145, category: 'Plumber', googleMapsUrl: 'https://www.google.com/maps/place/8' },
];

// Generate 99 leads for the email extraction screenshots
function generateLeads(count) {
  const leads = [];
  const names = [
    'Von Plumbing & Heating', 'FIXALL Plumbing', 'Maccabi Plumbing', 'Angler Plumbing',
    'Chapman Bros Plumbing', 'Schaaf Plumbing', 'Dean Plumbing', 'Mastropiero Plumbing',
    'Stan\'s Plumbing', 'J&C Plumbing', 'Elite Pipe Works', 'Garden State Plumbing',
    'Jersey Drain Solutions', 'Metro Plumbing NJ', 'Tri-State Heating', 'Liberty Plumbing',
    'Hudson Plumbing Co', 'Newark Pipe & Drain', 'Central NJ Plumbing', 'Shore Plumbing',
    'Summit Plumbing', 'Bayshore Heating', 'Valley Plumbing', 'Horizon Plumbing',
    'Premier Pipe Solutions', 'All County Plumbing', 'First Call Plumbing', 'Pro Flow NJ',
    'East Coast Plumbing', 'Reliable Plumbing NJ', 'Quality Drain Services', 'NJ Master Plumber',
    'Aqua Systems Plumbing', 'Golden Faucet Services', 'Pine Brook Plumbing',
  ];
  for (let i = 0; i < count; i++) {
    leads.push({
      name: names[i % names.length] + (i >= names.length ? ` #${Math.floor(i / names.length) + 1}` : ''),
      address: `${100 + i} Main St, NJ`,
      phone: `(${900 + (i % 100)}) 555-${String(1000 + i).slice(-4)}`,
      website: i % 5 === 0 ? null : `https://example${i}.com`,
      rating: (4.0 + (i % 10) / 10).toFixed(1),
      reviewCount: 10 + i * 3,
      category: 'Plumber',
      googleMapsUrl: `https://www.google.com/maps/place/${i}`,
    });
  }
  return leads;
}

/**
 * Dismiss Google cookie consent wall (VPS is in Helsinki).
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

/**
 * Composite popup overlay onto map background using ImageMagick.
 */
function compositeScreenshot(bgPath, popupPath, outputPath) {
  // Add drop shadow to popup
  const shadowPath = popupPath.replace('.png', '-shadow.png');
  execSync(`convert "${popupPath}" \\( +clone -background black -shadow 60x8+0+4 \\) +swap -background none -layers merge +repage "${shadowPath}"`);

  // Get dimensions
  const bgDims = execSync(`identify -format "%wx%h" "${bgPath}"`).toString().trim();
  const shadowDims = execSync(`identify -format "%wx%h" "${shadowPath}"`).toString().trim();
  const [bgW, bgH] = bgDims.split('x').map(Number);
  const [shadowW, shadowH] = shadowDims.split('x').map(Number);

  // Position popup on right side, vertically centered
  const xOffset = Math.round(bgW - shadowW - Math.round(bgW * 0.04));
  const yOffset = Math.max(0, Math.round((bgH - shadowH) / 2 - Math.round(bgH * 0.03)));

  execSync(`composite -geometry +${xOffset}+${yOffset} "${shadowPath}" "${bgPath}" "${outputPath}"`);
  fs.unlinkSync(shadowPath);
}

// ============================================
// CSV Table Renderer (Screenshot 5)
// ============================================

function renderCSVTableHTML() {
  const rows = [
    { name: 'Von Plumbing & Heating', email: 'info@vonplumbing.com', emailSource: '🏠 Homepage', emailVerificationStatus: 'Verified', phone: '(973) 224-3899', website: 'vonplumbing.com', rating: '5.0', category: 'Plumber' },
    { name: 'FIXALL Plumbing Heating & Air', email: 'service@fixallplumbing.com', emailSource: '📧 Contact Page', emailVerificationStatus: 'Verified', phone: '(732) 991-2211', website: 'fixallplumbing.com', rating: '4.9', category: 'Plumber' },
    { name: 'Maccabi Plumbing & Heating', email: 'maccabi.plumbing@gmail.com', emailSource: '📘 Facebook', emailVerificationStatus: 'Verified', phone: '(908) 376-9159', website: 'maccabiplumbing.com', rating: '4.9', category: 'Plumber' },
    { name: 'Angler Plumbing & Heating', email: 'anglerphd@aol.com', emailSource: '🏠 Homepage', emailVerificationStatus: 'Unverified', phone: '(201) 822-3899', website: 'anglerplumbing.com', rating: '5.0', category: 'Plumber' },
    { name: 'Chapman Bros Plumbing', email: 'info@chapmanbros.com', emailSource: '📧 Contact Page', emailVerificationStatus: 'Verified', phone: '(908) 356-3456', website: 'chapmanbros.com', rating: '4.8', category: 'Plumber' },
    { name: 'Schaaf Plumbing & Heating', email: 'schaafplumbing@gmail.com', emailSource: '🔍 Social Search', emailVerificationStatus: 'Verified', phone: '(201) 445-7890', website: 'schaafplumbing.com', rating: '4.7', category: 'Plumber' },
    { name: 'M J Grove Inc', email: '', emailSource: '', emailVerificationStatus: 'Not Found', phone: '(609) 448-6083', website: '', rating: '5.0', category: 'Plumber' },
    { name: 'Dean Plumbing & Heating', email: 'contact@deanplumbing.com', emailSource: 'ℹ️ About Page', emailVerificationStatus: 'Verified', phone: '(732) 555-1234', website: 'deanplumbing.com', rating: '4.9', category: 'Plumber' },
  ];

  const columns = [
    { key: 'name', label: 'Business Name', width: '210px' },
    { key: 'email', label: 'Email', width: '220px' },
    { key: 'emailSource', label: 'Email Source', width: '140px' },
    { key: 'emailVerificationStatus', label: 'Verification Status', width: '140px' },
    { key: 'phone', label: 'Phone', width: '130px' },
    { key: 'website', label: 'Website', width: '180px' },
    { key: 'rating', label: 'Rating', width: '60px' },
  ];

  function escapeHTML(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatCell(row, key) {
    const val = row[key] || '';
    if (!val || val === 'Not Found') {
      if (key === 'email') return '<span class="empty">—</span>';
      if (key === 'emailSource') return '<span class="empty">—</span>';
      if (key === 'emailVerificationStatus') return '<span class="badge badge-notfound">Not Found</span>';
      return '<span class="empty">—</span>';
    }
    switch (key) {
      case 'emailVerificationStatus':
        if (val === 'Verified') return '<span class="badge badge-verified">✅ Verified</span>';
        if (val === 'Unverified') return '<span class="badge badge-unverified">⚠️ Unverified</span>';
        if (val === 'Invalid') return '<span class="badge badge-invalid">❌ Invalid</span>';
        return escapeHTML(val);
      case 'email':
        return `<span class="email">${escapeHTML(val)}</span>`;
      case 'website':
        return `<span class="website">${escapeHTML(val)}</span>`;
      case 'rating':
        return val ? `⭐ ${val}` : '—';
      default:
        return escapeHTML(val);
    }
  }

  const tableRows = rows.map((row, idx) => {
    const cells = columns.map((col) => `<td class="cell cell-${col.key}">${formatCell(row, col.key)}</td>`).join('\n          ');
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
      display: flex; align-items: center; gap: 16px; margin-bottom: 20px;
    }
    .export-header h2 { font-size: 18px; font-weight: 600; color: #1a1a2e; }
    .export-badge { background: #e8f5e9; color: #2e7d32; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 12px; }
    .export-info { font-size: 13px; color: #666; margin-left: auto; }
    .table-wrapper {
      background: #fff; border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
      overflow: hidden; border: 1px solid #e2e8f0;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th {
      background: #f1f5f9; color: #475569; font-weight: 600; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 14px;
      text-align: left; border-bottom: 2px solid #e2e8f0; white-space: nowrap;
    }
    td {
      padding: 11px 14px; border-bottom: 1px solid #f1f5f9;
      vertical-align: middle; max-width: 240px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .row-even { background: #fff; }
    .row-odd { background: #fafbfc; }
    tr:hover { background: #f0f4ff !important; }
    .cell-name { font-weight: 500; color: #1a1a2e; }
    .cell-phone { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: #334155; }
    .website { color: #3b82f6; font-size: 12px; }
    .email { color: #1e40af; font-weight: 500; font-size: 12px; }
    .badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
    .badge-verified { background: #dcfce7; color: #166534; }
    .badge-unverified { background: #fef9c3; color: #854d0e; }
    .badge-invalid { background: #fee2e2; color: #991b1b; }
    .badge-notfound { background: #f1f5f9; color: #64748b; }
    .empty { color: #cbd5e1; }
    .footer { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; font-size: 12px; color: #94a3b8; }
    .footer-logo { font-weight: 600; color: #64748b; }
  </style>
</head>
<body>
  <div class="export-header">
    <h2>CSV Export — plumbers-new-jersey.csv</h2>
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
    <span class="footer-logo">Maps Lead Scraper v3.0</span>
    <span>Emails verified via MX record lookup</span>
  </div>
</body>
</html>`;
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('=== PPC Carousel Screenshot Script ===\n');

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
    deviceScaleFactor: 2,
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

  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;

  // Helper: open popup with font blocking to prevent timeout
  async function openPopup() {
    const p = await context.newPage();
    await p.route('**/fonts.googleapis.com/**', route => route.abort());
    await p.route('**/fonts.gstatic.com/**', route => route.abort());
    await p.goto(popupUrl);
    await p.waitForLoadState('domcontentloaded');
    await p.waitForTimeout(1500);
    return p;
  }

  // ─── Capture or reuse Google Maps background ───
  console.log('\n--- Capturing Google Maps background ---');

  const existingHero = path.resolve(__dirname, '../../screenshots/hero-google-maps-scraper.png');
  const bgPath = path.join(OUTPUT_DIR, '_bg-maps.png');

  if (fs.existsSync(existingHero)) {
    // Reuse existing hero background — crop out the popup overlay by using just the left portion
    // or re-take a fresh map screenshot
    console.log('Taking fresh Google Maps screenshot...');
  }

  // Use existing hero screenshot as background — Google Maps is too resource-heavy
  // for headless Chrome on this VPS and crashes the browser context
  if (fs.existsSync(existingHero)) {
    // Resize existing hero to match our viewport (2x scale = 2560x1800)
    // Crop to remove the old popup overlay from the right side
    execSync(`convert "${existingHero}" -gravity West -crop 75%x100%+0+0 +repage -resize 2560x1800! "${bgPath}"`);
    console.log('Using existing hero screenshot as background (cropped + resized)');
  } else {
    throw new Error('No existing hero screenshot found. Run take-hero-screenshots.js first.');
  }

  // ─── Screenshot 1: Maps loaded, extension open, pre-click ───
  console.log('\n--- Screenshot 1: Pre-click ready state ---');

  // Set up popup in ready state — licensed, 0 leads, not scraping
  await sw.evaluate(() => {
    return chrome.storage.local.set({
      licenseStatus: { status: 'active', tier: 'standard', trialScrapesRemaining: 0, licenseKey: 'DEMO-XXXX-XXXX-XXXX', validatedAt: Date.now(), email: 'user@example.com' },
      scrapedData: [],
      scrapedDataWithEmails: [],
      isScrapin: false,
      isExtractingEmails: false,
      autoExtractEmails: true,
      notificationsEnabled: true,
      socialSearchEnabled: false,
    });
  });

  let popup = await openPopup();

  // Ensure clean ready state
  await popup.evaluate(() => {
    const errorMsg = document.getElementById('errorMessage');
    if (errorMsg) errorMsg.classList.remove('visible');
    const si = document.querySelector('.status-indicator');
    if (si) { si.classList.remove('error', 'scraping'); si.classList.add('ready'); }
    const st = document.getElementById('statusText');
    if (st) st.textContent = 'Ready';
  });

  await popup.locator('body').screenshot({ path: path.join(OUTPUT_DIR, '_popup-1.png') });
  await popup.close();

  compositeScreenshot(
    path.join(OUTPUT_DIR, '_bg-maps.png'),
    path.join(OUTPUT_DIR, '_popup-1.png'),
    path.join(OUTPUT_DIR, '01-ready-pre-click.png')
  );
  console.log('Saved 01-ready-pre-click.png');

  // ─── Screenshot 2: Counter mid-run ───
  console.log('\n--- Screenshot 2: Scraping in progress ---');

  await sw.evaluate((leads) => {
    return chrome.storage.local.set({
      scrapedData: leads,
      isScrapin: true,
      isExtractingEmails: false,
    });
  }, MOCK_LEADS.slice(0, 8));

  popup = await openPopup();

  await popup.evaluate(() => {
    const errorMsg = document.getElementById('errorMessage');
    if (errorMsg) errorMsg.classList.remove('visible');
    const si = document.querySelector('.status-indicator');
    if (si) { si.classList.remove('error', 'ready'); si.classList.add('scraping'); }
    const st = document.getElementById('statusText');
    if (st) st.textContent = 'Collecting';
    // Show the lead count
    const lc = document.getElementById('leadCount');
    if (lc) lc.textContent = '47';
  });

  await popup.locator('body').screenshot({ path: path.join(OUTPUT_DIR, '_popup-2.png') });
  await popup.close();

  compositeScreenshot(
    path.join(OUTPUT_DIR, '_bg-maps.png'),
    path.join(OUTPUT_DIR, '_popup-2.png'),
    path.join(OUTPUT_DIR, '02-scraping-mid-run.png')
  );
  console.log('Saved 02-scraping-mid-run.png');

  // ─── Screenshot 3: Email extraction in progress 65/99 ───
  console.log('\n--- Screenshot 3: Email extraction 65/99 ---');

  const allLeads = generateLeads(99);
  await sw.evaluate((leads) => {
    return chrome.storage.local.set({
      scrapedData: leads,
      isScrapin: false,
      isExtractingEmails: true,
      emailExtractionProgress: {
        current: 65,
        total: 99,
        businessName: 'Garden State Plumbing',
      },
    });
  }, allLeads);

  popup = await openPopup();

  await popup.evaluate(() => {
    const errorMsg = document.getElementById('errorMessage');
    if (errorMsg) errorMsg.classList.remove('visible');
    const si = document.querySelector('.status-indicator');
    if (si) { si.classList.remove('error', 'ready'); si.classList.add('scraping'); }
    const st = document.getElementById('statusText');
    if (st) st.textContent = 'Extracting Contact Info...';
    // Make sure lead count shows 99
    const lc = document.getElementById('leadCount');
    if (lc) lc.textContent = '99';
  });

  await popup.locator('body').screenshot({ path: path.join(OUTPUT_DIR, '_popup-3.png') });
  await popup.close();

  compositeScreenshot(
    path.join(OUTPUT_DIR, '_bg-maps.png'),
    path.join(OUTPUT_DIR, '_popup-3.png'),
    path.join(OUTPUT_DIR, '03-extraction-progress.png')
  );
  console.log('Saved 03-extraction-progress.png');

  // ─── Screenshot 4: Extraction complete with verification summary ───
  console.log('\n--- Screenshot 4: Extraction complete ---');

  // Build mock enriched data with verification statuses
  const enrichedLeads = allLeads.map((lead, i) => ({
    ...lead,
    emails: i % 4 === 0 ? [] : [`info@example${i}.com`],
    emailSource: i % 4 === 0 ? null : '🏠 Homepage',
    emailVerificationStatus: i % 4 === 0 ? null : (i % 7 === 0 ? 'Unverified' : (i % 11 === 0 ? 'Invalid' : 'Verified')),
  }));

  await sw.evaluate((leads) => {
    return chrome.storage.local.set({
      scrapedData: leads,
      scrapedDataWithEmails: leads,
      isScrapin: false,
      isExtractingEmails: false,
      emailExtractionProgress: null,
    });
  }, enrichedLeads);

  popup = await openPopup();

  // Count verification statuses for the summary
  const verified = enrichedLeads.filter(l => l.emailVerificationStatus === 'Verified').length;
  const unverified = enrichedLeads.filter(l => l.emailVerificationStatus === 'Unverified').length;
  const invalid = enrichedLeads.filter(l => l.emailVerificationStatus === 'Invalid').length;
  const emailsFound = enrichedLeads.filter(l => l.emails && l.emails.length > 0).length;

  await popup.evaluate(({ emailsFound, verified, unverified, invalid }) => {
    // Hide ALL error messages — including the "navigate to Maps" warning
    const errorMsg = document.getElementById('errorMessage');
    if (errorMsg) { errorMsg.classList.remove('visible'); errorMsg.style.display = 'none'; }
    // Also hide any other error-like elements
    document.querySelectorAll('.error-message, [class*="error"], [class*="warning"]').forEach(el => {
      el.style.display = 'none';
    });

    const si = document.querySelector('.status-indicator');
    if (si) { si.classList.remove('error', 'scraping'); si.classList.add('ready'); }
    const st = document.getElementById('statusText');
    if (st) st.textContent = 'Ready';
    const lc = document.getElementById('leadCount');
    if (lc) lc.textContent = '99';

    // Show email section with completion state
    const emailSection = document.getElementById('emailSection');
    if (emailSection) emailSection.style.display = 'block';
    const emailStatus = document.getElementById('emailStatus');
    if (emailStatus) emailStatus.textContent = `Done! Found emails for ${emailsFound} businesses`;
    const emailCount = document.getElementById('emailCount');
    if (emailCount) emailCount.textContent = '99/99';
    const progressFill = document.getElementById('progressFill');
    if (progressFill) progressFill.style.width = '100%';
    const currentBusiness = document.getElementById('currentBusiness');
    if (currentBusiness) currentBusiness.textContent = '';
    const cancelBtn = document.getElementById('cancelEmailBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Show verification summary
    const summaryEl = document.getElementById('verificationSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `<span class="v-verified">✅ ${verified} Verified</span> <span class="v-unverified">⚠️ ${unverified} Unverified</span> <span class="v-invalid">❌ ${invalid} Invalid</span>`;
      summaryEl.style.display = 'flex';
    }
  }, { emailsFound, verified, unverified, invalid });

  await popup.locator('body').screenshot({ path: path.join(OUTPUT_DIR, '_popup-4.png') });
  await popup.close();

  compositeScreenshot(
    path.join(OUTPUT_DIR, '_bg-maps.png'),
    path.join(OUTPUT_DIR, '_popup-4.png'),
    path.join(OUTPUT_DIR, '04-extraction-complete.png')
  );
  console.log('Saved 04-extraction-complete.png');

  await context.close();

  // ─── Screenshot 5: CSV table with verification status ───
  console.log('\n--- Screenshot 5: CSV table ---');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const csvContext = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  });
  const csvPage = await csvContext.newPage();
  const csvHTML = renderCSVTableHTML();
  await csvPage.setContent(csvHTML, { waitUntil: 'networkidle' });
  await csvPage.waitForTimeout(1000);

  await csvPage.screenshot({
    path: path.join(OUTPUT_DIR, '05-csv-export.png'),
    fullPage: true,
    type: 'png',
  });
  console.log('Saved 05-csv-export.png');
  await browser.close();

  // ─── Cleanup intermediate files ───
  const intermediateFiles = ['_bg-maps.png', '_popup-1.png', '_popup-2.png', '_popup-3.png', '_popup-4.png'];
  for (const f of intermediateFiles) {
    const p = path.join(OUTPUT_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // Clean up Chrome profile
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  // Print results
  console.log(`\n=== Carousel screenshots saved to ${OUTPUT_DIR}/ ===`);
  const finals = fs.readdirSync(OUTPUT_DIR).filter(f => f.match(/^\d{2}-/)).sort();
  for (const f of finals) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f} — ${(stat.size / 1024).toFixed(0)} KB`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Carousel screenshot failed:', err);
  process.exit(1);
});
