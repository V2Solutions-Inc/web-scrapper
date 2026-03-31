import { BrowserContext } from "playwright";
import { logger } from "../logger";

/**
 * How many Walmart requests to make before refreshing the session cookies.
 * PerimeterX tokens typically last 15–30 min, so we refresh every N SKUs
 * to stay well within that window.
 */
export const WALMART_COOKIE_REFRESH_EVERY = 10;

/**
 * Visit the Walmart homepage in a real browser page so PerimeterX can run
 * its JS challenges and issue fresh session tokens. Then extract all
 * walmart.com cookies and return them as a flat cookie header string.
 *
 * This lets the subsequent plain fetch() calls carry valid tokens without
 * the user having to export cookies manually.
 */
export async function refreshWalmartCookies(context: BrowserContext): Promise<string> {
  logger.info("Refreshing Walmart session cookies via browser warm-up...");

  const page = await context.newPage();

  try {
    // ── Step 1: Hit the homepage so PerimeterX runs its JS fingerprinting ──
    logger.step("cookies", "Navigating to walmart.com homepage");
    await page.goto("https://www.walmart.com", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // ── Step 2: Brief human-like pause ──────────────────────────────────────
    // PerimeterX needs a moment to evaluate the session and set its tokens.
    logger.step("cookies", "Waiting for PerimeterX to issue session tokens...");
    await page.waitForTimeout(3_000);

    // ── Step 3: Extract all walmart.com cookies ─────────────────────────────
    const cookies = await context.cookies("https://www.walmart.com");

    if (cookies.length === 0) {
      logger.warn("cookies", "No cookies returned from browser — session may not have been established.");
      return "";
    }

    // Check that the critical PerimeterX cookies are present
    const cookieNames = cookies.map((c) => c.name);
    const hasPx = cookieNames.some((n) => n.startsWith("_px"));
    if (!hasPx) {
      logger.warn("cookies", "PerimeterX cookies (_px*) not found — Walmart may still challenge requests.");
    } else {
      const pxCookies = cookieNames.filter((n) => n.startsWith("_px"));
      logger.step("cookies", `PerimeterX cookies obtained: ${pxCookies.join(", ")}`);
    }

    // ── Step 4: Format as a flat cookie header string ───────────────────────
    const cookieString = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    logger.info(`Session cookies refreshed — ${cookies.length} cookies (${(cookieString.length / 1024).toFixed(1)} KB)`);
    return cookieString;

  } catch (err) {
    logger.error("cookies", "Failed to refresh Walmart cookies", err);
    return "";
  } finally {
    await page.close();
  }
}