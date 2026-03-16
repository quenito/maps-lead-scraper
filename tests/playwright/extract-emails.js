#!/usr/bin/env node
// ============================================
// Campaign Email Extractor — Playwright Suite
// ============================================
// Runs the extension's 7-layer email extraction + 3-layer verification
// pipeline against Phase 2 scrape results (JSON files).
//
// Same logic as the extension's service-worker.js — ported for headless use.
//
// Usage:
//   node extract-emails.js                    # Process all mortgage-broker results
//   node extract-emails.js Sydney             # Process one city
//   node extract-emails.js --concurrency 5    # Parallel workers (default: 3)

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============================================
// Configuration
// ============================================

const RESULTS_DIR = path.join(__dirname, 'results');
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--concurrency') || '3');
const TARGET_CITY = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);
const FETCH_TIMEOUT = 8000;   // 8s per page fetch
const DELAY_BETWEEN = 300;    // 300ms between businesses

// ============================================
// Email Patterns (same as extension service-worker.js)
// ============================================

const EMAIL_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
];

const FALSE_POSITIVE_PATTERNS = [
  /example\.com$/i, /test\.com$/i, /domain\.com$/i, /domainname\.com$/i,
  /email\.com$/i, /yoursite\.com$/i, /mysite\.com$/i, /website\.com$/i,
  /company\.com$/i, /yourdomain\.com$/i, /yourcompany\.com$/i,
  /samplesite\.com$/i, /placeholder\.com$/i,
  /latofonts\.com$/i, /impallari@/i, /wordpress.*@/i, /developer.*@/i,
  /admin@admin\./i, /user@user\./i, /info@info\./i,
  /sentry\.io$/i, /wixpress\.com$/i, /wix\.com$/i, /squarespace\.com$/i,
  /godaddy\.com$/i, /w3\.org$/i, /schema\.org$/i, /googleapis\.com$/i,
  /google\.com$/i, /gstatic\.com$/i, /cloudflare\.com$/i,
  /jsdelivr\.net$/i, /bootstrapcdn\.com$/i,
  /2x\.png$/i, /\.jpg$/i, /\.jpeg$/i, /\.png$/i, /\.gif$/i, /\.webp$/i, /\.svg$/i,
  /^john@(?!.*business)/i, /^jane@(?!.*business)/i, /^test@/i, /^demo@/i,
  /^sample@/i, /^example@/i, /^your-?email@/i, /^email@/i, /^name@/i, /^some@/i
];

const CONTACT_PAGE_PATTERNS = [
  /contact/i, /kontakt/i, /about-us/i, /about/i,
  /get-in-touch/i, /reach-us/i, /enquiry/i, /enquiries/i, /support/i
];

const DIRECT_CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us'];

const SOCIAL_MEDIA_PATTERNS = {
  facebook: {
    domain: /(?:www\.)?facebook\.com/i,
    exclude: /facebook\.com\/(?:sharer|share|dialog|plugins|login|pages\/create)/i,
    match: /facebook\.com\/(?:people\/|pages\/|profile\.php\?id=|groups\/)?[a-zA-Z0-9._-]+\/?/i
  },
  instagram: {
    domain: /(?:www\.)?instagram\.com/i,
    exclude: /instagram\.com\/(?:accounts|explore|direct|stories|p\/)/i,
    match: /instagram\.com\/[a-zA-Z0-9._]+\/?/i
  },
  linkedin: {
    domain: /(?:www\.)?linkedin\.com/i,
    exclude: /linkedin\.com\/(?:share|shareArticle|pulse|learning)/i,
    match: /linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+\/?/i
  },
  twitter: {
    domain: /(?:www\.)?(?:twitter\.com|x\.com)/i,
    exclude: /(?:twitter|x)\.com\/(?:intent|share|home|search|hashtag)/i,
    match: /(?:twitter|x)\.com\/[a-zA-Z0-9_]+\/?/i
  }
};

// ============================================
// Disposable email domains (~200 common ones)
// ============================================

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'tempmail.com',
  'throwaway.email', 'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com',
  'grr.la', 'dispostable.com', 'mailnesia.com', 'maildrop.cc', 'discard.email',
  'trashmail.com', 'trashmail.me', 'trashmail.net', 'temp-mail.org',
  'fakeinbox.com', 'tempail.com', 'jetable.org', 'trash-mail.com',
  'harakirimail.com', 'mailexpire.com', 'throwam.com', 'spamgourmet.com',
  'mytrashmail.com', 'gishpuppy.com', 'incognitomail.com', 'mailcatch.com',
  'mailscrap.com', 'mailmoat.com', 'mailnull.com', 'spamfree24.org',
  'trashymail.com', 'mailzilla.com', 'devnullmail.com', 'letthemeatspam.com',
  'safetymail.info', 'spambox.us', 'spamavert.com', 'filzmail.com',
  'mailblocks.com', 'tempr.email', 'tempmailaddress.com', 'tempinbox.com',
  'emailondeck.com', 'disposableemailaddresses.emailmiser.com',
  'guerrillamail.de', 'guerrillamail.biz', 'guerrillamail.org',
  'mintemail.com', 'tempomail.fr', 'pookmail.com', 'throwawaymail.com',
  'bugmenot.com', 'binkmail.com', 'sogetthis.com', 'mailinator.net',
  'trashymail.net', 'kasmail.com', 'anonmails.de', 'dontreg.com',
  'fakemailgenerator.com', 'getnada.com', 'emailfake.com',
  'tempmailo.com', 'mohmal.com', 'burnermail.io', 'guerrillamail.info',
  'nomail.xl.cx', 'rmqkr.net', 'cuvox.de', 'dayrep.com', 'einrot.com',
  'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com',
  'teleworm.us', 'armyspy.com', 'despammed.com', 'wuzup.net',
  'trash2009.com', 'boun.cr', 'dingbone.com', 'fudgerub.com',
  'lookugly.com', 'shitmail.me', 'vidchart.com',
  '10minutemail.com', '10minutemail.net', '20minutemail.com',
  'coconut.finance', 'minutemail.com', 'mt2015.com',
  'spamcero.com', 'uggsrock.com', 'veryreallysmart.com',
  'wegwerfmail.de', 'wegwerfmail.net', 'mailforspam.com',
  'safetypost.de', 'emkei.cz', 'ephemail.net',
  'tempmail.net', 'tmpmail.net', 'tmpmail.org',
  'mailtemp.info', 'disbox.net', 'disbox.org',
  'emailisvalid.com', 'emailresolver.com', 'fakemailgenerator.net',
  'fakemail.net', 'getairmail.com', 'instant-mail.de',
  'objectmail.com', 'proxymail.eu', 'rcpt.at',
  'reallymymail.com', 'recipeforfailure.com', 'regbypass.com',
  'spaml.com', 'spamoff.de', 'thankyou2010.com',
  'vomoto.com', 'wasabi.finance', 'yolanda.dev'
]);

// ============================================
// Email Extraction Functions (same as extension)
// ============================================

function extractEmailsFromHTML(html) {
  const emails = new Set();
  for (const pattern of EMAIL_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const matches = html.match(pattern) || [];
    for (let match of matches) {
      try { match = decodeURIComponent(match); } catch (e) {}
      match = match.replace(/^mailto:/i, '').trim().toLowerCase();

      let isFalsePositive = false;
      for (const fpPattern of FALSE_POSITIVE_PATTERNS) {
        if (fpPattern.test(match)) { isFalsePositive = true; break; }
      }
      if (!isFalsePositive && match.includes('@') && match.includes('.')) {
        emails.add(match);
      }
    }
  }
  return Array.from(emails);
}

function findContactPageUrls(html, baseUrl) {
  const contactUrls = new Set();
  try {
    const base = new URL(baseUrl);
    const baseOrigin = base.origin;

    const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      const href = match[1];
      const linkText = match[2];
      const isContactLink = CONTACT_PAGE_PATTERNS.some(p => p.test(href) || p.test(linkText));
      if (isContactLink) {
        try {
          let fullUrl;
          if (href.startsWith('http://') || href.startsWith('https://')) {
            const linkUrl = new URL(href);
            if (linkUrl.origin === baseOrigin) fullUrl = href;
          } else if (href.startsWith('/')) {
            fullUrl = baseOrigin + href;
          } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
            fullUrl = baseOrigin + '/' + href;
          }
          if (fullUrl && fullUrl !== baseUrl) contactUrls.add(fullUrl);
        } catch (e) {}
      }
    }

    const navLinkPattern = /href=["']([^"']*(?:contact|kontakt|about|enquir|support)[^"']*)["']/gi;
    while ((match = navLinkPattern.exec(html)) !== null) {
      const href = match[1];
      try {
        let fullUrl;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          const linkUrl = new URL(href);
          if (linkUrl.origin === baseOrigin) fullUrl = href;
        } else if (href.startsWith('/')) {
          fullUrl = baseOrigin + href;
        } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
          fullUrl = baseOrigin + '/' + href;
        }
        if (fullUrl && fullUrl !== baseUrl) contactUrls.add(fullUrl);
      } catch (e) {}
    }
  } catch (e) {}
  return Array.from(contactUrls).slice(0, 3);
}

function hasEmbeddedContactForm(html) {
  const lowerHtml = html.toLowerCase();
  if (!lowerHtml.includes('<form')) return false;
  const hasEmailInput = /type=["']email["']|name=["'][^"']*email[^"']*["']/i.test(html);
  const hasContactText = /contact\s*us|get\s*in\s*touch|send\s*us\s*a\s*message|schedule\s*(your|an)\s*appointment|reach\s*out|drop\s*us\s*a\s*(line|message)|enquir|request\s*a\s*quote/i.test(html);
  const hasTextarea = lowerHtml.includes('<textarea');
  return hasEmailInput && (hasContactText || hasTextarea);
}

function isContactFormGenuine(html, businessAddress) {
  if (!businessAddress) return true;
  const addressParts = businessAddress.split(',').map(p => p.trim());
  if (addressParts.length < 2) return true;
  const city = addressParts[1].trim().toLowerCase();
  if (!city || city.length < 3) return true;
  const lowerHtml = html.toLowerCase();
  if (lowerHtml.includes(city)) return true;
  const ukPostcodePattern = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  if (ukPostcodePattern.test(html)) return false;
  const hasAddressText = /\d+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard|way|court|ct|place|pl)\b/i.test(html);
  if (hasAddressText) return false;
  return true;
}

function extractSocialMediaUrls(html) {
  const socialUrls = { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null };
  try {
    const hrefPattern = /href=["']([^"']+)["']/gi;
    let match;
    while ((match = hrefPattern.exec(html)) !== null) {
      const url = match[1];
      for (const [platform, patterns] of Object.entries(SOCIAL_MEDIA_PATTERNS)) {
        const fieldName = `${platform}Url`;
        if (socialUrls[fieldName]) continue;
        if (!patterns.domain.test(url)) continue;
        if (patterns.exclude && patterns.exclude.test(url)) continue;
        if (patterns.match.test(url)) {
          let cleanUrl = url;
          if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl.replace(/^\/\//, '');
          cleanUrl = cleanUrl.split('?')[0].replace(/\/+$/, '');
          socialUrls[fieldName] = cleanUrl;
        }
      }
    }
  } catch (e) {}
  return socialUrls;
}

// ============================================
// HTTP Fetch (Node.js native — replaces browser fetch)
// ============================================

function fetchPage(url) {
  return new Promise((resolve) => {
    if (!url || url === 'null' || url === 'undefined') {
      return resolve({ success: false, html: '', error: 'No URL' });
    }

    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, {
        timeout: FETCH_TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            redirectUrl = parsedUrl.origin + redirectUrl;
          }
          res.resume();
          return fetchPage(redirectUrl).then(resolve);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return resolve({ success: false, html: '', error: `HTTP ${res.statusCode}` });
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ success: true, html: data, error: null }));
        res.on('error', (e) => resolve({ success: false, html: '', error: e.message }));
      });

      req.on('error', (e) => resolve({ success: false, html: '', error: e.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, html: '', error: 'Timeout' });
      });
    } catch (e) {
      resolve({ success: false, html: '', error: e.message });
    }
  });
}

// ============================================
// 7-Layer Email Extraction (same as extension)
// ============================================

async function fetchAndExtractEmails(url, businessAddress) {
  if (!url || url === 'null' || url === 'undefined') {
    return {
      success: false, emails: [], emailSource: null, error: 'No URL provided',
      pagesScanned: 0, contactPageUrl: null, hasContactForm: false,
      socialUrls: { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null },
      websiteBroken: false
    };
  }

  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    // Clean Google Ads redirect URLs — extract the real destination
    if (url.includes('google.com/aclk') || url.includes('googleadservices.com')) {
      try {
        const parsedUrl = new URL(url);
        const dest = parsedUrl.searchParams.get('adurl') || parsedUrl.searchParams.get('dest');
        if (dest) url = dest;
      } catch (e) {}
    }

    const allEmails = new Set();
    let pagesScanned = 0;
    let contactPageUrl = null;
    let emailSource = null;
    let allSocialUrls = { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null };
    let hasContactForm = false;

    // Layer 1: Homepage
    const homeResult = await fetchPage(url);
    if (!homeResult.success) {
      return {
        success: false, emails: [], emailSource: null, error: homeResult.error,
        pagesScanned: 0, contactPageUrl: null, hasContactForm: false,
        socialUrls: allSocialUrls, websiteBroken: true
      };
    }

    pagesScanned++;
    const homeEmails = extractEmailsFromHTML(homeResult.html);
    homeEmails.forEach(e => allEmails.add(e));
    if (homeEmails.length > 0 && !emailSource) emailSource = '🌐 Website';

    // Check homepage for contact form
    if (hasEmbeddedContactForm(homeResult.html) && isContactFormGenuine(homeResult.html, businessAddress)) {
      hasContactForm = true;
    }

    // Extract social media URLs from homepage
    const homeSocialUrls = extractSocialMediaUrls(homeResult.html);
    Object.entries(homeSocialUrls).forEach(([key, value]) => {
      if (value && !allSocialUrls[key]) allSocialUrls[key] = value;
    });

    // Layers 2-3: Contact and About pages
    const contactUrls = findContactPageUrls(homeResult.html, url);
    const baseUrl = new URL(url);
    const directContactUrls = DIRECT_CONTACT_PATHS.map(p => baseUrl.origin + p);
    const allContactUrls = [...new Set([...contactUrls, ...directContactUrls])];

    for (const contactUrl of allContactUrls) {
      if (pagesScanned >= 5) break;
      await delay(300);

      const contactResult = await fetchPage(contactUrl);
      if (contactResult.success) {
        pagesScanned++;
        if (!contactPageUrl) contactPageUrl = contactUrl;

        const contactEmails = extractEmailsFromHTML(contactResult.html);
        contactEmails.forEach(e => allEmails.add(e));
        if (contactEmails.length > 0 && !emailSource) emailSource = '📋 Contact Page';

        if (!hasContactForm && hasEmbeddedContactForm(contactResult.html) && isContactFormGenuine(contactResult.html, businessAddress)) {
          hasContactForm = true;
        }

        const pageSocialUrls = extractSocialMediaUrls(contactResult.html);
        Object.entries(pageSocialUrls).forEach(([key, value]) => {
          if (value && !allSocialUrls[key]) allSocialUrls[key] = value;
        });
      }
    }

    // Layer 4: mailto link detection (already handled via regex in layers 1-3)

    // Layer 5: Obfuscated email detection (already handled via patterns)

    // If no dedicated contact page found but homepage has form, use homepage URL
    if (!contactPageUrl && hasContactForm) {
      contactPageUrl = url;
    }

    // Layer 6: Facebook page email extraction (via fetch, not tab — headless adaptation)
    if (allEmails.size === 0 && allSocialUrls.facebookUrl) {
      const fbResult = await fetchPage(allSocialUrls.facebookUrl);
      if (fbResult.success) {
        pagesScanned++;
        const fbEmails = extractEmailsFromHTML(fbResult.html);
        fbEmails.forEach(e => allEmails.add(e));
        if (fbEmails.length > 0 && !emailSource) emailSource = '📘 Facebook';
      }

      // Try /about page
      if (allEmails.size === 0) {
        const fbAboutUrl = allSocialUrls.facebookUrl.replace(/\/+$/, '') + '/about';
        const fbAboutResult = await fetchPage(fbAboutUrl);
        if (fbAboutResult.success) {
          pagesScanned++;
          const fbAboutEmails = extractEmailsFromHTML(fbAboutResult.html);
          fbAboutEmails.forEach(e => allEmails.add(e));
          if (fbAboutEmails.length > 0 && !emailSource) emailSource = '📘 Facebook';
        }
      }
    }

    // Layer 7: Google Search fallback (site: + email)
    if (allEmails.size === 0) {
      try {
        const domain = new URL(url).hostname;
        const searchUrl = `https://www.google.com/search?q=site:${domain}+email+contact&num=5`;
        const searchResult = await fetchPage(searchUrl);
        if (searchResult.success) {
          pagesScanned++;
          const searchEmails = extractEmailsFromHTML(searchResult.html);
          searchEmails.forEach(e => allEmails.add(e));
          if (searchEmails.length > 0 && !emailSource) emailSource = '🔍 Google Search';
        }
      } catch (e) {}
    }

    return {
      success: true,
      emails: Array.from(allEmails),
      emailSource,
      error: null,
      pagesScanned,
      contactPageUrl,
      hasContactForm,
      socialUrls: allSocialUrls,
      websiteBroken: false
    };
  } catch (error) {
    return {
      success: false, emails: [], emailSource: null, error: error.message,
      pagesScanned: 0, contactPageUrl: null, hasContactForm: false,
      socialUrls: { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null },
      websiteBroken: true
    };
  }
}

// ============================================
// 3-Layer Email Verification
// ============================================

// Layer 1: Syntax check (RFC 5322)
function isValidEmailSyntax(email) {
  const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  return pattern.test(email);
}

// Layer 2: Disposable domain detection
function isDisposableDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}

// Layer 3: MX record lookup via DNS-over-HTTPS
const mxCache = new Map();

function lookupMX(domain) {
  if (mxCache.has(domain)) return Promise.resolve(mxCache.get(domain));

  return new Promise((resolve) => {
    // Primary: Google Public DNS
    const url = `https://dns.google/resolve?name=${domain}&type=MX`;

    const req = https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const hasMX = json.Answer && json.Answer.some(a => a.type === 15);
          mxCache.set(domain, hasMX);
          resolve(hasMX);
        } catch (e) {
          // Fallback: Cloudflare DNS
          lookupMXCloudflare(domain).then(resolve);
        }
      });
    });

    req.on('error', () => lookupMXCloudflare(domain).then(resolve));
    req.on('timeout', () => {
      req.destroy();
      lookupMXCloudflare(domain).then(resolve);
    });
  });
}

function lookupMXCloudflare(domain) {
  if (mxCache.has(domain)) return Promise.resolve(mxCache.get(domain));

  return new Promise((resolve) => {
    const url = `https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`;

    const req = https.get(url, {
      timeout: 5000,
      headers: { 'Accept': 'application/dns-json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const hasMX = json.Answer && json.Answer.some(a => a.type === 15);
          mxCache.set(domain, hasMX);
          resolve(hasMX);
        } catch (e) {
          resolve(null); // Unknown
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function verifyEmail(email) {
  // Layer 1: Syntax check
  if (!isValidEmailSyntax(email)) {
    return 'Invalid';
  }

  // Layer 2: Disposable domain
  if (isDisposableDomain(email)) {
    return 'Invalid';
  }

  // Layer 3: MX record lookup
  const domain = email.split('@')[1];
  const hasMX = await lookupMX(domain);
  if (hasMX === true) return 'Verified';
  if (hasMX === false) return 'Invalid';
  return 'Unverified'; // null = couldn't determine
}

// ============================================
// CSV Output (matches extension export format)
// ============================================

const CSV_HEADERS = [
  'name', 'email', 'emailSource', 'emailStatus',
  'rating', 'reviewCount', 'category', 'address', 'phone', 'website',
  'contactPageUrl', 'hasContactForm',
  'facebookUrl', 'instagramUrl', 'linkedinUrl', 'twitterUrl',
  'socialSearchUrl', 'googleMapsUrl'
];

function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function dataToCSV(data) {
  const headerRow = CSV_HEADERS.join(',');
  const rows = data.map(row => {
    return CSV_HEADERS.map(h => {
      if (h === 'hasContactForm') return escapeCSV(row[h] ? 'Yes' : 'No');
      return escapeCSV(row[h]);
    }).join(',');
  });
  return '\uFEFF' + [headerRow, ...rows].join('\n');
}

// ============================================
// Helpers
// ============================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Process a batch of businesses with limited concurrency
async function processWithConcurrency(items, fn, concurrency) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array(Math.min(concurrency, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('');
  console.log('Campaign Email Extractor');
  console.log('========================');
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Target city: ${TARGET_CITY || 'all'}`);
  console.log('');

  // Find Phase 2 result files
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('mortgage-broker_') && f.endsWith('.json'))
    .filter(f => !TARGET_CITY || f.includes(`_${TARGET_CITY}_`));

  if (files.length === 0) {
    console.error('No mortgage broker JSON files found in results/');
    process.exit(1);
  }

  console.log(`Found ${files.length} input file(s):`);
  files.forEach(f => console.log(`  ${f}`));
  console.log('');

  const allEnrichedData = [];
  const stats = { total: 0, withEmail: 0, verified: 0, unverified: 0, invalid: 0, notFound: 0 };

  for (const file of files) {
    const filePath = path.join(RESULTS_DIR, file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const businesses = raw.data;
    const city = raw.meta.city;

    console.log(`============================================================`);
    console.log(`Processing: ${city} (${businesses.length} businesses)`);
    console.log(`============================================================`);

    const startTime = Date.now();
    let processed = 0;

    const enriched = await processWithConcurrency(businesses, async (biz, idx) => {
      const result = await fetchAndExtractEmails(biz.website, biz.address);

      const email = result.emails.length > 0 ? result.emails[0] : '';
      let emailStatus = 'Not Found';

      if (email) {
        emailStatus = await verifyEmail(email);
      }

      processed++;
      const pct = Math.round((processed / businesses.length) * 100);
      process.stdout.write(`\r  Progress: ${processed}/${businesses.length} (${pct}%) — emails: ${stats.withEmail + (email ? 1 : 0)}`);

      if (email) stats.withEmail++;
      if (emailStatus === 'Verified') stats.verified++;
      else if (emailStatus === 'Unverified') stats.unverified++;
      else if (emailStatus === 'Invalid') stats.invalid++;
      else stats.notFound++;

      await delay(DELAY_BETWEEN);

      return {
        name: biz.name,
        email: email,
        emailSource: result.emailSource || '',
        emailStatus: emailStatus,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        category: biz.category,
        address: biz.address,
        phone: biz.phone,
        website: result.websiteBroken ? '' : (biz.website || ''),
        contactPageUrl: result.contactPageUrl || '',
        hasContactForm: result.hasContactForm || false,
        facebookUrl: result.socialUrls?.facebookUrl || '',
        instagramUrl: result.socialUrls?.instagramUrl || '',
        linkedinUrl: result.socialUrls?.linkedinUrl || '',
        twitterUrl: result.socialUrls?.twitterUrl || '',
        socialSearchUrl: '',
        googleMapsUrl: biz.googleMapsUrl
      };
    }, CONCURRENCY);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const cityEmails = enriched.filter(r => r.email).length;
    console.log(`\n  Complete: ${enriched.length} businesses, ${cityEmails} emails found (${elapsed}s)\n`);

    stats.total += enriched.length;

    // Save per-city enriched CSV
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const csvFilename = `mortgage-broker_${city}_emails_${timestamp}.csv`;
    const jsonFilename = `mortgage-broker_${city}_emails_${timestamp}.json`;

    fs.writeFileSync(path.join(RESULTS_DIR, csvFilename), dataToCSV(enriched));
    fs.writeFileSync(path.join(RESULTS_DIR, jsonFilename), JSON.stringify({
      meta: {
        ...raw.meta,
        phase: 'email-extraction',
        emailExtractionTimestamp: new Date().toISOString(),
        durationSeconds: elapsed,
        emailsFound: cityEmails,
        totalBusinesses: enriched.length
      },
      data: enriched
    }, null, 2));

    console.log(`  Saved: ${csvFilename}`);
    console.log(`  Saved: ${jsonFilename}`);

    allEnrichedData.push(...enriched);
  }

  // Save combined all-cities CSV
  if (files.length > 1) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const combinedCsvFilename = `mortgage-broker_ALL-CITIES_emails_${timestamp}.csv`;
    fs.writeFileSync(path.join(RESULTS_DIR, combinedCsvFilename), dataToCSV(allEnrichedData));
    console.log(`\n  Combined: ${combinedCsvFilename}`);
  }

  // Print summary
  console.log('');
  console.log('============================================================');
  console.log('EXTRACTION SUMMARY');
  console.log('============================================================');
  console.log(`  Total businesses:  ${stats.total}`);
  console.log(`  Emails found:      ${stats.withEmail} (${Math.round(stats.withEmail / stats.total * 100)}%)`);
  console.log(`  ✅ Verified:       ${stats.verified}`);
  console.log(`  ⚠️  Unverified:    ${stats.unverified}`);
  console.log(`  ❌ Invalid:        ${stats.invalid}`);
  console.log(`  Not Found:         ${stats.notFound}`);
  console.log('');
  console.log(`Results: ${RESULTS_DIR}`);
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
