// Google Maps Lead Scraper - Background Service Worker
// Phase 2: Email extraction from business websites

// ============================================
// License & Trial Management
// ============================================

const TRIAL_SCRAPES = 3;
const KEYGEN_ACCOUNT_ID = '441053a9-f19b-48e3-8d8d-502a96974848';

// Email extraction cancellation flag
let emailExtractionCancelled = false;

// License status object structure
// {
//   status: 'trial' | 'active' | 'expired' | 'invalid',
//   tier: null | 'standard' | 'pro',
//   trialScrapesRemaining: number,
//   licenseKey: string | null,
//   validatedAt: number | null,
//   email: string | null
// }

// Initialize license state for new installations
async function initializeLicenseState() {
  const result = await chrome.storage.local.get(['licenseStatus']);
  if (!result.licenseStatus) {
    const initialState = {
      status: 'trial',
      tier: null,
      trialScrapesRemaining: TRIAL_SCRAPES,
      licenseKey: null,
      validatedAt: null,
      email: null
    };
    await chrome.storage.local.set({ licenseStatus: initialState });
    return initialState;
  }
  return result.licenseStatus;
}

// Get current license status
async function getLicenseStatus() {
  const result = await chrome.storage.local.get(['licenseStatus']);
  if (!result.licenseStatus) {
    return await initializeLicenseState();
  }
  return result.licenseStatus;
}

// Validate license key with Keygen API
async function validateLicenseKey(licenseKey) {
  try {
    const response = await fetch(
      `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/actions/validate-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json'
        },
        body: JSON.stringify({
          meta: { key: licenseKey }
        })
      }
    );

    const data = await response.json();

    if (!data.meta || data.meta.valid !== true) {
      const code = data.meta?.code;
      let error = 'Invalid license key';
      if (code === 'NOT_FOUND') {
        error = 'That license key does not exist';
      } else if (code === 'SUSPENDED') {
        error = 'This license has been suspended';
      } else if (code === 'EXPIRED') {
        error = 'This license has expired';
      } else if (data.meta?.detail) {
        error = data.meta.detail;
      }
      return { valid: false, error };
    }

    const license = data.data;
    const metadata = license?.attributes?.metadata || {};

    return {
      valid: true,
      tier: 'standard',
      email: metadata.email || null,
      purchaseDate: license?.attributes?.created || null
    };
  } catch (error) {
    console.error('[License] Validation error:', error);
    return {
      valid: false,
      error: 'Network error. Please check your connection and try again.'
    };
  }
}

// Activate a license key
async function activateLicenseKey(licenseKey) {
  const validation = await validateLicenseKey(licenseKey);

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error
    };
  }

  // Update license status
  const licenseStatus = {
    status: 'active',
    tier: validation.tier,
    trialScrapesRemaining: 0,
    licenseKey: licenseKey,
    validatedAt: Date.now(),
    email: validation.email
  };

  await chrome.storage.local.set({ licenseStatus });

  return {
    success: true,
    tier: validation.tier,
    email: validation.email
  };
}

// Decrement trial scrape count
async function decrementTrialScrape() {
  const status = await getLicenseStatus();

  if (status.status !== 'trial') {
    return { allowed: true, remaining: null };
  }

  if (status.trialScrapesRemaining <= 0) {
    return { allowed: false, remaining: 0 };
  }

  const newRemaining = status.trialScrapesRemaining - 1;
  const newStatus = {
    ...status,
    trialScrapesRemaining: newRemaining,
    status: newRemaining <= 0 ? 'expired' : 'trial'
  };

  await chrome.storage.local.set({ licenseStatus: newStatus });

  return { allowed: true, remaining: newRemaining };
}

// Check if user can scrape
async function canScrape() {
  const status = await getLicenseStatus();

  if (status.status === 'active') {
    return { allowed: true, reason: null };
  }

  if (status.status === 'trial' && status.trialScrapesRemaining > 0) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason: status.status === 'expired'
      ? 'Your trial has ended. Purchase a license to continue.'
      : 'License is not valid. Please enter a valid license key.'
  };
}


// Email extraction regex patterns
const EMAIL_PATTERNS = [
  // Standard email pattern
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // mailto: links
  /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
];

// Common false positive patterns to filter out
const FALSE_POSITIVE_PATTERNS = [
  // Generic placeholder domains
  /example\.com$/i,
  /test\.com$/i,
  /domain\.com$/i,
  /domainname\.com$/i,
  /email\.com$/i,
  /yoursite\.com$/i,
  /mysite\.com$/i,
  /website\.com$/i,
  /company\.com$/i,
  /yourdomain\.com$/i,
  /yourcompany\.com$/i,
  /samplesite\.com$/i,
  /placeholder\.com$/i,
  // Template/developer leftovers
  /latofonts\.com$/i,
  /impallari@/i,
  /wordpress.*@/i,
  /developer.*@/i,
  /admin@admin\./i,
  /user@user\./i,
  /info@info\./i,
  // Tech service domains
  /sentry\.io$/i,
  /wixpress\.com$/i,
  /wix\.com$/i,
  /squarespace\.com$/i,
  /godaddy\.com$/i,
  /w3\.org$/i,
  /schema\.org$/i,
  /googleapis\.com$/i,
  /google\.com$/i,
  /gstatic\.com$/i,
  /cloudflare\.com$/i,
  /jsdelivr\.net$/i,
  /bootstrapcdn\.com$/i,
  // Image file extensions (malformed emails)
  /2x\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.png$/i,
  /\.gif$/i,
  /\.webp$/i,
  /\.svg$/i,
  // Generic placeholder usernames
  /^john@(?!.*business)/i,
  /^jane@(?!.*business)/i,
  /^test@/i,
  /^demo@/i,
  /^sample@/i,
  /^example@/i,
  /^your-?email@/i,
  /^email@/i,
  /^name@/i,
  /^some@/i
];

// Contact page patterns to look for in links
const CONTACT_PAGE_PATTERNS = [
  /contact/i,
  /kontakt/i,
  /about-us/i,
  /about/i,
  /get-in-touch/i,
  /reach-us/i,
  /enquiry/i,
  /enquiries/i,
  /support/i
];

// Direct contact page paths to try (Feature A: v2.1)
const DIRECT_CONTACT_PATHS = [
  '/contact',
  '/contact-us',
  '/about',
  '/about-us'
];

// Social media domain patterns (Feature C: v2.1)
const SOCIAL_MEDIA_PATTERNS = {
  facebook: {
    domain: /(?:www\.)?facebook\.com/i,
    // Exclude share/intent links, only match profile/page URLs
    exclude: /facebook\.com\/(?:sharer|share|dialog|plugins|login|pages\/create)/i,
    // Match profile/page patterns
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

// Send browser notification
async function sendNotification(title, message) {
  try {
    // Check if notifications are enabled
    const result = await chrome.storage.local.get(['notificationsEnabled']);
    if (result.notificationsEnabled === false) {
      return; // User disabled notifications
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 2
    });
  } catch (error) {
    console.warn('[Notifications] Error sending notification:', error);
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('Google Maps Lead Scraper installed');

    // Initialize license state for new users
    await initializeLicenseState();

    await chrome.storage.local.set({
      scrapedData: [],
      isScrapin: false,
      isExtractingEmails: false,
      settings: {
        maxResults: 500,
        scrollDelay: 2000,
        emailFetchDelay: 1000
      }
    });
  } else if (details.reason === 'update') {
    console.log('Google Maps Lead Scraper updated to version', chrome.runtime.getManifest().version);
    // Initialize license state if not present (for users updating from older version)
    await initializeLicenseState();
  }
});

// Extract emails from HTML content
function extractEmailsFromHTML(html) {
  const emails = new Set();

  for (const pattern of EMAIL_PATTERNS) {
    const matches = html.match(pattern) || [];
    for (let match of matches) {
      // Remove mailto: prefix if present and decode URL encoding
      try {
        match = decodeURIComponent(match);
      } catch (e) {
        // Invalid encoding, use as-is
      }
      match = match.replace(/^mailto:/i, '').trim().toLowerCase();

      // Skip if matches false positive patterns
      let isFalsePositive = false;
      for (const fpPattern of FALSE_POSITIVE_PATTERNS) {
        if (fpPattern.test(match)) {
          isFalsePositive = true;
          break;
        }
      }

      if (!isFalsePositive && match.includes('@') && match.includes('.')) {
        emails.add(match);
      }
    }
  }

  return Array.from(emails);
}

// Find contact page URLs in HTML
function findContactPageUrls(html, baseUrl) {
  const contactUrls = new Set();

  try {
    // Parse base URL
    const base = new URL(baseUrl);
    const baseOrigin = base.origin;

    // Find all links in the HTML
    const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let match;

    while ((match = linkPattern.exec(html)) !== null) {
      const href = match[1];
      const linkText = match[2];

      // Check if link text or href contains contact-related keywords
      const isContactLink = CONTACT_PAGE_PATTERNS.some(pattern =>
        pattern.test(href) || pattern.test(linkText)
      );

      if (isContactLink) {
        try {
          let fullUrl;

          if (href.startsWith('http://') || href.startsWith('https://')) {
            // Absolute URL - only include if same domain
            const linkUrl = new URL(href);
            if (linkUrl.origin === baseOrigin) {
              fullUrl = href;
            }
          } else if (href.startsWith('/')) {
            // Root-relative URL
            fullUrl = baseOrigin + href;
          } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
            // Relative URL
            fullUrl = baseOrigin + '/' + href;
          }

          if (fullUrl && fullUrl !== baseUrl) {
            contactUrls.add(fullUrl);
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }
    }

    // Also look for nav links with contact patterns in href attribute
    const navLinkPattern = /href=["']([^"']*(?:contact|kontakt|about|enquir|support)[^"']*)["']/gi;
    while ((match = navLinkPattern.exec(html)) !== null) {
      const href = match[1];
      try {
        let fullUrl;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          const linkUrl = new URL(href);
          if (linkUrl.origin === baseOrigin) {
            fullUrl = href;
          }
        } else if (href.startsWith('/')) {
          fullUrl = baseOrigin + href;
        } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
          fullUrl = baseOrigin + '/' + href;
        }

        if (fullUrl && fullUrl !== baseUrl) {
          contactUrls.add(fullUrl);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  } catch (e) {
    console.warn('[Email Extractor] Error parsing URLs:', e.message);
  }

  return Array.from(contactUrls).slice(0, 3); // Limit to 3 contact pages max
}

// Detect if a page has an embedded contact form
// Used to set contactPageUrl when there's no dedicated /contact page
function hasEmbeddedContactForm(html) {
  const lowerHtml = html.toLowerCase();

  // Must have a <form> element
  if (!lowerHtml.includes('<form')) return false;

  // Check for email input fields (strong indicator of contact form)
  const hasEmailInput = /type=["']email["']|name=["'][^"']*email[^"']*["']/i.test(html);

  // Check for contact-related headings/text near forms
  const hasContactText = /contact\s*us|get\s*in\s*touch|send\s*us\s*a\s*message|schedule\s*(your|an)\s*appointment|reach\s*out|drop\s*us\s*a\s*(line|message)|enquir|request\s*a\s*quote/i.test(html);

  // Check for message/textarea (typical of contact forms)
  const hasTextarea = lowerHtml.includes('<textarea');

  // A form with an email input + textarea or contact text is a contact form
  return hasEmailInput && (hasContactText || hasTextarea);
}

// Check if a detected contact form belongs to the actual business (not a template/builder default)
// Compares page content against the business's Google Maps address
function isContactFormGenuine(html, businessAddress) {
  if (!businessAddress) return true; // Can't validate without address

  // Extract city from business address (format: "123 Street, City, ST 12345")
  const addressParts = businessAddress.split(',').map(p => p.trim());
  if (addressParts.length < 2) return true;

  // City is typically the second part (after street address)
  const city = addressParts[1].trim().toLowerCase();
  if (!city || city.length < 3) return true;

  const lowerHtml = html.toLowerCase();

  // If the page mentions the business's city, it's genuine
  if (lowerHtml.includes(city)) return true;

  // Check for foreign address patterns (UK postal codes like SW1A 1AA, EC2R 8AH)
  const ukPostcodePattern = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  if (ukPostcodePattern.test(html)) {
    console.log(`[Contact Form] Detected UK postcode on contact page - likely template`);
    return false;
  }

  // If page has a street address that doesn't include the business city, likely a template
  const hasAddressText = /\d+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard|way|court|ct|place|pl)\b/i.test(html);
  if (hasAddressText) {
    console.log(`[Contact Form] Contact page has address but doesn't mention business city "${city}" - likely template`);
    return false;
  }

  return true; // No conflicting address found, trust the form detection
}

// Extract social media profile URLs from HTML (Feature C: v2.1)
function extractSocialMediaUrls(html) {
  const socialUrls = {
    facebookUrl: null,
    instagramUrl: null,
    linkedinUrl: null,
    twitterUrl: null
  };

  try {
    // Find all href attributes in the HTML
    const hrefPattern = /href=["']([^"']+)["']/gi;
    let match;

    while ((match = hrefPattern.exec(html)) !== null) {
      const url = match[1];

      // Check each social media platform
      for (const [platform, patterns] of Object.entries(SOCIAL_MEDIA_PATTERNS)) {
        const fieldName = `${platform}Url`;

        // Skip if we already found a URL for this platform
        if (socialUrls[fieldName]) continue;

        // Check if URL matches the domain
        if (!patterns.domain.test(url)) continue;

        // Skip if it matches exclude patterns (share buttons, etc.)
        if (patterns.exclude && patterns.exclude.test(url)) continue;

        // Check if it matches the profile/page pattern
        if (patterns.match.test(url)) {
          // Clean up the URL
          let cleanUrl = url;
          // Ensure it starts with https://
          if (!cleanUrl.startsWith('http')) {
            cleanUrl = 'https://' + cleanUrl.replace(/^\/\//, '');
          }
          // Remove trailing slashes and query params for consistency
          cleanUrl = cleanUrl.split('?')[0].replace(/\/+$/, '');

          socialUrls[fieldName] = cleanUrl;
        }
      }
    }
  } catch (e) {
    console.warn('[Social Media Extractor] Error:', e.message);
  }

  return socialUrls;
}

// Validate that a social profile URL is live (not deleted/unavailable)
// Returns the URL if valid, null if the profile appears deleted
async function validateSocialUrl(url) {
  if (!url) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);

    // 404 or 410 = definitely deleted
    if (response.status === 404 || response.status === 410) {
      console.log(`[Social Validate] Dead profile (${response.status}): ${url}`);
      return null;
    }

    // For Instagram and Facebook, check page content for "not available" indicators
    if (url.includes('instagram.com') || url.includes('facebook.com')) {
      const html = await response.text();
      const deadIndicators = [
        "this page isn't available",
        'this page is not available',
        "sorry, this page isn't available",
        "this content isn't available",
        'this content is not available',
        'page not found',
        'the link you followed may be broken',
        'this account has been disabled'
      ];
      const lowerHtml = html.toLowerCase();
      for (const indicator of deadIndicators) {
        if (lowerHtml.includes(indicator)) {
          console.log(`[Social Validate] Dead profile (content match: "${indicator}"): ${url}`);
          return null;
        }
      }
    }

    return url;
  } catch (e) {
    // Network error / timeout — don't discard, could just be rate limited
    console.warn(`[Social Validate] Could not validate ${url}: ${e.message}`);
    return url;
  }
}

// Validate all social URLs in parallel, returns cleaned object
async function validateSocialUrls(socialUrls) {
  const [facebookUrl, instagramUrl, linkedinUrl, twitterUrl] = await Promise.all([
    validateSocialUrl(socialUrls.facebookUrl),
    validateSocialUrl(socialUrls.instagramUrl),
    validateSocialUrl(socialUrls.linkedinUrl),
    validateSocialUrl(socialUrls.twitterUrl)
  ]);
  return { facebookUrl, instagramUrl, linkedinUrl, twitterUrl };
}

// Search Google to find social media profiles for a business (v2.1)
// Used for businesses without websites
async function searchGoogleForSocialProfiles(businessName, location) {
  const results = {
    facebookUrl: null,
    instagramUrl: null,
    emails: [],
    socialSearchUrl: null
  };

  try {
    // Clean up business name and location for search
    const cleanName = businessName.replace(/[^\w\s]/g, ' ').trim();
    const cleanLocation = location ? location.split(',')[0].trim() : ''; // Just city name

    // Search for Facebook page
    const fbSearchQuery = encodeURIComponent(`"${cleanName}" ${cleanLocation} site:facebook.com`);
    const fbSearchUrl = `https://www.google.com/search?q=${fbSearchQuery}&num=5`;
    results.socialSearchUrl = fbSearchUrl;

    console.log(`[Social Search] Searching Google for Facebook: ${cleanName} ${cleanLocation}`);

    const fbResult = await fetchPage(fbSearchUrl);
    if (fbResult.success) {
      // Extract Facebook URLs from Google search results
      const fbUrlPattern = /https?:\/\/(?:www\.)?facebook\.com\/(?:people\/|pages\/|profile\.php\?id=)?[a-zA-Z0-9._-]+\/?/gi;
      const fbMatches = fbResult.html.match(fbUrlPattern) || [];

      // Filter out generic Facebook URLs
      for (const url of fbMatches) {
        if (!url.includes('/sharer') &&
            !url.includes('/share') &&
            !url.includes('/login') &&
            !url.includes('/policies') &&
            !url.includes('/help') &&
            !url.includes('facebook.com/search')) {
          results.facebookUrl = url.split('&')[0].split('?')[0]; // Clean URL
          console.log(`[Social Search] Found Facebook: ${results.facebookUrl}`);
          break;
        }
      }
    }

    // Small delay before next search
    await new Promise(resolve => setTimeout(resolve, 500));

    // Search for Instagram profile
    const igSearchQuery = encodeURIComponent(`"${cleanName}" ${cleanLocation} site:instagram.com`);
    const igSearchUrl = `https://www.google.com/search?q=${igSearchQuery}&num=5`;

    console.log(`[Social Search] Searching Google for Instagram: ${cleanName} ${cleanLocation}`);

    const igResult = await fetchPage(igSearchUrl);
    if (igResult.success) {
      // Extract Instagram URLs from Google search results
      const igUrlPattern = /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?/gi;
      const igMatches = igResult.html.match(igUrlPattern) || [];

      // Filter out generic Instagram URLs
      for (const url of igMatches) {
        if (!url.includes('/accounts') &&
            !url.includes('/explore') &&
            !url.includes('/p/') &&
            !url.includes('/reel/')) {
          results.instagramUrl = url.split('?')[0]; // Clean URL
          console.log(`[Social Search] Found Instagram: ${results.instagramUrl}`);
          break;
        }
      }
    }

    // If we found a Facebook page, try to extract email from it via tab
    if (results.facebookUrl) {
      console.log(`[Social Search] Extracting email from Facebook via tab: ${results.facebookUrl}`);
      const fbEmails = await extractEmailFromFacebookViaTab(results.facebookUrl);
      if (fbEmails.length > 0) {
        results.emails = fbEmails;
        console.log(`[Social Search] Found ${fbEmails.length} emails on Facebook page!`);
      }
    }

  } catch (error) {
    console.warn(`[Social Search] Error searching for ${businessName}:`, error.message);
  }

  return results;
}

// Extract email from a Facebook page by rendering it in a background tab
// Facebook renders content via JavaScript, so fetch() doesn't get emails
// This opens the page in a real browser tab to access the rendered DOM
async function extractEmailFromFacebookViaTab(facebookUrl) {
  let tabId = null;
  try {
    console.log(`[Facebook Tab] Opening: ${facebookUrl}`);

    // Open Facebook URL in a background tab
    const tab = await chrome.tabs.create({ url: facebookUrl, active: false });
    tabId = tab.id;

    // Wait for page to fully load
    await waitForTabLoad(tabId, 10000);

    // Extra wait for Facebook's dynamic content to render
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Step 1: Try to dismiss login popup and scroll to reveal content
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Dismiss the login wall/popup if present
        const closeButtons = document.querySelectorAll('[aria-label="Close"], [data-testid="royal_close_button"]');
        closeButtons.forEach(btn => { try { btn.click(); } catch(e) {} });

        // Scroll down to load more content (About section etc.)
        window.scrollBy(0, 500);
      }
    });

    // Wait for content to settle after dismissing popup
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 2: Extract emails from the rendered DOM
    let emails = await extractEmailsFromTab(tabId);

    // Step 3: If no email found on main page, try the /about page
    if (emails.length === 0) {
      // Build the about URL from the Facebook page URL
      const cleanUrl = facebookUrl.replace(/\/+$/, ''); // Remove trailing slashes
      const aboutUrl = cleanUrl + '/about';
      console.log(`[Facebook Tab] No email on main page, trying: ${aboutUrl}`);

      await chrome.tabs.update(tabId, { url: aboutUrl });
      await waitForTabLoad(tabId, 10000);
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Dismiss login popup again on about page
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const closeButtons = document.querySelectorAll('[aria-label="Close"], [data-testid="royal_close_button"]');
          closeButtons.forEach(btn => { try { btn.click(); } catch(e) {} });
          window.scrollBy(0, 500);
        }
      });
      await new Promise(resolve => setTimeout(resolve, 1500));

      emails = await extractEmailsFromTab(tabId);
      if (emails.length > 0) {
        console.log(`[Facebook Tab] Found ${emails.length} emails on /about page!`);
      }
    }

    // Close the tab
    await chrome.tabs.remove(tabId);
    tabId = null;

    console.log(`[Facebook Tab] Result: ${emails.length} emails: ${emails.join(', ')}`);
    return emails;
  } catch (error) {
    console.warn(`[Facebook Tab] Error:`, error.message);
    // Clean up tab on error
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (e) {}
    }
    return [];
  }
}

// Helper: extract emails from a tab's rendered DOM
async function extractEmailsFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Get all visible text on the page
      const bodyText = document.body.innerText || '';

      // Also check meta tags
      const metaTags = document.querySelectorAll('meta[content*="@"]');
      let metaText = '';
      metaTags.forEach(tag => { metaText += ' ' + tag.getAttribute('content'); });

      // Check structured data
      const ldJson = document.querySelectorAll('script[type="application/ld+json"]');
      let ldText = '';
      ldJson.forEach(el => { ldText += ' ' + el.textContent; });

      // Also check all href attributes for mailto links
      const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
      let mailtoText = '';
      mailtoLinks.forEach(link => { mailtoText += ' ' + link.href.replace('mailto:', ''); });

      const allText = bodyText + ' ' + metaText + ' ' + ldText + ' ' + mailtoText;

      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = allText.match(emailPattern) || [];

      // Deduplicate and filter out obvious non-business emails
      return [...new Set(matches.map(e => e.toLowerCase()))].filter(email =>
        !email.includes('facebook.com') &&
        !email.includes('fbcdn.') &&
        !email.includes('example.com') &&
        !email.includes('sentry.io') &&
        !email.includes('w3.org') &&
        !email.includes('schema.org') &&
        !email.includes('wixpress.com') &&
        !email.includes('googleapis.com') &&
        !email.endsWith('.png') &&
        !email.endsWith('.jpg') &&
        !email.endsWith('.svg') &&
        !email.startsWith('test@') &&
        !email.startsWith('example@')
      );
    }
  });

  return results[0]?.result || [];
}

// Wait for a tab to finish loading
function waitForTabLoad(tabId, timeoutMs = 10000) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Fetch a single page
async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, html: '', error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    return { success: true, html, error: null };
  } catch (error) {
    return { success: false, html: '', error: error.message };
  }
}

// Fetch a website and extract emails (including contact pages)
// v2.1: Enhanced with contact page URL capture, social media extraction, and Facebook fallback
async function fetchAndExtractEmails(url, businessAddress) {
  if (!url || url === 'null' || url === 'undefined') {
    return {
      success: false,
      emails: [],
      emailSource: null,
      error: 'No URL provided',
      pagesScanned: 0,
      contactPageUrl: null,
      hasContactForm: false,
      socialUrls: { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null },
      websiteBroken: false // Not broken, just not provided
    };
  }

  try {
    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    console.log(`[Email Extractor] Fetching homepage: ${url}`);

    const allEmails = new Set();
    let pagesScanned = 0;
    let contactPageUrl = null;
    let emailSource = null; // Track where the first email was found
    let allSocialUrls = { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null };
    let allHtmlContent = ''; // Accumulate HTML for social media extraction
    let hasContactForm = false; // Track if any page has a contact form

    // Fetch homepage
    const homeResult = await fetchPage(url);

    if (!homeResult.success) {
      console.log(`[Email Extractor] Website broken/unreachable: ${url} - ${homeResult.error}`);
      return {
        success: false,
        emails: [],
        emailSource: null,
        error: homeResult.error,
        pagesScanned: 0,
        contactPageUrl: null,
        hasContactForm: false,
        socialUrls: allSocialUrls,
        websiteBroken: true // Mark as broken so caller can clear the URL and fall back to social search
      };
    }

    pagesScanned++;
    allHtmlContent += homeResult.html;

    // Extract emails from homepage
    const homeEmails = extractEmailsFromHTML(homeResult.html);
    homeEmails.forEach(email => allEmails.add(email));
    if (homeEmails.length > 0 && !emailSource) emailSource = '🌐 Website';

    console.log(`[Email Extractor] Found ${homeEmails.length} emails on homepage`);

    // Check if homepage has an embedded contact form (for contactPageUrl fallback)
    const homepageHasContactForm = hasEmbeddedContactForm(homeResult.html) && isContactFormGenuine(homeResult.html, businessAddress);
    if (homepageHasContactForm) {
      hasContactForm = true;
      console.log(`[Email Extractor] Homepage has embedded contact form`);
    }

    // Extract social media URLs from homepage (Feature C: v2.1)
    const homeSocialUrls = extractSocialMediaUrls(homeResult.html);
    Object.entries(homeSocialUrls).forEach(([key, value]) => {
      if (value && !allSocialUrls[key]) {
        allSocialUrls[key] = value;
      }
    });

    // Find contact pages from links on homepage
    const contactUrls = findContactPageUrls(homeResult.html, url);
    console.log(`[Email Extractor] Found ${contactUrls.length} potential contact pages from links`);

    // Also try direct contact page paths (Feature A: v2.1)
    const baseUrl = new URL(url);
    const directContactUrls = DIRECT_CONTACT_PATHS.map(path => baseUrl.origin + path);

    // Combine and deduplicate contact URLs (linked pages first, then direct paths)
    const allContactUrls = [...new Set([...contactUrls, ...directContactUrls])];

    // Fetch contact/about pages
    for (const contactUrl of allContactUrls) {
      // Skip if we've already scanned 5 pages total
      if (pagesScanned >= 5) break;

      console.log(`[Email Extractor] Fetching contact page: ${contactUrl}`);

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));

      const contactResult = await fetchPage(contactUrl);

      if (contactResult.success) {
        pagesScanned++;
        allHtmlContent += contactResult.html;

        // Store the first valid contact page URL found (Feature B: v2.1)
        if (!contactPageUrl) {
          contactPageUrl = contactUrl;
          console.log(`[Email Extractor] Found valid contact page: ${contactPageUrl}`);
        }

        const contactEmails = extractEmailsFromHTML(contactResult.html);
        contactEmails.forEach(email => allEmails.add(email));
        if (contactEmails.length > 0 && !emailSource) emailSource = '📋 Contact Page';
        console.log(`[Email Extractor] Found ${contactEmails.length} emails on ${contactUrl}`);

        // Check if this contact page has an actual contact form (and it's genuine, not a template)
        if (!hasContactForm && hasEmbeddedContactForm(contactResult.html) && isContactFormGenuine(contactResult.html, businessAddress)) {
          hasContactForm = true;
          console.log(`[Email Extractor] Contact form found on: ${contactUrl}`);
        }

        // Extract social media URLs from contact page (Feature C: v2.1)
        const pageSocialUrls = extractSocialMediaUrls(contactResult.html);
        Object.entries(pageSocialUrls).forEach(([key, value]) => {
          if (value && !allSocialUrls[key]) {
            allSocialUrls[key] = value;
          }
        });
      }
    }

    // If no dedicated contact page was found but homepage has a contact form, use homepage URL
    if (!contactPageUrl && homepageHasContactForm) {
      contactPageUrl = url;
      console.log(`[Email Extractor] No dedicated contact page found, using homepage with embedded form: ${url}`);
    }

    // Feature D: Facebook Email Extraction (v2.1)
    // If no email found on website and we have a Facebook URL, try to extract email from Facebook
    // Uses tab-based extraction since Facebook renders content via JavaScript
    if (allEmails.size === 0 && allSocialUrls.facebookUrl) {
      console.log(`[Email Extractor] No email found on website, trying Facebook via tab: ${allSocialUrls.facebookUrl}`);

      const facebookEmails = await extractEmailFromFacebookViaTab(allSocialUrls.facebookUrl);
      facebookEmails.forEach(email => allEmails.add(email));
      if (facebookEmails.length > 0) {
        pagesScanned++;
        if (!emailSource) emailSource = '📘 Facebook';
        console.log(`[Email Extractor] Found ${facebookEmails.length} emails on Facebook page!`);
      }
    }

    const emails = Array.from(allEmails);
    console.log(`[Email Extractor] Total: ${emails.length} unique emails from ${pagesScanned} pages for ${url} (source: ${emailSource})`);
    console.log(`[Email Extractor] Social URLs found:`, allSocialUrls);

    return {
      success: true,
      emails,
      emailSource,
      error: null,
      pagesScanned,
      contactPageUrl,
      hasContactForm,
      socialUrls: allSocialUrls,
      websiteBroken: false
    };
  } catch (error) {
    console.warn(`[Email Extractor] Error fetching ${url}:`, error.message);
    return {
      success: false,
      emails: [],
      emailSource: null,
      error: error.message,
      pagesScanned: 0,
      contactPageUrl: null,
      hasContactForm: false,
      socialUrls: { facebookUrl: null, instagramUrl: null, linkedinUrl: null, twitterUrl: null },
      websiteBroken: true // Treat exceptions as broken website
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

function isDisposableDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}

// Layer 3: MX record lookup via DNS-over-HTTPS
const mxCache = new Map();

async function lookupMX(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);

  try {
    // Primary: Google Public DNS
    const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    const json = await response.json();
    const hasMX = json.Answer && json.Answer.some(a => a.type === 15);
    mxCache.set(domain, hasMX);
    return hasMX;
  } catch (e) {
    // Fallback: Cloudflare DNS
    try {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
        headers: { 'Accept': 'application/dns-json' }
      });
      const json = await response.json();
      const hasMX = json.Answer && json.Answer.some(a => a.type === 15);
      mxCache.set(domain, hasMX);
      return hasMX;
    } catch (e2) {
      return null; // Unknown
    }
  }
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

// Verify all emails for a business and return the status of the first/primary email
async function verifyBusinessEmails(emails) {
  if (!emails || emails.length === 0) return null;
  // Verify the primary email (first one)
  return await verifyEmail(emails[0]);
}

// Process multiple businesses for email extraction
// v2.1: Added socialSearchEnabled parameter for Google search fallback
async function extractEmailsFromBusinesses(businesses, sendProgress, socialSearchEnabled = false) {
  const results = [];
  const delay = 500; // Reduced delay since we have delays within fetchAndExtractEmails

  for (let i = 0; i < businesses.length; i++) {
    // Check if extraction was cancelled
    if (emailExtractionCancelled) {
      console.log(`[Email Extractor] Cancelled at ${i}/${businesses.length}`);
      break;
    }

    const business = businesses[i];

    const progressData = {
      current: i + 1,
      total: businesses.length,
      businessName: business.name
    };

    // Persist progress to storage so popup can restore it
    await chrome.storage.local.set({
      emailExtractionProgress: progressData,
      isExtractingEmails: true
    });

    // Send progress update via message (if popup is open)
    if (sendProgress) {
      sendProgress(progressData);
    }

    if (business.website) {
      const result = await fetchAndExtractEmails(business.website, business.address);

      // Check if website was broken/unreachable
      if (result.websiteBroken) {
        console.log(`[Email Extractor] Website broken for "${business.name}" - clearing URL`);

        // Website is broken - clear it and try social search if enabled
        if (socialSearchEnabled) {
          console.log(`[Email Extractor] Falling back to social search for "${business.name}"`);
          const socialResults = await searchGoogleForSocialProfiles(business.name, business.address);

          // Validate social URLs are live (not deleted profiles)
          const validatedSocial = await validateSocialUrls({
            facebookUrl: socialResults.facebookUrl,
            instagramUrl: socialResults.instagramUrl,
            linkedinUrl: null,
            twitterUrl: null
          });

          results.push({
            ...business,
            website: null, // Clear broken website
            emails: socialResults.emails,
            emailSource: socialResults.emails.length > 0 ? '🔍 Social Search' : null,
            emailError: socialResults.emails.length > 0 ? null : 'Website broken, searched social',
            pagesScanned: 0,
            contactPageUrl: null,
            hasContactForm: false,
            facebookUrl: validatedSocial.facebookUrl,
            instagramUrl: validatedSocial.instagramUrl,
            linkedinUrl: null,
            twitterUrl: null,
            socialSearchUrl: socialResults.socialSearchUrl
          });
        } else {
          results.push({
            ...business,
            website: null, // Clear broken website
            emails: [],
            emailSource: null,
            emailError: 'Website broken/unreachable',
            pagesScanned: 0,
            contactPageUrl: null,
            hasContactForm: false,
            facebookUrl: null,
            instagramUrl: null,
            linkedinUrl: null,
            twitterUrl: null,
            socialSearchUrl: null
          });
        }
      } else {
        // Website worked - check if we found social links
        const hasSocialLinks = result.socialUrls?.facebookUrl || result.socialUrls?.instagramUrl ||
                               result.socialUrls?.linkedinUrl || result.socialUrls?.twitterUrl;

        let finalEmails = [...result.emails];
        let finalEmailSource = result.emailSource || null;
        let finalSocialUrls = { ...result.socialUrls };
        let finalSocialSearchUrl = null;

        // If no social links found on website, try Google search (when enabled)
        if (!hasSocialLinks && socialSearchEnabled) {
          console.log(`[Email Extractor] No social links on website for "${business.name}" - searching Google`);
          const socialResults = await searchGoogleForSocialProfiles(business.name, business.address);

          // Merge social URLs found via Google
          if (socialResults.facebookUrl) finalSocialUrls.facebookUrl = socialResults.facebookUrl;
          if (socialResults.instagramUrl) finalSocialUrls.instagramUrl = socialResults.instagramUrl;
          finalSocialSearchUrl = socialResults.socialSearchUrl;

          // Add any emails found from social profiles
          socialResults.emails.forEach(email => {
            if (!finalEmails.includes(email)) {
              finalEmails.push(email);
              if (!finalEmailSource) finalEmailSource = '🔍 Social Search';
            }
          });
        }

        // Validate social URLs are live (not deleted profiles)
        finalSocialUrls = await validateSocialUrls(finalSocialUrls);

        // If we have a Facebook URL but no email yet, try to extract from Facebook via tab
        if (finalEmails.length === 0 && finalSocialUrls.facebookUrl) {
          console.log(`[Email Extractor] Have Facebook URL but no email - opening tab: ${finalSocialUrls.facebookUrl}`);
          const fbEmails = await extractEmailFromFacebookViaTab(finalSocialUrls.facebookUrl);
          if (fbEmails.length > 0) {
            console.log(`[Email Extractor] Found ${fbEmails.length} emails on Facebook!`);
            finalEmails.push(...fbEmails);
            if (!finalEmailSource) finalEmailSource = '📘 Facebook';
          }
        }

        results.push({
          ...business,
          emails: finalEmails,
          emailSource: finalEmailSource,
          emailError: result.error,
          pagesScanned: result.pagesScanned,
          contactPageUrl: result.contactPageUrl || null,
          hasContactForm: result.hasContactForm || false,
          facebookUrl: finalSocialUrls.facebookUrl || null,
          instagramUrl: finalSocialUrls.instagramUrl || null,
          linkedinUrl: finalSocialUrls.linkedinUrl || null,
          twitterUrl: finalSocialUrls.twitterUrl || null,
          socialSearchUrl: finalSocialSearchUrl
        });
      }
    } else {
      // No website - try Google search for social profiles if enabled
      if (socialSearchEnabled) {
        console.log(`[Email Extractor] No website for "${business.name}" - searching Google for social profiles`);

        const socialResults = await searchGoogleForSocialProfiles(business.name, business.address);

        // Validate social URLs are live (not deleted profiles)
        const validatedSocial = await validateSocialUrls({
          facebookUrl: socialResults.facebookUrl,
          instagramUrl: socialResults.instagramUrl,
          linkedinUrl: null,
          twitterUrl: null
        });

        results.push({
          ...business,
          emails: socialResults.emails,
          emailSource: socialResults.emails.length > 0 ? '🔍 Social Search' : null,
          emailError: socialResults.emails.length > 0 ? null : 'No website (searched social)',
          pagesScanned: 0,
          contactPageUrl: null,
          hasContactForm: false,
          facebookUrl: validatedSocial.facebookUrl,
          instagramUrl: validatedSocial.instagramUrl,
          linkedinUrl: null,
          twitterUrl: null,
          socialSearchUrl: socialResults.socialSearchUrl
        });
      } else {
        results.push({
          ...business,
          emails: [],
          emailSource: null,
          emailError: 'No website',
          pagesScanned: 0,
          contactPageUrl: null,
          hasContactForm: false,
          facebookUrl: null,
          instagramUrl: null,
          linkedinUrl: null,
          twitterUrl: null,
          socialSearchUrl: null
        });
      }
    }

    // Delay between businesses (except for last one)
    if (i < businesses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Run email verification on all results
  const emailResults = results.filter(r => r.emails && r.emails.length > 0);
  for (let i = 0; i < emailResults.length; i++) {
    if (emailExtractionCancelled) break;

    if (sendProgress) {
      sendProgress({
        current: i + 1,
        total: emailResults.length,
        businessName: emailResults[i].name,
        phase: 'verifying'
      });
    }

    emailResults[i].emailVerificationStatus = await verifyBusinessEmails(emailResults[i].emails);
  }

  // Set null for businesses without emails
  results.forEach(r => {
    if (!r.emailVerificationStatus) {
      r.emailVerificationStatus = null;
    }
  });

  return results;
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractEmails') {
    // Handle email extraction request
    const businesses = message.businesses || [];
    const socialSearchEnabled = message.socialSearchEnabled || false; // v2.1: Google search for no-website businesses

    // Reset cancellation flag
    emailExtractionCancelled = false;

    console.log(`[Email Extractor] Starting extraction for ${businesses.length} businesses (socialSearch: ${socialSearchEnabled})`);

    // Process asynchronously
    (async () => {
      const results = await extractEmailsFromBusinesses(businesses, (progress) => {
        // Send progress updates to popup
        chrome.runtime.sendMessage({
          type: 'emailProgress',
          ...progress
        }).catch(() => {
          // Popup might be closed
        });
      }, socialSearchEnabled); // v2.1: Pass social search flag

      // Check if extraction was cancelled
      const wasCancelled = emailExtractionCancelled;

      // Count verification statuses
      const emailsFound = results.filter(b => b.emails && b.emails.length > 0).length;
      const verifiedCount = results.filter(b => b.emailVerificationStatus === 'Verified').length;
      const unverifiedCount = results.filter(b => b.emailVerificationStatus === 'Unverified').length;
      const invalidCount = results.filter(b => b.emailVerificationStatus === 'Invalid').length;

      // Send completion message (includes partial results if cancelled)
      chrome.runtime.sendMessage({
        type: wasCancelled ? 'emailCancelled' : 'emailComplete',
        data: results,
        verificationCounts: { verified: verifiedCount, unverified: unverifiedCount, invalid: invalidCount }
      }).catch(() => {
        // Popup might be closed
      });

      // Send browser notification
      if (!wasCancelled) {
        await sendNotification(
          'Email Extraction Complete',
          `Found emails for ${emailsFound} of ${results.length} businesses`
        );
      }

      // Store results and clear progress state
      chrome.storage.local.set({
        scrapedDataWithEmails: results.length > 0 ? results : [],
        isExtractingEmails: false,
        emailExtractionProgress: null
      });

      sendResponse({ status: 'started', count: businesses.length });
    })();

    return true; // Keep channel open for async response
  }

  if (message.action === 'cancelEmailExtraction') {
    emailExtractionCancelled = true;
    console.log('[Email Extractor] Cancellation requested');
    sendResponse({ status: 'cancelling' });
    return true;
  }

  if (message.action === 'fetchSingleEmail') {
    // Fetch email for a single website
    fetchAndExtractEmails(message.url).then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'log') {
    console.log('[Content Script]:', message.data);
  }

  // Handle scraping complete - send notification from service worker
  // This ensures notification fires even if popup is closed
  if (message.type === 'complete') {
    (async () => {
      try {
        const result = await chrome.storage.local.get(['notificationsEnabled', 'autoExtractEmails']);
        const notificationsEnabled = result.notificationsEnabled !== false; // default true
        const autoExtractEmails = result.autoExtractEmails !== false; // default true
        const leadsCount = message.data ? message.data.length : 0;
        const hasWebsites = message.data ? message.data.some(b => b.website) : false;

        // Only send notification if auto-extract is OFF or no websites to extract from
        // (if auto-extract is ON, the email extraction completion will send its own notification)
        if (notificationsEnabled && (!autoExtractEmails || !hasWebsites)) {
          await sendNotification(
            'Scraping Complete',
            `Found ${leadsCount} leads${!hasWebsites ? ' (no websites for email extraction)' : ' - ready to export'}`
          );
        }
      } catch (error) {
        console.warn('[Service Worker] Error sending scraping complete notification:', error);
      }
    })();
  }

  if (message.action === 'showNotification') {
    sendNotification(message.title, message.message);
    sendResponse({ status: 'sent' });
    return true;
  }

  // License management actions
  if (message.action === 'getLicenseStatus') {
    getLicenseStatus().then(status => sendResponse(status));
    return true;
  }

  if (message.action === 'activateLicense') {
    activateLicenseKey(message.licenseKey).then(result => sendResponse(result));
    return true;
  }

  if (message.action === 'canScrape') {
    canScrape().then(result => sendResponse(result));
    return true;
  }

  if (message.action === 'decrementTrial') {
    decrementTrialScrape().then(result => sendResponse(result));
    return true;
  }

  return true;
});

// Handle extension icon click when popup is not shown
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('google.com/maps')) {
    chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
  }
});

console.log('Google Maps Lead Scraper service worker started (Phase 2 - with contact page scanning)');
