import * as fs from "fs";
import { Browser, BrowserContext, Page } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { SKUEntry, ProductResult } from "./types";
import { logger } from "./logger";
import { initCsv, appendToCsv, getCsvPath } from "./csv";
import { scrapeAmazon } from "./scrapers/amazon";
import { utils } from "./utils";
import { refreshWalmartCookies, WALMART_COOKIE_REFRESH_EVERY } from "./scrapers/walmartCookies";
import path from "path";
import { scrapeWalmart } from "./scrapers/walmartFetch";
import { withRetry } from "./retry";

chromiumExtra.use(StealthPlugin());

// ── Configuration ──────────────────────────────────────────────────────────────

const opts = {
  skuFile: path.resolve(__dirname, "../skus.json"),
};

const REQUEST_DELAY_MS = 2_500;

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("═══════════════════════════════════════════════════════════════");
  logger.info("  SKU Scraper – starting");
  logger.info(`  SKU file : ${opts.skuFile}`);
  logger.info("═══════════════════════════════════════════════════════════════");

  // 1. Load SKUs
  let allSkus: SKUEntry[];
  try {
    allSkus = utils.loadSku(opts.skuFile);
  } catch (err) {
    logger.error("main", "Failed to load SKU file", err);
    process.exit(1);
  }
  logger.info(`Total SKUs loaded: ${allSkus.length}`);

  // 2. Filter to supported platforms
  const { supported, skipped } = utils.filterSupported(allSkus);
  logger.info(`Supported SKUs (will scrape): ${supported.length}`);
  if (skipped.length > 0) {
    logger.info(
      `Skipped SKUs (unsupported platform): ${skipped.length} – ` +
        skipped.map((s) => `${s.Type}:${s.SKU}`).join(", ")
    );
  }

  if (supported.length === 0) {
    logger.info("No supported SKUs to scrape. Exiting.");
    process.exit(0);
  }

  // 3. Initialise CSV
  await initCsv();
  logger.info(`CSV output initialised: ${getCsvPath()}`);

  // 4. Launch browser
  logger.info("Launching Chromium browser (headless + stealth)");
  let browser: Browser;
  try {
    browser = await chromiumExtra.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,800",
      ],
    }) as unknown as Browser;
  } catch (err) {
    logger.error("main", "Failed to launch browser", err);
    process.exit(1);
  }

  // 5. Create browser context
  // User-Agent and sec-ch-ua headers must be internally consistent.
  // These match the real Chrome 146 / macOS session observed working against Walmart.
  const contextOptions = {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        timezoneId: "America/Los_Angeles",
        extraHTTPHeaders: {
          "Accept-Language":           "en-US,en;q=0.9,hi;q=0.8,kn;q=0.7,ml;q=0.6",
          "Accept-Encoding":           "gzip, deflate, br, zstd",
          "Cache-Control":             "no-cache",
          "Connection":                "keep-alive",
          "Pragma":                    "no-cache",
          "sec-ch-ua":                 '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
          "sec-ch-ua-mobile":          "?0",
          "sec-ch-ua-platform":        '"macOS"',
          "Sec-Fetch-Dest":            "document",
          "Sec-Fetch-Mode":            "navigate",
          "Sec-Fetch-Site":            "none",
          "Sec-Fetch-User":            "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      };

  const context: BrowserContext = await browser.newContext(contextOptions);

  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    const url = route.request().url();
    const isWalmart = url.includes("walmart.com");
    // Allow all resources for Walmart (bot detector checks resource loading).
    // Block heavy assets for all other sites (e.g. Amazon) to speed up scraping.
    if (!isWalmart && ["image", "font", "media"].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });


  const page: Page = await context.newPage();

  // 6. Walmart cookie state
  // Auto-refresh via browser warm-up — used when no env var is set
  let walmartCookies: string = process.env.WALMART_COOKIES || "";
  let walmartSkusSinceRefresh = 0;

  const hasWalmartSkus = supported.some((e) => e.Type.toLowerCase() === "walmart");

  if (hasWalmartSkus && !walmartCookies) {
    // Pre-warm: visit walmart.com homepage so PerimeterX issues fresh tokens
    // before we start scraping product pages.
    logger.info("Walmart: no cookies set — performing browser warm-up to get fresh session tokens...");
    walmartCookies = await refreshWalmartCookies(context);
  }

  // 7. Scrape each SKU
  let successCount = 0;
  let partialCount = 0;
  let errorCount = 0;

  for (let i = 0; i < supported.length; i++) {
    const entry = supported[i];
    logger.separator();
    logger.info(`Processing SKU ${i + 1}/${supported.length}: [${entry.Type}] ${entry.SKU}`);

    let result: ProductResult;

    if (entry.Type.toLowerCase() === "amazon") {

      result = await withRetry(() => scrapeAmazon(page, entry.SKU));

    } else if (entry.Type.toLowerCase() === "walmart") {

      result = await withRetry(() => scrapeWalmart(page, entry.SKU, { cookies: walmartCookies }));

    } else {
      logger.warn(entry.SKU, `No scraper available for type "${entry.Type}"`);
      continue;
    }

    await appendToCsv(result);
    logger.step(entry.SKU, "Result written to CSV");

    if (result.status === "success") successCount++;
    else if (result.status === "partial") partialCount++;
    else errorCount++;

    if (i < supported.length - 1) {
      logger.info(`Waiting ${REQUEST_DELAY_MS}ms before next request…`);
      await utils.randomDelay(REQUEST_DELAY_MS);
    }
  }

  // 8. Close browser
  logger.separator();
  logger.info("Closing browser");
  await browser.close();

  // 9. Summary
  logger.separator();
  logger.info("═══════════════════════════════════════════════════════════════");
  logger.info("  Scraping complete – Summary");
  logger.info(`  Success : ${successCount}`);
  logger.info(`  Partial : ${partialCount}`);
  logger.info(`  Error   : ${errorCount}`);
  logger.info(`  CSV     : ${getCsvPath()}`);
  logger.info(`  Log     : scraper.log`);
  logger.info(`  Errors  : errors.log`);
  logger.info("═══════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  logger.error("main", "Unhandled fatal error", err);
  process.exit(1);
});