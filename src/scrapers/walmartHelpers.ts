// ── Type helpers ───────────────────────────────────────────────────────────────

export type JsonObject = { [key: string]: unknown };

export function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s === "null" || s === "undefined" ? "" : s;
}

/** Strip HTML tags from a string (descriptions often contain inline HTML) */
export function stripHtml(html: string): string {
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

export function parseNextData(json: unknown): {
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
