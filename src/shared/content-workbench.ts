import { sort } from "remeda";

// Bind a displayed SERP quote to exactly the keyword/market/device/depth inputs.
export function serpRequestKey(
  representatives: Array<{
    keyword: string;
    locationCode: number;
    languageCode: string;
  }>,
  depth: number,
) {
  return JSON.stringify({
    device: "desktop",
    depth,
    keywords: sort(
      representatives.map((k) => [k.keyword, k.locationCode, k.languageCode]),
      (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
  });
}
