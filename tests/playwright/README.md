# Playwright Automated Scrape Suite — Phase 1

Automated test and data generation engine for the Maps Lead Scraper extension.
Launches Chrome with the extension loaded, runs Google Maps scrapes, and captures structured output.

## Requirements

- **Node.js** 18+
- **Playwright** (`npm install -g playwright` or use project-level)
- **Google Chrome** (system install — `google-chrome` must be in PATH)
- **Display server** — Chrome extensions require headed mode. On headless servers, use:
  - `--headless` flag (uses Chrome's `--headless=new` mode, supports extensions)
  - Or `xvfb-run` for virtual framebuffer: `sudo apt install xvfb && xvfb-run node run-scrape.js ...`

## Quick Start

```bash
# Single query
node tests/playwright/run-scrape.js plumbers Sydney

# Single query, headless
node tests/playwright/run-scrape.js plumbers Sydney --headless

# Full Phase 1 suite (9 queries)
node tests/playwright/run-scrape.js --all

# Full suite, headless
node tests/playwright/run-scrape.js --all --headless
```

## Phase 1 Query Set

3 industries x 3 cities = 9 queries:

| Industry             | Cities                          |
|----------------------|---------------------------------|
| plumbers             | Sydney, Melbourne, Brisbane     |
| electricians         | Sydney, Melbourne, Brisbane     |
| real estate agents   | Sydney, Melbourne, Brisbane     |

## How It Works

1. Launches Chrome with the Maps Lead Scraper extension loaded
2. Sets license to Pro (bypasses trial limits for automated runs)
3. Navigates to Google Maps search URL for the given query
4. Handles Google consent dialogs if they appear
5. Sends `startScraping` message to the content script via the service worker
6. Polls `getStatus` every 3 seconds until scraping completes
7. Saves results as JSON + CSV in `results/`
8. Appends run metadata to `run-log.csv`

## Output

### Results directory (`results/`)

Each scrape produces two files:

- `{industry}_{city}_{timestamp}.json` — Full structured data with metadata
- `{industry}_{city}_{timestamp}.csv` — CSV matching extension export format

**JSON structure:**
```json
{
  "meta": {
    "query": "plumbers in Sydney",
    "industry": "plumbers",
    "city": "Sydney",
    "timestamp": "2026-03-04T12:00:00.000Z",
    "durationSeconds": 45,
    "resultCount": 120
  },
  "data": [
    {
      "name": "Example Plumbing",
      "rating": 4.5,
      "reviewCount": 123,
      "category": "Plumber",
      "address": "123 Main St, Sydney NSW 2000",
      "phone": "02 1234 5678",
      "website": "https://example.com",
      "googleMapsUrl": "https://www.google.com/maps/place/..."
    }
  ]
}
```

### Run log (`run-log.csv`)

Cumulative log of all automated runs:

```
timestamp,industry,city,query,result_count,duration_seconds,output_file,status
2026-03-04T12:00:00.000Z,plumbers,Sydney,plumbers in Sydney,120,45,plumbers_Sydney_2026-03-04_12-00-00.json,success
```

## Triggering via Dispatcher

The task dispatcher (`task-dispatcher.js`) can inject scrape commands into Jack's tmux session.
The dispatcher should call:

```bash
node /home/jack/projects/google-maps-scraper/tests/playwright/run-scrape.js <industry> <city> --headless
```

Or for the full suite:

```bash
node /home/jack/projects/google-maps-scraper/tests/playwright/run-scrape.js --all --headless
```

The script exits with code 0 on success, 1 if any query fails.

## Configuration

Key constants in `run-scrape.js`:

| Constant              | Default   | Description                              |
|-----------------------|-----------|------------------------------------------|
| `MAPS_LOAD_TIMEOUT`   | 30s       | Max wait for Maps results to appear      |
| `SCRAPE_POLL_INTERVAL` | 3s       | How often to check scraping progress     |
| `SCRAPE_MAX_WAIT`     | 300s (5m) | Max time per scrape before timeout       |
| `CONSENT_TIMEOUT`     | 5s        | Time to check for consent dialog         |

## Troubleshooting

**"Could not find Google Maps tab"**
Google may be blocking automated access. Try running with `--headless` or check if a CAPTCHA is appearing.

**"Please navigate to Google Maps search results"**
The page didn't load in time. Check network connectivity and increase `MAPS_LOAD_TIMEOUT`.

**Stale Chrome profile errors**
Delete the `.chrome-profile` directory: `rm -rf tests/playwright/.chrome-profile`

**"No display" errors on server**
Use `--headless` flag or install xvfb: `sudo apt install xvfb && xvfb-run node run-scrape.js ...`
