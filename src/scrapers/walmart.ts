import { Page } from "playwright";
import { logger } from "../logger";
import { ProductResult } from "../types";
import { detectBlock } from "../blockDetector";

const WALMART_BASE_URL = "https://www.walmart.com/ip/";

export interface WalmartScrapeOptions {
  cookies?: string;
}

// ── Type helpers ───────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s === "null" || s === "undefined" ? "" : s;
}

/** Strip HTML tags from a string (descriptions often contain inline HTML) */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── __NEXT_DATA__ parser ───────────────────────────────────────────────────────

function parseNextData(json: unknown): {
  title: string;
  price: string;
  description: string;
  numberOfReviews: string;
} {
  // Root path: props.pageProps.initialData.data
  const data = dig(json, "props", "pageProps", "initialData", "data");
  const product = dig(data, "product");
  const idml = dig(data, "idml");

  // ── Title ──────────────────────────────────────────────────────────────────
  const title = str(dig(product, "name"));

  // ── Price ──────────────────────────────────────────────────────────────────
  const price =
    str(dig(product, "priceInfo", "currentPrice", "priceString")) ||
    str(dig(product, "priceInfo", "currentPrice", "price")) ||
    str(dig(product, "priceInfo", "wasPrice", "priceString")) ||
    "";

  // ── Description ────────────────────────────────────────────────────────────
  // shortDescription is a brief HTML snippet; longDescription (in idml) is richer
  const shortDesc = str(dig(product, "shortDescription"));
  const longDesc =
    str(dig(idml, "longDescription")) ||
    str(dig(product, "longDescription")) ||
    "";

  const rawDesc = longDesc || shortDesc;
  const description = rawDesc ? stripHtml(rawDesc) : "";

  // ── Reviews ────────────────────────────────────────────────────────────────
  const numberOfReviews =
    str(dig(product, "numberOfReviews")) ||
    str(dig(product, "rating", "numberOfReviews")) ||
    str(dig(product, "reviews", "totalReviewCount")) ||
    "";

  return { title, price, description, numberOfReviews };
}

// ── Main scraper ───────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;


export async function scrapeWalmart(
  page: Page,
  sku: string,
  _opts: WalmartScrapeOptions = {}
): Promise<ProductResult> {
  const result: ProductResult = {
    type: "Walmart",
    sku,
    title: "",
    price: "",
    description: "",
    numberOfReviews: "",
    status: "error",
  };

  try {
    // ── Step 1: Navigate (follow the 301 automatically) ────────────────────
    // Playwright follows redirects by default, so /ip/<ID> resolves to the
    // full slug URL transparently.
    const shortUrl = `${WALMART_BASE_URL}${sku}`;
    logger.step(sku, `Navigating to ${shortUrl}`);

    const response = await page.goto(shortUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const finalUrl = page.url();
    const status = response?.status() ?? 0;
    logger.step(sku, `Resolved to: ${finalUrl}`);
    logger.step(sku, `HTTP status: ${status}`);

    // 🔍 Block detection
      const blockCheck = await detectBlock(page);

    if (blockCheck.blocked) {
      logger.error(sku, `Walmart bot-wall detected (${blockCheck.reason}). Consider using a proxy.`);
      result.errorMessage = "Blocked by Walmart bot-wall";
      return result;
    }

    if (status === 404) {
      logger.error(sku, "Product page returned 404 – SKU may be invalid or delisted.");
      result.errorMessage = "HTTP 404 – product not found";
      return result;
    }

    // ── Step 2: Extract __NEXT_DATA__ from the page HTML ───────────────────
    logger.step(sku, "Looking for __NEXT_DATA__ script tag");

    const nextDataJson = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      return el ? el.textContent : null;
    });

    if (!nextDataJson) {
      logger.error(sku, "__NEXT_DATA__ script tag not found. Page may not have loaded correctly.");
      result.errorMessage = "__NEXT_DATA__ not found";
      return result;
    }

    logger.step(sku, `__NEXT_DATA__ found (${(nextDataJson.length / 1024).toFixed(1)} KB)`);

    // ── Step 3: Parse JSON ─────────────────────────────────────────────────
    logger.step(sku, "Parsing __NEXT_DATA__ JSON");
    let json: unknown;
    try {
      json = JSON.parse(nextDataJson);
    } catch (err) {
      logger.error(sku, "Failed to parse __NEXT_DATA__ as JSON", err);
      result.errorMessage = "Invalid __NEXT_DATA__ JSON";
      return result;
    }

    // ── Step 4: Extract fields ─────────────────────────────────────────────
    logger.step(sku, "Extracting fields from __NEXT_DATA__");
    const { title, price, description, numberOfReviews } = parseNextData(json);

    result.title = title;
    result.price = price;
    result.description = description;
    result.numberOfReviews = numberOfReviews;

    if (result.title) {
      logger.step(sku, `Title: "${result.title.substring(0, 60)}..."`);
    } else {
      logger.warn(sku, "Title not found in __NEXT_DATA__.");
    }

    if (result.price) {
      logger.step(sku, `Price: ${result.price}`);
    } else {
      logger.warn(sku, "Price not found in __NEXT_DATA__.");
    }

    if (result.description) {
      logger.step(sku, "Description extracted.");
    } else {
      logger.warn(sku, "Description not found.");
    }

    if (result.numberOfReviews) {
      logger.step(sku, `Reviews: ${result.numberOfReviews}`);
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
      logger.error(sku, "No data could be extracted from __NEXT_DATA__.");
      result.errorMessage = "No data extracted";
    }
  } catch (err) {
    logger.error(sku, "Unexpected error during scraping", err);
    result.errorMessage = err instanceof Error ? err.message : String(err);
  }

  return result;
}