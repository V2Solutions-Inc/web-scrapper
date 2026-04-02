import { Page } from "playwright";
import { logger } from "../logger";
import { ProductResult } from "../types";
import { utils } from "../utils";
import { detectBlock } from "../blockDetector";

const WALMART_BASE_URL = "https://www.walmart.com/ip/";

/**
 * Load the Walmart product page using the browser.
 * Returns null on success, or an error string on bot-wall detection or fatal HTTP errors.
 */
async function loadPage(page: Page, sku: string): Promise<string | null> {
  const url = `${WALMART_BASE_URL}${sku}`;
  logger.step(sku, `Navigating to ${url}`);

  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const status = response?.status() ?? 0;
  logger.step(sku, `Page responded with HTTP ${status}`);

  if (status === 404) {
    logger.error(sku, "Product page returned 404 – SKU may be invalid or delisted.");
    return "HTTP 404";
  }

  // Bot-wall check
  const { blocked, reason } = await detectBlock(page, "walmart");
  if (blocked) {
    logger.error(sku, `Walmart bot-wall detected (${reason}). Skipping SKU.`);
    return `BLOCKED: ${reason}`;
  }

  return null;
}

export async function scrapeWalmartBrowser(
  page: Page,
  sku: string,
): Promise<ProductResult> {
  const result: ProductResult = {
    type: "Walmart",
    sku,
    title: "",
    price: "",
    description: "",
    numberOfReviews: "",
    rating: "",
    status: "error",
  };

  try {
    // ── Step 1: Load page ──────────────────────────────────────────────────
    const loadError = await loadPage(page, sku);
    if (loadError) {
      result.errorMessage = loadError;
      return result;
    }

    // ── Step 2: Title ──────────────────────────────────────────────────────
    logger.step(sku, "Extracting title");
    result.title = await utils.trySelectors(page, [
      'h1[itemprop="name"]',
      "h1.lh-copy",
    ]);
    if (result.title) {
      logger.step(sku, `Title found: "${result.title.substring(0, 60)}..."`);
    } else {
      logger.warn(sku, "Title not found – selector may have changed.");
    }

    // ── Step 3: Price ──────────────────────────────────────────────────────
    // itemprop="price" content attribute holds a bare number (e.g. "24.97")
    logger.step(sku, "Extracting price");
    const rawPrice = await utils.trySelectors(page, [
      '[itemprop="price"]',
      "span.price-characteristic",
    ]);
    result.price = rawPrice && !rawPrice.startsWith("$") ? `$${rawPrice}` : rawPrice;
    if (result.price) {
      logger.step(sku, `Price found: ${result.price}`);
    } else {
      logger.warn(sku, "Price not found – product may be unavailable or selector changed.");
    }

    // ── Step 4: Description ────────────────────────────────────────────────
    logger.step(sku, "Extracting description");
    const descParagraphs = await page.$$eval(
      '[data-testid="product-description-content"] p',
      (els) => els.map((el) => (el.textContent ?? "").trim()).filter(Boolean).join(" ")
    ).catch(() => "");

    if (descParagraphs) {
      result.description = descParagraphs.replace(/\s+/g, " ").trim();
      logger.step(sku, "Description extracted from product-description-content.");
    } else {
      result.description = await utils.trySelectors(page, [".about-desc"]);
      if (result.description) {
        logger.step(sku, "Description extracted from .about-desc fallback.");
      } else {
        logger.warn(sku, "Description not found.");
      }
    }

    // ── Step 5: Number of reviews ──────────────────────────────────────────
    logger.step(sku, "Extracting number of reviews");
    const rawReviews = await utils.trySelectors(page, [
      '[itemprop="ratingCount"]',
      '[data-testid="item-review-section-link"]',
      "span.review-count",
    ]);
    result.numberOfReviews = rawReviews.replace(/\D/g, "");
    if (result.numberOfReviews) {
      logger.step(sku, `Reviews count: ${result.numberOfReviews}`);
    } else {
      logger.warn(sku, "Review count not found.");
    }

    // ── Step 6: Rating ─────────────────────────────────────────────────────
    logger.step(sku, "Extracting rating");
    result.rating = await utils.trySelectors(page, [
      '[itemprop="ratingValue"]',
      "span.stars-container",
    ]);
    if (!result.rating) {
      // Fall back: parse rating from the "X stars out of N reviews" span
      // document.querySelector( '[data-testid="reviews-and-ratings"] span.ld_FS')?.textContent
      result.rating = await page.$eval(
        '[data-testid="reviews-and-ratings"] span.ld_FS',
        (el) => {
          const m = (el.textContent ?? "").match(/^(\d[\d.]*)\s+stars?/i);
          return m ? m[1] : "";
        }
      ).catch(() => "");
    }
    if (result.rating) {
      logger.step(sku, `Rating found: ${result.rating}`);
    } else {
      logger.warn(sku, "Rating not found.");
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
