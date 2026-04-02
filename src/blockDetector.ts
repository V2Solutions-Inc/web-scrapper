import { Page } from "playwright";

export type Retailer = "amazon" | "walmart";

export async function detectBlock(
  page: Page,
  retailer: Retailer
): Promise<{ blocked: boolean; reason?: string }> {
  const url = page.url();

  if (retailer === "amazon") {
    const pageTitle = (await page.title()).toLowerCase();
    const hasCaptchaForm =
      (await page.locator("form[action='/errors/validateCaptcha']").count()) > 0;
    if (
      url.includes("/errors/validateCaptcha") ||
      pageTitle.includes("robot check") ||
      pageTitle.includes("access denied") ||
      hasCaptchaForm
    ) {
      return { blocked: true, reason: "amazon_captcha" };
    }
  }

  if (retailer === "walmart") {
    if (url.includes("/blocked") || url.includes("robot-or-human")) {
      return { blocked: true, reason: "walmart_blocked_url" };
    }
    const bodyText = await page.locator("body").textContent();
    if (bodyText?.toLowerCase().includes("robot or human")) {
      return { blocked: true, reason: "walmart_challenge" };
    }
  }

  return { blocked: false };
}
