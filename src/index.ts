import { Browser, BrowserContext } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { SKUEntry, ProductResult } from "./types";
import { logger } from "./logger";
import { initCsv, appendToCsv, getCsvPath } from "./csv";
import { scrapeAmazon } from "./scrapers/amazon";
import { utils } from "./utils";
import path from "path";
import { scrapeWalmartBrowser } from "./scrapers/walmart";
import { withRetry } from "./retry";

chromiumExtra.use(StealthPlugin());

// ── Configuration ──────────────────────────────────────────────────────────────

const opts = {
  skuFile: path.resolve(__dirname, "../skus.json"),
};


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
    const message = err instanceof Error ? err.message : String(err);
    logger.error("main", message);
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
  const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ];

  const context: BrowserContext = await browser.newContext({
    userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });

  // 6. Scrape each SKU
  let successCount = 0;
  let partialCount = 0;
  let errorCount = 0;

  for (let i = 0; i < supported.length; i++) {
    const entry = supported[i];
    logger.separator();
    logger.info(`Processing SKU ${i + 1}/${supported.length}: [${entry.Type}] ${entry.SKU}`);

    // Random pre-navigation jitter to mimic human behaviour (1.5–3.5 s)
    const jitterMs = 1_500 + Math.floor(Math.random() * 2_000);
    logger.info(`Waiting ${jitterMs}ms before navigating…`);
    await utils.delay(jitterMs);

    const page = await context.newPage();
    let result: ProductResult | null = null;
    try {
      if (entry.Type.toLowerCase() === "amazon") {
        result = await withRetry(() => scrapeAmazon(page, entry.SKU));
      } else if (entry.Type.toLowerCase() === "walmart") {
        result = await withRetry(() => scrapeWalmartBrowser(page, entry.SKU));
      } else {
        logger.warn(entry.SKU, `No scraper available for type "${entry.Type}"`);
      }
    } finally {
      await page.close().catch(() => undefined);
    }

    if (!result) continue;

    await appendToCsv(result);
    logger.step(entry.SKU, "Result written to CSV");

    if (result.status === "success") successCount++;
    else if (result.status === "partial") partialCount++;
    else errorCount++;

  }

  // 7. Close browser
  logger.separator();
  logger.info("Closing browser");
  await browser.close();

  // 8. Summary
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