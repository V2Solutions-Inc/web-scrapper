import { createObjectCsvWriter } from "csv-writer";
import * as path from "path";
import { ProductResult } from "./types";

const OUTPUT_FILE = path.resolve("output.csv");

const CSV_HEADER = [
  { id: "type",            title: "Type" },
  { id: "sku",             title: "SKU" },
  { id: "title",           title: "Title" },
  { id: "price",           title: "Price" },
  { id: "description",     title: "Description" },
  { id: "numberOfReviews", title: "Number of Reviews" },
  { id: "status",          title: "Status" },
  { id: "errorMessage",    title: "Error" },
];

let appendWriter: ReturnType<typeof createObjectCsvWriter>;

export async function initCsv(): Promise<void> {
  await createObjectCsvWriter({ path: OUTPUT_FILE, header: CSV_HEADER })
    .writeRecords([]);

  appendWriter = createObjectCsvWriter({
    path: OUTPUT_FILE,
    header: CSV_HEADER,
    append: true,
  });
}

export async function appendToCsv(result: ProductResult): Promise<void> {
  await appendWriter.writeRecords([result]);
}

export function getCsvPath(): string {
  return OUTPUT_FILE;
}
