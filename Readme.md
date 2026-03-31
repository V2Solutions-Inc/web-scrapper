# SKU Scraper

A TypeScript + Playwright scraper that extracts **Price**, **Title**, **Description**, and **Number of Reviews** for each product SKU from supported platforms (currently Amazon).

---

## Project Structure

```
sku-scraper/
├── skus.json               ← Input: your list of SKUs
├── output.csv              ← Output: extracted product data (auto-created)
├── scraper.log             ← Full step-by-step execution log (auto-created)
├── errors.log              ← Errors and warnings only (auto-created)
├── src/
│   ├── index.ts            ← Main entry point
│   ├── types.ts            ← Shared TypeScript interfaces
│   ├── logger.ts           ← Console + file logger
│   ├── csv.ts              ← CSV writer
│   └── scrapers/
│       └── amazon.ts       ← Amazon-specific scraper logic
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

- **Type**: Platform identifier. Currently `"Amazon"` is supported. Other types are logged as skipped.
- **SKU**: The product identifier (ASIN for Amazon).

---

## Output Files

| File          | Description                          |
| ------------- | ------------------------------------ |
| `output.csv`  | All extracted product data           |
| `scraper.log` | Full execution trace with timestamps |
| `errors.log`  | Warnings and errors only             |

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

## Notes

- A randomised ~2.5s delay is added between each request to reduce rate-limiting risk.
- Images, fonts, and media are blocked to speed up page loads.
- The scraper uses a realistic User-Agent and browser context to appear less bot-like.
- Amazon may still detect and block automated requests (CAPTCHA). If this happens frequently, consider adding cookie-based authentication or using a proxy.


