import * as fs from "fs";
import { Page } from "playwright-core";
import { SKUEntry, SKUFile } from "./types";

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
    const raw = fs.readFileSync(skuFile, "utf-8");
    const data: SKUFile = JSON.parse(raw);
    if (!Array.isArray(data.skus)) {
      throw new Error(`"skus" key is missing or not an array in ${skuFile}`);
    }
    return data.skus;
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