import { Page } from "playwright";
import { logger } from "../logger";
import { ProductResult } from "../types";

const WALMART_BASE_URL = "https://www.walmart.com/ip/";

export interface WalmartScrapeOptions {
  /**
   * Optional raw cookie string from a real Chrome session.
   * Carry PerimeterX tokens that reduce blocking risk significantly.
   * Can also be set via the WALMART_COOKIES environment variable.
   *
   * How to get it:
   *   1. Open Chrome and browse to walmart.com
   *   2. DevTools → Network → click any walmart.com request
   *   3. Right-click → Copy → Copy as cURL
   *   4. Extract the value after -b '...'
   *   5. export WALMART_COOKIES='<paste here>'
   *
   * Without cookies the scraper still tries — it may succeed on
   * residential IPs with a clean reputation.
   */
  cookies?: string;
}

import { parseNextData } from "./walmartHelpers";

// ── HTTP fetch (no browser) ────────────────────────────────────────────────────

async function fetchPage(sku: string, cookies: string): Promise<string> {
  const url = `${WALMART_BASE_URL}${sku}`;

  // Build headers — only include Cookie when we actually have one.
  // Sending an empty Cookie header can itself be a bot signal.
  const headers: Record<string, string> = {
    "accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language":           "en-US,en;q=0.9,hi;q=0.8,kn;q=0.7,ml;q=0.6",
    "cache-control":             "no-cache",
    "pragma":                    "no-cache",
    "priority":                  "u=0, i",
    "sec-ch-ua":                 '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    "sec-ch-ua-mobile":          "?0",
    "sec-ch-ua-platform":        '"macOS"',
    "sec-fetch-dest":            "document",
    "sec-fetch-mode":            "navigate",
    "sec-fetch-site":            "none",
    "sec-fetch-user":            "?1",
    "upgrade-insecure-requests": "1",
    "user-agent":                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  };

  if (cookies) {
    headers["cookie"] = cookies;
  }

  const response = await fetch(url, { method: "GET", redirect: "follow", headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

// ── __NEXT_DATA__ extractor ────────────────────────────────────────────────────

function extractNextData(html: string): unknown | null {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ── Main scraper ───────────────────────────────────────────────────────────────

export async function scrapeWalmart(
  _page: Page,
  sku: string,
  opts: WalmartScrapeOptions
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
    // Cookies are optional. When present they carry PerimeterX tokens that
    // make Walmart treat the request as a trusted browser session.
    // Without them the request still goes out — it may work on clean IPs.
    const cookies = opts.cookies ?? "";

    if (cookies) {
      logger.step(sku, "Walmart cookies present — sending with session tokens");
    } else {
      logger.warn(sku, "No Walmart cookies set — sending headers only. " +
        "Set WALMART_COOKIES env var for more reliable results.");
    }

    // ── Step 1: Fetch page HTML ──────────────────────────────────────────────
    logger.step(sku, `Fetching ${WALMART_BASE_URL}${sku} via HTTP (no browser)`);
    let html: string;
    try {
      html = await fetchPage(sku, cookies);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403") || msg.includes("429")) {
        logger.error(sku,
          `Request blocked (${msg}). ` +
          (cookies
            ? "Cookies may have expired."
            : "")
        );
      } else {
        logger.error(sku, `Failed to fetch page: ${msg}`);
      }
      result.errorMessage = msg;
      return result;
    }

    logger.step(sku, `Page fetched (${(html.length / 1024).toFixed(1)} KB)`);

    // Detect PerimeterX challenge page — these are always <30 KB and contain
    // a recognizable title or bot-wall path. Real product pages are 400–600 KB.
    const isChallengePage =
      html.includes("Robot or human?") ||
      html.includes("robot or human") ||
      html.includes("/blocked");

    if (isChallengePage) {
      logger.error(sku,
        "Walmart PerimeterX challenge page received (page is too small / contains bot-wall markers). "
      );
      result.errorMessage = "PerimeterX challenge — cookies expired or IP blocked";
      return result;
    }

    // ── Step 2: Extract __NEXT_DATA__ ────────────────────────────────────────
    logger.step(sku, "Extracting __NEXT_DATA__ JSON");
    const json = extractNextData(html);

    if (!json) {
      logger.error(sku, "__NEXT_DATA__ not found — page may not have loaded correctly.");
      result.errorMessage = "__NEXT_DATA__ not found";
      return result;
    }

    logger.step(sku, "__NEXT_DATA__ found and parsed");

    // ── Step 3: Extract fields ───────────────────────────────────────────────
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

    // ── Done ────────────────────────────────────────────────────────────────
    const hasAny = result.title || result.price || result.description || result.numberOfReviews;
    result.status = hasAny
      ? result.title && result.price ? "success" : "partial"
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