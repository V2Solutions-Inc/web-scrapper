# SKU Scraper

A TypeScript + Playwright scraper that extracts **Price**, **Title**, **Description**, **Rating**, and **Number of Reviews** for each product SKU from supported platforms (Amazon and Walmart).

---

## Prerequisites

This project requires **Node.js v18+** and **npm** (bundled with Node).

**Option A — nvm (recommended):**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 18
nvm use 18
```

**Option B — direct download:**
Visit [nodejs.org](https://nodejs.org) and download the LTS installer for your platform.

Verify your installation:

```bash
node --version   # should print v18.x.x or higher
npm --version
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

| Platform | Method                        | Notes                                                                   |
| -------- | ----------------------------- | ----------------------------------------------------------------------- |
| Amazon   | Playwright browser automation | Uses stealth plugin; blocks images/fonts/media for speed                |
| Walmart  | Playwright browser automation | Full browser rendering to bypass bot detection; optional cookie support |

---

## Output Files

| File               | Description                          |
| ------------------ | ------------------------------------ |
| `product_data.csv` | All extracted product data           |
| `scraper.log`      | Full execution trace with timestamps |
| `errors.log`       | Warnings and errors only             |

### CSV Columns

| Column            | Description                            |
| ----------------- | -------------------------------------- |
| Type              | Platform (Amazon, Walmart, etc.)       |
| SKU               | Product identifier                     |
| Title             | Product title                          |
| Price             | Current price                          |
| Description       | Feature bullets or product description |
| Number of Reviews | Total review count                     |
| Rating            | Average star rating (e.g. `4.0`)       |
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
- **Centralized bot-wall detection**: Block detection logic lives in `blockDetector.ts` and is shared across all scrapers. Amazon checks for CAPTCHA URLs, page titles (`robot check`, `access denied`), and CAPTCHA form presence. Walmart checks for challenge URLs (`/blocked`, `robot-or-human`) and body text (`Robot or human?`).
- **Retry logic**: Failed requests are retried up to 3 times with exponential backoff (3s → 6s → 9s). Retries are skipped for HTTP 404 (product not found) and CAPTCHA (requires human intervention).

## Limitations

- Both scrapers rely on DOM selectors that Walmart and Amazon can change at any time. If data stops being extracted, inspect the live page and update the selectors in `walmartBrowser.ts` or `amazon.ts`.
- Walmart's browser scraping may still be blocked on datacenter IPs. For reliable results, run on a residential IP.
- Does not support concurrency. SKUs are scraped one at a time.
