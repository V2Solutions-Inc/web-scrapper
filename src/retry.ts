import { ProductResult } from "./types";
import { logger } from "./logger";
import { utils } from "./utils";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (result: ProductResult) => boolean;
  onBeforeRetry?: (attempt: number) => Promise<void>;
}

function defaultIsRetryable(result: ProductResult): boolean {
  const msg = result.errorMessage ?? "";
  if (msg.includes("HTTP 404"))  return false; // product doesn't exist
  if (msg.includes("CAPTCHA"))   return false; // needs human intervention
  return result.status === "error";
}

export async function withRetry(
  fn: () => Promise<ProductResult>,
  opts: RetryOptions = {}
): Promise<ProductResult> {
  const {
    maxAttempts = 3,
    baseDelayMs = 3_000,
    isRetryable = defaultIsRetryable,
    onBeforeRetry,
  } = opts;

  let lastResult: ProductResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();

      if (result.status === "success" || !isRetryable(result)) {
        return result;
      }

      lastResult = result;
    } catch (err) {
      lastResult = {
        ...(lastResult ?? { type: "", sku: "", title: "", price: "", description: "", numberOfReviews: "" }),
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    if (attempt < maxAttempts) {
      const delay = baseDelayMs * attempt; // 3s, 6s, 9s...
      logger.warn(lastResult!.sku, `Attempt ${attempt}/${maxAttempts} failed – retrying in ${delay}ms...`);
      await onBeforeRetry?.(attempt);
      await utils.randomDelay(delay);
    }
  }

  logger.error(lastResult!.sku, `All ${maxAttempts} attempts failed.`);
  return lastResult!;
}
