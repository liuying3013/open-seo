// Screenshots of the live page at desktop and mobile widths, as PNG within the
// server's size limit. Uses the repo's Playwright dependency; set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a browser outside Playwright's cache.

import { chromium } from "@playwright/test";

const MAX_BYTES = 3 * 1024 * 1024;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export type Screenshots = {
  desktop?: string;
  mobile?: string;
  errors: string[];
};

/** Base64 PNGs. Full page when it fits, otherwise the first viewport only. */
export async function captureScreenshots(url: string): Promise<Screenshots> {
  const result: Screenshots = { errors: [] };
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch({ executablePath });
  try {
    for (const [kind, viewport] of Object.entries(VIEWPORTS) as Array<
      [keyof typeof VIEWPORTS, (typeof VIEWPORTS)[keyof typeof VIEWPORTS]]
    >) {
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
        let png = await page.screenshot({ type: "png", fullPage: true });
        if (png.length > MAX_BYTES) {
          png = await page.screenshot({ type: "png", fullPage: false });
        }
        if (png.length > MAX_BYTES) {
          result.errors.push(
            `${kind} screenshot is ${png.length} bytes, skipped.`,
          );
        } else {
          result[kind] = png.toString("base64");
        }
      } catch (error) {
        result.errors.push(
          `${kind} screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return result;
}
