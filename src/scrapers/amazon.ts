import { Page } from "playwright";
import { logger } from "../logger";
import { ProductResult } from "../types";
import { utils } from "../utils";
import { detectBlock } from "../blockDetector";

const AMAZON_BASE_URL = "https://www.amazon.com/dp/";

export interface AmazonScrapeOptions {}

/**
 * Load the page from the live Amazon URL.
 * Returns null on success, or an error string if the page could not be loaded.
 */
async function loadPage(
  page: Page,
  sku: string,
): Promise<string | null> {
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
    return "HTTP 404";
  }

  if (status === 503 || status === 429) {
    logger.warn(sku, `HTTP ${status} – Amazon may be rate-limiting or blocking the request.`);
    // Continue anyway; the page may still have partial content
  }

  // CAPTCHA / bot-wall check
  logger.step(sku, "Checking for CAPTCHA or bot-wall");
  const { blocked, reason } = await detectBlock(page, "amazon");
  if (blocked) {
    logger.error(sku, `Amazon displayed a CAPTCHA / bot-detection page (${reason}). Skipping SKU.`);
    return `BLOCKED: ${reason}`;
  }

  return null;
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
    const loadError = await loadPage(page, sku);
    if (loadError) {
      result.errorMessage = loadError;
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
    const whole = await utils.trySelectors(page, ["span.a-price-whole"]);
    const fraction = await utils.trySelectors(page, ["span.a-price-fraction"]);
    if (whole) {
      result.price = `$${whole.replace(/\.$/, "")}.${fraction || "00"}`;
    } else {
      result.price = await utils.trySelectors(page, [".a-price .a-offscreen"]);
    }

    if (result.price) {
      logger.step(sku, `Price found: ${result.price}`);
    } else {
      logger.warn(sku, "Price not found – product may be unavailable or selector changed.");
    }

    // ── Step 4: Description ────────────────────────────────────────────────
    logger.step(sku, "Extracting description");

    const bullets = await page.$$eval(
      "#feature-bullets ul li:not(.aok-hidden) span.a-list-item",
      (els) => els.map((el) => (el.textContent ?? "").trim()).filter(Boolean).join(" | ")
    ).catch(() => "");

    if (bullets) {
      result.description = bullets;
      logger.step(sku, "Description extracted from feature bullets.");
    } else {
      result.description = await utils.trySelectors(page, ["#productDescription p"]);
      if (result.description) {
        logger.step(sku, "Description extracted from #productDescription fallback.");
      } else {
        logger.warn(sku, "Description not found.");
      }
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

    // ── Step 6: Rating ─────────────────────────────────────────────────────
    logger.step(sku, "Extracting rating");
    result.rating = await utils.trySelectors(page, [
      'span[data-hook="rating-out-of-text"]',
      "#acrPopover .a-icon-alt",
    ]);
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