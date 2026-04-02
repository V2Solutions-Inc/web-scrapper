# SKU Scraper

A TypeScript + Playwright scraper that extracts **Price**, **Title**, **Description**, and **Number of Reviews** for each product SKU from supported platforms (Amazon and Walmart).

---

## Project Structure

```
sku-scraper/
├── skus.json               ← Input: your list of SKUs
├── product_data.csv        ← Output: extracted product data (auto-created)
├── scraper.log             ← Full step-by-step execution log (auto-created)
├── errors.log              ← Errors and warnings only (auto-created)
├── src/
│   ├── index.ts            ← Main entry point
│   ├── types.ts            ← Shared TypeScript interfaces
│   ├── logger.ts           ← Console + file logger
│   ├── csv.ts              ← CSV writer
│   ├── retry.ts            ← Configurable retry wrapper with exponential backoff
│   ├── utils.ts            ← Helpers (randomDelay, loadSku, filterSupported, trySelectors)
│   ├── blockDetector.ts    ← Walmart bot-wall detection
│   └── scrapers/
│       ├── amazon.ts           ← Amazon scraper (Playwright browser automation)
│       ├── walmart.ts          ← Walmart scraper (browser-based, not currently active)
│       ├── walmartFetch.ts     ← Walmart scraper (HTTP fetch, currently active)
│       └── walmartCookies.ts   ← PerimeterX cookie refresh via browser warm-up
├── tsconfig.json
└── package.json
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install Playwright browser

```bash
npx playwright install chromium
```

### 3. (Optional) Set Walmart cookies

For more reliable Walmart scraping, provide a real browser cookie string:

```bash
export WALMART_COOKIES='<your cookie string>'
```

How to get it:
1. Open Chrome and browse to walmart.com
2. DevTools → Network → click any walmart.com request
3. Right-click → Copy → Copy as cURL
4. Extract the value after `-b '...'`

Without this, the scraper will still attempt Walmart requests — it may succeed on clean residential IPs.

---

## Usage

### Run with default `skus.json`

```bash
npm start
```

### Build and run compiled JS

```bash
npm run build
npm run run:built
```

---

## Input Format (`skus.json`)

```json
{
  "skus": [
    { "Type": "Amazon", "SKU": "B0CT4BB651" },
    { "Type": "Walmart", "SKU": "5326288985" }
  ]
}
```

- **Type**: Platform identifier. Supported values: `"Amazon"`, `"Walmart"`. Other types are logged as skipped.
- **SKU**: The product identifier (ASIN for Amazon, item ID for Walmart).

---

## Supported Platforms

| Platform | Method | Notes |
|----------|--------|-------|
| Amazon   | Playwright browser automation | Uses stealth plugin; blocks images/fonts/media for speed |
| Walmart  | HTTP fetch (no browser) | Reads `__NEXT_DATA__` JSON from page HTML; optional cookie support for PerimeterX tokens |

---

## Output Files

| File                | Description                          |
| -------------       | ------------------------------------ |
| `product_data.csv`  | All extracted product data           |
| `scraper.log`       | Full execution trace with timestamps |
| `errors.log`        | Warnings and errors only             |

### CSV Columns

| Column            | Description                            |
| ----------------- | -------------------------------------- |
| Type              | Platform (Amazon, Walmart, etc.)       |
| SKU               | Product identifier                     |
| Title             | Product title                          |
| Price             | Current price                          |
| Description       | Feature bullets or product description |
| Number of Reviews | Total review count                     |
| Status            | `success` / `partial` / `error`        |
| Error             | Error message if scraping failed       |

---

## Status Values

| Status    | Meaning                               |
| --------- | ------------------------------------- |
| `success` | Title and price both extracted        |
| `partial` | Some fields extracted, others missing |
| `error`   | No data could be extracted            |

---

## Anti-Detection & Reliability

- **Stealth plugin**: Amazon scraping uses `puppeteer-extra-plugin-stealth` to appear less bot-like.
- **Realistic headers**: Requests spoof Chrome 146 on macOS with matching `sec-ch-ua`, `sec-fetch-*`, and `user-agent` headers.
- **Request delay**: A randomized ~2.5s delay is added between each request to reduce rate-limiting risk.
- **Resource blocking**: Images, fonts, and media are blocked for Amazon page loads; all resources are allowed for Walmart to avoid triggering bot detection.
- **Retry logic**: Failed requests are retried up to 3 times with exponential backoff (3s → 6s → 9s). Retries are skipped for HTTP 404 (product not found) and CAPTCHA (requires human intervention).
- **PerimeterX / bot-wall detection**: Walmart responses are checked for challenge-page markers (`Robot or human?`, `/blocked`). Detected challenge pages are logged and counted as errors rather than silently returning empty data.
- **Cookie support**: Supplying `WALMART_COOKIES` passes real PerimeterX session tokens with each Walmart request, significantly reducing blocking risk.

## Limitations
- The Walmart parsing uses fetch instead of Playwright, because Playwright sessions were getting blocked. Just to test the parsing logic the we need to pass the `WALMART_COOKIES` (copied from browser), to make the request pass from Walmart (not a production solution though).
