export interface SKUEntry {
  Type: string;
  SKU: string;
}

export interface SKUFile {
  skus: SKUEntry[];
}

export interface ProductResult {
  type: string;
  sku: string;
  title: string;
  price: string;
  description: string;
  numberOfReviews: string;
  status: "success" | "partial" | "error";
  errorMessage?: string;
}
