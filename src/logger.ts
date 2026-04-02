import * as fs from "fs";
import * as path from "path";

const LOG_FILE = path.resolve("scraper.log");
const ERROR_FILE = path.resolve("errors.log");

function timestamp(): string {
  return new Date().toISOString();
}

function writeToFile(filePath: string, message: string): void {
  fs.appendFileSync(filePath, message + "\n", "utf-8");
}

export const logger = {
  info(message: string): void {
    const line = `[${timestamp()}] [INFO]  ${message}`;
    console.log(line);
    writeToFile(LOG_FILE, line);
  },

  step(sku: string, step: string): void {
    const line = `[${timestamp()}] [STEP]  [SKU: ${sku}] ${step}`;
    console.log(line);
    writeToFile(LOG_FILE, line);
  },

  success(sku: string, message: string): void {
    const line = `[${timestamp()}] [OK]    [SKU: ${sku}] ${message}`;
    console.log(`\x1b[32m${line}\x1b[0m`);  // Green text
    writeToFile(LOG_FILE, line);
  },

  warn(sku: string, message: string): void {
    const line = `[${timestamp()}] [WARN]  [SKU: ${sku}] ${message}`;
    console.warn(`\x1b[33m${line}\x1b[0m`); // Yellow text
    writeToFile(LOG_FILE, line);
    writeToFile(ERROR_FILE, line);
  },

  error(sku: string, message: string, err?: unknown): void {
    const detail =
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err ?? "");
    const line = `[${timestamp()}] [ERROR] [SKU: ${sku}] ${message}${detail ? " | " + detail : ""}`;
    console.error(`\x1b[31m${line}\x1b[0m`);  // Red text
    writeToFile(LOG_FILE, line);
    writeToFile(ERROR_FILE, line);
  },

  separator(): void {
    const line = "-".repeat(80);
    console.log(line);
    writeToFile(LOG_FILE, line);
  },
};
