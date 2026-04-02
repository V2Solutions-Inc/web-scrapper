import * as fs from "fs";
import { Page } from "playwright";
import { SKUEntry, SKUFile, ProductResult } from "./types";
import { logger } from "./logger";

export const utils = {
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  randomDelay(base: number): Promise<void> {
    const jitter = Math.floor(Math.random() * 1_000);
    return this.delay(base + jitter);
  },

  trySelectors: async (page: Page, selectors: string[]): Promise<string> => {
    for (const selector of selectors) {
      try {
        const el = page.locator(selector).first();
        const count = await el.count();
        if (count > 0) {
          const text = (await el.textContent())?.trim() ?? "";
          if (text.length > 0) return text;
        }
      } catch {
        // continue to next selector
      }
    }
    return "";
  },

  loadSku: (skuFile: string): SKUEntry[] => {
    if (!fs.existsSync(skuFile)) {
      throw new Error(`SKU file not found: ${skuFile}\nCreate a skus.json file at the project root. See README for the expected format.`);
    }
    const raw = fs.readFileSync(skuFile, "utf-8");
    const data: SKUFile = JSON.parse(raw);
    if (!Array.isArray(data.skus)) {
      throw new Error(`"skus" key is missing or not an array in ${skuFile}`);
    }
    return data.skus;
  },

  resolveStatus(result: ProductResult): void {
    const hasAny = result.title || result.price || result.description || result.numberOfReviews;
    result.status = hasAny
      ? result.title && result.price
        ? "success"
        : "partial"
      : "error";

    if (result.status === "success") {
      logger.success(result.sku, "All fields extracted successfully.");
    } else if (result.status === "partial") {
      logger.warn(result.sku, "Some fields could not be extracted – partial result saved.");
    } else {
      logger.error(result.sku, "No data could be extracted.");
      result.errorMessage = "No data extracted";
    }
  },

  filterSupported(skus: SKUEntry[]): { supported: SKUEntry[]; skipped: SKUEntry[] } {
    const SUPPORTED_TYPES = new Set(["amazon", "walmart"]);
    const supported: SKUEntry[] = [];
    const skipped: SKUEntry[] = [];
    for (const entry of skus) {
      if (SUPPORTED_TYPES.has(entry.Type.toLowerCase())) {
        supported.push(entry);
      } else {
        skipped.push(entry);
      }
    }
    return { supported, skipped };
  }
};