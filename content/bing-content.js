// Bing Maps Lead Scraper - Content Script
// Mirrors the message protocol of content.js (Google Maps scraper)

// State
let isScrapin = false;
let scrapedData = [];
let seenIds = new Set();
let urlHistory = new Set();
let totalDuplicatesSkipped = 0;
let activeFilters = null;
let totalFilteredOut = 0;
const MAX_RESULTS = 500;
const PAGINATION_DELAY = 2000;
const MAX_NO_NEW_RESULTS = 5; // Lower than Google (10) since Bing returns fewer results

// Load URL history from storage on script load
chrome.storage.local.get(['scrapedUrlHistory'], (result) => {
  if (result.scrapedUrlHistory && Array.isArray(result.scrapedUrlHistory)) {
    urlHistory = new Set(result.scrapedUrlHistory);
    console.log(`[Bing Scraper] Loaded ${urlHistory.size} URLs from history`);
  }
});

// Check if we're on a Bing Maps search results page
function isOnSearchResults() {
  const url = window.location.href;
  return url.includes('bing.com/maps') &&
         (url.includes('?q=') || url.includes('&q='));
}

// Get the results panel container (scrollable div holding the listings)
function getResultsContainer() {
  // Primary: The b_lstcards div is the scrollable list container
  const lstCards = document.querySelector('.b_lstcards');
  if (lstCards) return lstCards;

  // Fallback: Walk up from a known listing element to find scrollable parent
  const anyListing = document.querySelector('.b_maglistcard, ol.b_split_cards_cont > li');
  if (anyListing) {
    let container = anyListing.parentElement;
    while (container && container !== document.body) {
      if (container.scrollHeight > container.clientHeight + 50) {
        return container;
      }
      container = container.parentElement;
    }
  }

  console.warn('[Bing Scraper] Could not find scrollable results container');
  return null;
}

// Get all visible business listing elements
function getVisibleListings() {
  // Primary: b_maglistcard divs (each is one business card)
  const magCards = document.querySelectorAll('.b_maglistcard');
  if (magCards.length > 0) {
    console.log(`[Bing Scraper] Found ${magCards.length} .b_maglistcard elements`);
    return Array.from(magCards);
  }

  // Fallback: list items in the ordered list
  const listItems = document.querySelectorAll('ol.b_split_cards_cont > li');
  if (listItems.length > 0) {
    console.log(`[Bing Scraper] Found ${listItems.length} list items via ol.b_split_cards_cont > li`);
    return Array.from(listItems);
  }

  // Fallback: any li with aria-label containing "Item"
  const ariaItems = document.querySelectorAll('li[aria-label*="Item"]');
  if (ariaItems.length > 0) {
    console.log(`[Bing Scraper] Found ${ariaItems.length} items via aria-label`);
    return Array.from(ariaItems);
  }

  return [];
}

// Extract business data from a single Bing Maps listing element
function extractBusinessData(element) {
  const data = {
    name: null,
    rating: null,
    reviewCount: null,
    category: null,
    address: null,
    phone: null,
    website: null,
    googleMapsUrl: null, // Keep for compatibility (will be null for Bing)
    bingMapsUrl: null,
    sourceEngine: 'Bing Maps'
  };

  try {
    // === Business Name ===
    // Primary: h3._magTitle inside the card
    const titleEl = element.querySelector('h3._magTitle');
    if (titleEl) {
      data.name = titleEl.textContent.trim();
    }

    // Fallback: hidden anchor's aria-label (contains full business name)
    if (!data.name) {
      const hiddenLink = element.querySelector('a[aria-label]');
      if (hiddenLink) {
        data.name = hiddenLink.getAttribute('aria-label').trim();
      }
    }

    // Fallback: any h3 or heading
    if (!data.name) {
      const heading = element.querySelector('h3, h2');
      if (heading) {
        data.name = heading.textContent.trim();
      }
    }

    // === Parse b_factrow elements for structured data ===
    // Bing puts category, address, phone, hours, etc. in b_factrow divs
    const factRows = element.querySelectorAll('.b_factrow');
    const factTexts = [];
    for (const row of factRows) {
      const text = row.textContent.trim();
      if (text) factTexts.push({ text, element: row });
    }

    // === Rating & Reviews ===
    // Bing shows rating as "4.5/5 (9 reviews)" - scan all text in the card
    const fullText = element.textContent || '';

    // Pattern: "4.5/5" or "4.5 / 5"
    const ratingMatch = fullText.match(/(\d+\.?\d*)\s*\/\s*5/);
    if (ratingMatch) {
      const val = parseFloat(ratingMatch[1]);
      if (val > 0 && val <= 5) {
        data.rating = val;
      }
    }

    // Also check aria-labels for rating (e.g. "Rating: 4.5 out of 5")
    if (data.rating === null) {
      const ratingEl = element.querySelector('[aria-label*="Rating"], [aria-label*="rating"], [aria-label*="out of 5"]');
      if (ratingEl) {
        const ariaLabel = ratingEl.getAttribute('aria-label') || '';
        const ariaMatch = ariaLabel.match(/([\d.]+)\s*(?:out of|\/)\s*5/i);
        if (ariaMatch) {
          data.rating = parseFloat(ariaMatch[1]);
        }
      }
    }

    // Review count: "(239 reviews)" or "239 reviews" or "(9 re..."
    const reviewMatch = fullText.match(/\(?\s*([\d,]+)\s*review/i);
    if (reviewMatch) {
      data.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''), 10);
    }

    // === Category, Address, Phone from factRows ===
    for (const { text } of factTexts) {
      // Skip rating/review text
      if (text.match(/^\d+\.?\d*\s*\/\s*5/) || text.match(/review/i)) continue;

      // Phone detection: contains phone-like pattern
      if (!data.phone) {
        const phoneMatch = text.match(/(?:\+1\s?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
        if (phoneMatch) {
          data.phone = phoneMatch[0].trim();
          continue;
        }
      }

      // Address detection: starts with number + street or contains comma with state/zip
      if (!data.address && text.length > 8 && text.length < 150) {
        if (text.match(/^\d+\s+\w/) || text.match(/,\s*[A-Z]{2}\s+\d{5}/) || text.match(/,\s*\w+\s+(Square|Township|Heights|Park|City)/i)) {
          data.address = text;
          continue;
        }
      }

      // Category detection: short text, no digits, no commas (e.g. "Home service", "Plumber")
      if (!data.category && text.length >= 3 && text.length <= 50) {
        if (!text.match(/\d/) && !text.includes(',') &&
            !text.match(/^open|^close|^hour|^more/i) &&
            !text.match(/sponsored/i) &&
            text !== data.name) {
          data.category = text;
          continue;
        }
      }

      // Address fallback: longer text with comma (like "Bordentown" or "Hamilton Square")
      if (!data.address && text.length > 3 && text.length < 100 && !text.match(/^open|^close|^hour|^more/i)) {
        // If it looks like a location name (not already captured)
        if (text !== data.category && !text.match(/^\d/) && text !== data.name) {
          data.address = text;
        }
      }
    }

    // === Phone fallback: regex scan full element text ===
    if (!data.phone) {
      const phoneMatch = fullText.match(/(?:\+1\s?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
      if (phoneMatch) {
        data.phone = phoneMatch[0].trim();
      }
    }

    // === Website URL ===
    // Bing embeds website data in the card's data attributes or hidden elements
    // Look for external links (not bing.com/microsoft)
    const allLinks = element.querySelectorAll('a[href]');
    for (const link of allLinks) {
      const href = link.href || '';
      if (href.startsWith('http') &&
          !href.includes('bing.com') &&
          !href.includes('bingplaces.com') &&
          !href.includes('microsoft.com') &&
          !href.includes('aka.ms') &&
          !href.includes('google.com') &&
          !href.includes('javascript:') &&
          !href.includes('#')) {
        data.website = href;
        break;
      }
    }

    // === Bing Maps URL ===
    // Construct a search URL using the business name
    if (data.name) {
      const searchQ = encodeURIComponent(data.name + (data.address ? ' ' + data.address : ''));
      data.bingMapsUrl = `https://www.bing.com/maps?q=${searchQ}`;
    }

    // Override with actual listing ID if available
    const cardId = element.id || element.getAttribute('data-bm');
    if (cardId && data.name) {
      data.bingMapsUrl = `https://www.bing.com/maps?q=${encodeURIComponent(data.name)}&id=${cardId}`;
    }

  } catch (error) {
    console.warn('[Bing Scraper] Error extracting business data:', error);
  }

  return data;
}

// Check if a business passes all active filters
function passesFilters(data) {
  if (!activeFilters) return true;

  // Minimum rating
  if (activeFilters.minRating > 0) {
    if (data.rating === null || data.rating < activeFilters.minRating) return false;
  }

  // Minimum review count
  if (activeFilters.minReviewCount > 0) {
    if (data.reviewCount === null || data.reviewCount < activeFilters.minReviewCount) return false;
  }

  // Must have website
  if (activeFilters.mustHaveWebsite && !data.website) return false;

  // Must have phone
  if (activeFilters.mustHavePhone && !data.phone) return false;

  // Category include keywords (OR logic)
  if (activeFilters.categoryInclude && activeFilters.categoryInclude.trim()) {
    const keywords = activeFilters.categoryInclude.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.length > 0) {
      const category = (data.category || '').toLowerCase();
      if (!keywords.some(kw => category.includes(kw))) return false;
    }
  }

  // Category exclude keywords (OR logic)
  if (activeFilters.categoryExclude && activeFilters.categoryExclude.trim()) {
    const keywords = activeFilters.categoryExclude.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.length > 0) {
      const category = (data.category || '').toLowerCase();
      if (keywords.some(kw => category.includes(kw))) return false;
    }
  }

  return true;
}

// Check if a URL is an external business website (not a maps/platform/social URL)
function isExternalBusinessUrl(href) {
  if (!href || !href.startsWith('http')) return false;
  const excludeDomains = [
    'bing.com', 'bingplaces.com', 'microsoft.com', 'aka.ms',
    'google.com', 'gstatic.com', 'googleapis.com', 'cloudflare.com', 'w3.org'
  ];
  if (excludeDomains.some(domain => href.includes(domain))) return false;
  if (href.includes('javascript:') || href.includes('#')) return false;
  // Exclude social media - we want the actual business website
  const socialDomains = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'youtube.com', 'yelp.com', 'tripadvisor.com'
  ];
  if (socialDomains.some(domain => href.includes(domain))) return false;
  return true;
}

// Resolve a link's href to the actual business URL.
// Bing Maps wraps external links through a tracking redirect:
//   bing.com/alink/link?url=https%3a%2f%2fwww.example.com%2f&source=serp-local&...
// This function extracts the real URL from the redirect, or returns the href directly if external.
function resolveBusinessUrl(href) {
  if (!href) return null;
  // Check if it's a Bing tracking redirect
  if (href.includes('/alink/link')) {
    try {
      const urlObj = new URL(href);
      const realUrl = urlObj.searchParams.get('url');
      if (realUrl) {
        const decoded = decodeURIComponent(realUrl);
        if (isExternalBusinessUrl(decoded)) return decoded;
      }
    } catch (e) {}
    return null;
  }
  // Direct URL
  if (isExternalBusinessUrl(href)) return href;
  return null;
}

// Click a business card and extract website URL from the Bing Maps detail panel.
// Bing Maps only shows website links in the detail view that appears when you click a card.
// Links are wrapped through bing.com/alink/link redirects, so we use resolveBusinessUrl().
async function clickCardAndExtractWebsite(cardElement, businessName) {
  try {
    // Click the card to open/update the detail panel
    cardElement.click();

    // Wait for the detail panel to render with this business's info
    await new Promise(resolve => setTimeout(resolve, 1500));

    const allPageLinks = document.querySelectorAll('a[href]');

    // Strategy 1: Links with website-related aria-labels or titles
    const labeledLinks = document.querySelectorAll(
      'a[aria-label*="website" i], a[aria-label*="web site" i], a[title*="website" i]'
    );
    for (const link of labeledLinks) {
      const resolved = resolveBusinessUrl(link.href);
      if (resolved) {
        console.log(`[Bing Scraper] Found website via labeled link: ${resolved}`);
        return resolved;
      }
    }

    // Strategy 2: Links whose visible text says "Website"
    for (const link of allPageLinks) {
      const text = (link.textContent || '').trim();
      if (/^(website|visit website|go to website|web)$/i.test(text)) {
        const resolved = resolveBusinessUrl(link.href);
        if (resolved) {
          console.log(`[Bing Scraper] Found website via text link: ${resolved}`);
          return resolved;
        }
      }
    }

    // Strategy 3: Links whose visible text IS a URL (e.g., "https://www.wbeplumber.com")
    for (const link of allPageLinks) {
      const text = (link.textContent || '').trim();
      if (/^https?:\/\//i.test(text)) {
        const resolved = resolveBusinessUrl(link.href);
        if (resolved) {
          console.log(`[Bing Scraper] Found website via URL text: ${resolved}`);
          return resolved;
        }
      }
    }

    // Strategy 4: target="_blank" links with Bing redirect URLs (most common pattern).
    // Bing Maps wraps business website links as:
    //   <a target="_blank" href="bing.com/alink/link?url=<encoded_real_url>&...">Business Name</a>
    // These only appear in the detail panel, not on the listing cards themselves.
    for (const link of allPageLinks) {
      if (link.target !== '_blank') continue;
      const resolved = resolveBusinessUrl(link.href);
      if (resolved) {
        // Make sure this link isn't inside a different listing card
        const parentCard = link.closest('.b_maglistcard');
        if (!parentCard || parentCard === cardElement) {
          console.log(`[Bing Scraper] Found website via Bing redirect: ${resolved}`);
          return resolved;
        }
      }
    }

    // Strategy 5: Any resolved external link NOT inside a different listing card
    for (const link of allPageLinks) {
      const resolved = resolveBusinessUrl(link.href);
      if (!resolved) continue;
      const parentCard = link.closest('.b_maglistcard');
      if (!parentCard || parentCard === cardElement) {
        console.log(`[Bing Scraper] Found website via broad fallback: ${resolved}`);
        return resolved;
      }
    }

    console.log(`[Bing Scraper] No website found in detail panel for: ${businessName}`);
    return null;
  } catch (error) {
    console.warn(`[Bing Scraper] Error extracting website for ${businessName}:`, error);
    return null;
  }
}

// Close the detail panel to return to the clean list view
async function closeDetailPanel() {
  const closeSelectors = [
    'button[aria-label*="close" i]',
    'button[aria-label*="back" i]',
    'a[aria-label*="back to" i]',
    '.taskPaneClose', '.overlay-close',
    '.b_close', 'button.closeBtn'
  ];

  for (const sel of closeSelectors) {
    const btn = document.querySelector(sel);
    if (btn && btn.offsetParent !== null) {
      btn.click();
      await new Promise(resolve => setTimeout(resolve, 300));
      return;
    }
  }

  // Fallback: press Escape key to dismiss any open panel
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 300));
}

// Scrape currently visible results (async to support clicking cards for website extraction)
async function scrapeVisibleResults() {
  const listings = getVisibleListings();
  let newCount = 0;
  let duplicatesThisRound = 0;
  let filteredThisRound = 0;

  console.log(`[Bing Scraper] Found ${listings.length} listing elements on page`);

  for (const listing of listings) {
    // Stop if scraping was cancelled
    if (!isScrapin) break;

    const data = extractBusinessData(listing);

    // Skip if no name
    if (!data.name) {
      console.log('[Bing Scraper] Skipping listing - no name found');
      continue;
    }

    const identifier = data.bingMapsUrl || data.name;

    // Check if already seen in this session
    if (seenIds.has(identifier)) continue;

    // Check if in URL history (duplicate from previous scrapes)
    if (urlHistory.has(identifier)) {
      duplicatesThisRound++;
      totalDuplicatesSkipped++;
      console.log(`[Bing Scraper] Skipping duplicate: ${data.name}`);
      seenIds.add(identifier);
      continue;
    }

    seenIds.add(identifier);

    // Click card to extract website from the detail panel.
    // Bing Maps only shows website links in the detail view, not on the listing card.
    if (!data.website) {
      const website = await clickCardAndExtractWebsite(listing, data.name);
      if (website) {
        data.website = website;
      }
    }

    // Apply pre-scrape filters (now with website data from detail panel)
    if (!passesFilters(data)) {
      filteredThisRound++;
      totalFilteredOut++;
      console.log(`[Bing Scraper] Filtered out: ${data.name} (rating: ${data.rating}, reviews: ${data.reviewCount}, website: ${data.website ? 'yes' : 'no'})`);
      continue;
    }

    scrapedData.push(data);
    newCount++;
    console.log(`[Bing Scraper] Added: ${data.name} (website: ${data.website || 'none'})`);
  }

  // Close detail panel after processing all cards in this batch
  if (listings.length > 0) {
    await closeDetailPanel();
  }

  console.log(`[Bing Scraper] New items this round: ${newCount}, Filtered: ${filteredThisRound}, Duplicates: ${duplicatesThisRound}, Total: ${scrapedData.length}`);
  return { newCount, filteredThisRound };
}

// Try to load more results via scrolling and pagination buttons
async function loadMoreResults() {
  // Strategy 1: Look for explicit "Show more" / "Next" pagination links
  const moreSelectors = [
    'a[aria-label*="next" i]',
    'a[aria-label*="more results" i]',
    'button[aria-label*="next" i]',
    'button[aria-label*="more results" i]',
    '.b_pag a',
    '.b_lstcards a.showMore'
  ];

  for (const sel of moreSelectors) {
    const btn = document.querySelector(sel);
    if (btn && btn.offsetParent !== null) {
      console.log(`[Bing Scraper] Clicking pagination element: ${sel}`);
      btn.click();
      await new Promise(resolve => setTimeout(resolve, PAGINATION_DELAY));
      return true;
    }
  }

  // Strategy 2: Scroll the results panel to trigger lazy loading
  const resultsPanel = getResultsContainer();
  if (resultsPanel) {
    const prevHeight = resultsPanel.scrollHeight;
    const prevScroll = resultsPanel.scrollTop;
    const prevListingCount = getVisibleListings().length;

    // Smooth scroll to bottom in steps to trigger lazy-load observers
    const scrollStep = 500;
    const maxScroll = resultsPanel.scrollHeight - resultsPanel.clientHeight;

    if (resultsPanel.scrollTop < maxScroll - 10) {
      // Scroll down in a step
      resultsPanel.scrollTop = Math.min(resultsPanel.scrollTop + scrollStep, maxScroll);
      await new Promise(resolve => setTimeout(resolve, 800));

      // Then jump to the very bottom
      resultsPanel.scrollTop = resultsPanel.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, PAGINATION_DELAY));
    } else {
      // Already near bottom - scroll to very end
      resultsPanel.scrollTop = resultsPanel.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, PAGINATION_DELAY));
    }

    const newHeight = resultsPanel.scrollHeight;
    const newListingCount = getVisibleListings().length;
    const heightIncreased = newHeight > prevHeight;
    const didScroll = resultsPanel.scrollTop > prevScroll;
    const moreListings = newListingCount > prevListingCount;

    if (heightIncreased || moreListings) {
      console.log(`[Bing Scraper] Scrolled - height: ${prevHeight} -> ${newHeight}, listings: ${prevListingCount} -> ${newListingCount}`);
      return true;
    }

    if (didScroll) {
      console.log(`[Bing Scraper] Scrolled down but no new content yet (scroll: ${prevScroll} -> ${resultsPanel.scrollTop})`);
      return true;
    }
  }

  console.log('[Bing Scraper] No more results to load');
  return false;
}

// Main scraping function
async function startScraping(filters) {
  if (!isOnSearchResults()) {
    sendError('Please navigate to Bing Maps search results first');
    return;
  }

  isScrapin = true;
  scrapedData = [];
  seenIds.clear();
  totalDuplicatesSkipped = 0;
  activeFilters = filters || null;
  totalFilteredOut = 0;

  // Reload URL history from storage
  try {
    const histResult = await chrome.storage.local.get(['scrapedUrlHistory']);
    urlHistory = new Set(histResult.scrapedUrlHistory || []);
    console.log(`[Bing Scraper] Refreshed URL history: ${urlHistory.size} URLs`);
  } catch (e) {
    console.warn('[Bing Scraper] Could not refresh URL history:', e);
  }

  if (activeFilters) {
    console.log('[Bing Scraper] Active filters:', JSON.stringify(activeFilters));
  }

  // Wait a moment for Bing Maps to fully render results
  await new Promise(resolve => setTimeout(resolve, 1000));

  let noNewResultsCount = 0;

  while (isScrapin && scrapedData.length < MAX_RESULTS) {
    // Scrape visible results
    const result = await scrapeVisibleResults();
    const hadActivity = result.newCount > 0 || result.filteredThisRound > 0;

    // Send progress update
    sendProgress(scrapedData.length);

    if (!hadActivity) {
      noNewResultsCount++;
      console.log(`[Bing Scraper] No new items found (attempt ${noNewResultsCount}/${MAX_NO_NEW_RESULTS})`);

      if (noNewResultsCount >= MAX_NO_NEW_RESULTS) {
        console.log('[Bing Scraper] Stopping: No new results found after multiple attempts');
        break;
      }
    } else {
      noNewResultsCount = 0;
    }

    // Try to load more results
    const moreAvailable = await loadMoreResults();

    if (!moreAvailable && noNewResultsCount >= 2) {
      console.log('[Bing Scraper] Stopping: No more results to load');
      break;
    }
  }

  console.log(`[Bing Scraper] Finished with ${scrapedData.length} total results`);

  isScrapin = false;
  sendComplete();
}

// Stop scraping
function stopScraping() {
  isScrapin = false;
}

// Send progress message to popup
function sendProgress(count) {
  chrome.runtime.sendMessage({
    type: 'progress',
    count: count,
    duplicatesSkipped: totalDuplicatesSkipped,
    filteredOut: totalFilteredOut,
    data: scrapedData
  }).catch(() => {
    // Popup might be closed
  });
}

// Send completion message to popup
async function sendComplete() {
  // Persist new URLs to history
  try {
    const newUrls = scrapedData
      .map(d => d.bingMapsUrl || d.name)
      .filter(Boolean);

    const result = await chrome.storage.local.get(['scrapedUrlHistory']);
    const existingHistory = result.scrapedUrlHistory || [];
    const updatedHistory = [...new Set([...existingHistory, ...newUrls])];

    // Keep max 5000 URLs in history
    const trimmedHistory = updatedHistory.slice(-5000);

    await chrome.storage.local.set({ scrapedUrlHistory: trimmedHistory });

    urlHistory = new Set(trimmedHistory);
    console.log(`[Bing Scraper] Saved ${newUrls.length} new URLs to history. Total: ${trimmedHistory.length}`);
  } catch (error) {
    console.warn('[Bing Scraper] Error saving URL history:', error);
  }

  chrome.runtime.sendMessage({
    type: 'complete',
    data: scrapedData,
    duplicatesSkipped: totalDuplicatesSkipped,
    filteredOut: totalFilteredOut
  }).catch(() => {
    // Popup might be closed
  });
}

// Send error message to popup
function sendError(message) {
  chrome.runtime.sendMessage({
    type: 'error',
    message: message
  }).catch(() => {
    // Popup might be closed
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    startScraping(message.filters);
    sendResponse({ status: 'started' });
  } else if (message.action === 'stopScraping') {
    stopScraping();
    sendResponse({ status: 'stopped', data: scrapedData });
  } else if (message.action === 'getStatus') {
    sendResponse({
      isScrapin: isScrapin,
      data: scrapedData,
      count: scrapedData.length
    });
  }
  return true;
});

console.log('Bing Maps Lead Scraper content script loaded');
