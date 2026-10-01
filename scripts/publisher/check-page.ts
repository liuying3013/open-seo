/**
 * Pre-submission self-check: fetch a page (for example a local build of a
 * task branch) and score it against a content draft the way live verification
 * will, listing the draft lines the page does not show in full.
 *
 *   pnpm exec tsx scripts/publisher/check-page.ts --url <url> --draft <file.json>
 *
 * The file holds the draft, or a submit_content_version input with the draft
 * under `draft`.
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import * as cheerio from "cheerio";
import { z } from "zod";
import { parseArgs } from "../cli-utils";
import { inspectPage, MATCH_TARGET, visibleText } from "./live-check";
import { draftSchema } from "./openseo-client";
import { blockCoverage } from "./text-match";

const draftFileSchema = z.union([
  z.object({ draft: draftSchema }).transform((input) => input.draft),
  draftSchema,
]);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.draft) {
    console.error("Usage: check-page.ts --url <url> --draft <file.json>");
    return 2;
  }
  const draft = draftFileSchema.parse(
    JSON.parse(readFileSync(args.draft, "utf8")),
  );
  const response = await fetch(args.url, { redirect: "follow" });
  const html = await response.text();
  const page = inspectPage(html, response.headers, draft);
  console.log(
    `status ${response.status}, noindex ${page.noindex}, canonical ${page.canonical ?? "none"}, text match ${page.textMatch} (target ${MATCH_TARGET})`,
  );
  const text = visibleText(cheerio.load(html));
  for (const { block, total, found } of blockCoverage(draft, text)) {
    if (found < total) {
      console.log(`  ${found}/${total} found: ${block.slice(0, 120)}`);
    }
  }
  const passed =
    response.status === 200 && !page.noindex && page.textMatch >= MATCH_TARGET;
  return passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(2);
  },
);
