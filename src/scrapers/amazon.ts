import { Page } from "playwright";
import { logger } from "../logger";
import { ProductResult } from "../types";
import { utils } from "../utils";

const AMAZON_BASE_URL = "https://www.amazon.com/dp/";

export interface AmazonScrapeOptions {}

/**
 * Load the page from the live Amazon URL.
 * Returns false if the page could not be loaded (HTTP error, CAPTCHA).
 */
async function loadPage(
  page: Page,
  sku: string,
): Promise<boolean> {
  const url = `${AMAZON_BASE_URL}${sku}`;
  logger.step(sku, `Navigating to ${url}`);

  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const status = response?.status() ?? 0;
  logger.step(sku, `Page responded with HTTP ${status}`);

  if (status === 404) {
    logger.error(sku, "Product page returned 404 – SKU may be invalid or delisted.");
    return false;
  }

  if (status === 503 || status === 429) {
    logger.warn(sku, `HTTP ${status} – Amazon may be rate-limiting or blocking the request.`);
    // Continue anyway; the page may still have partial content
  }

  // CAPTCHA / bot-wall check
  logger.step(sku, "Checking for CAPTCHA or bot-wall");
  const bodyText = await page.locator("body").textContent();
  if (
    bodyText?.toLowerCase().includes("enter the characters you see below") ||
    bodyText?.toLowerCase().includes("sorry, we just need to make sure")
  ) {
    logger.error(sku, "Amazon displayed a CAPTCHA / bot-detection page. Skipping SKU.");
    return false;
  }

  return true;
}

export async function scrapeAmazon(
  page: Page,
  sku: string,
): Promise<ProductResult> {
  const result: ProductResult = {
    type: "Amazon",
    sku,
    title: "",
    price: "",
    description: "",
    numberOfReviews: "",
    status: "error",
  };

  try {
    // ── Step 1: Load page ──────────────────────────────────────────────────
    const loaded = await loadPage(page, sku);
    if (!loaded) {
      result.errorMessage = "Failed to load page (HTTP error or CAPTCHA)";
      return result;
    }

    // ── Step 2: Title ──────────────────────────────────────────────────────
    logger.step(sku, "Extracting title");
    result.title = await utils.trySelectors(page, [
      "#productTitle",
      "span#productTitle",
      "h1.a-size-large",
      "[data-feature-name='title'] span",
    ]);

    if (result.title) {
      logger.step(sku, `Title found: "${result.title.substring(0, 60)}..."`);
    } else {
      logger.warn(sku, "Title not found – selector may have changed.");
    }

    // ── Step 3: Price ──────────────────────────────────────────────────────
    logger.step(sku, "Extracting price");
    result.price = await utils.trySelectors(page, [
      ".a-price .a-offscreen",
    ]);

    if (result.price) {
      logger.step(sku, `Price found: ${result.price}`);
    } else {
      logger.warn(sku, "Price not found – product may be unavailable or selector changed.");
    }

    // ── Step 4: Description ────────────────────────────────────────────────
    logger.step(sku, "Extracting description");

    const featureBullets = page.locator("#feature-bullets ul li span.a-list-item");
    const bulletCount = await featureBullets.count();

    if (bulletCount > 0) {
      const bullets: string[] = [];
      for (let i = 0; i < bulletCount; i++) {
        const text = (await featureBullets.nth(i).textContent())?.trim() ?? "";
        if (text) bullets.push(`• ${text}`);
      }
      result.description = bullets.join("\n");
      logger.step(sku, `Description extracted from ${bulletCount} feature bullet(s).`);
    } else {
      logger.warn(sku, "Description not found.");
    }

    // ── Step 5: Number of reviews ──────────────────────────────────────────
    logger.step(sku, "Extracting number of reviews");
    result.numberOfReviews = await utils.trySelectors(page, [
      "#acrCustomerReviewText",
    ]);

    if (result.numberOfReviews) {
      result.numberOfReviews = result.numberOfReviews.replace("(", "").replace(")", "");
      logger.step(sku, `Reviews count: ${result.numberOfReviews}`);
    } else {
      logger.warn(sku, "Review count not found.");
    }

    // ── Done ───────────────────────────────────────────────────────────────
    const hasAny = result.title || result.price || result.description || result.numberOfReviews;
    result.status = hasAny
      ? result.title && result.price
        ? "success"
        : "partial"
      : "error";

    if (result.status === "success") {
      logger.success(sku, "All fields extracted successfully.");
    } else if (result.status === "partial") {
      logger.warn(sku, "Some fields could not be extracted – partial result saved.");
    } else {
      logger.error(sku, "No data could be extracted.");
      result.errorMessage = "No data extracted";
    }
  } catch (err) {
    logger.error(sku, "Unexpected error during scraping", err);
    result.errorMessage = err instanceof Error ? err.message : String(err);
  }

  return result;
}