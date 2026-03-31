import { Page } from "playwright";

export async function detectBlock(page: Page): Promise<{
  blocked: boolean;
  reason?: string;
}> {
  const url = page.url();

  // 1. URL-based detection
  if (url.includes("/blocked")) {
    return { blocked: true, reason: "blocked_url" };
  }

  return { blocked: false };
}