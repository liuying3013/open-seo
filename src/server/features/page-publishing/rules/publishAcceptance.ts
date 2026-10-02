import { PUBLISH_TEXT_MATCH_THRESHOLD } from "@/shared/pagePublishing";

/** Why a live check does not count as published, or null when it does. */
export function acceptanceFailure(live: {
  statusCode: number | null;
  noindex: boolean | null;
  textMatch: number | null;
}): string | null {
  if (live.statusCode !== 200) {
    return `Live page returned status ${live.statusCode ?? "unknown"}, expected 200.`;
  }
  if (live.noindex === null) return "Live page noindex state was not reported.";
  if (live.noindex) return "Live page is noindex.";
  if (
    live.textMatch === null ||
    live.textMatch < PUBLISH_TEXT_MATCH_THRESHOLD
  ) {
    return `Live text match ${live.textMatch ?? "unknown"} is below ${PUBLISH_TEXT_MATCH_THRESHOLD}.`;
  }
  return null;
}
