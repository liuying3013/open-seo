import {
  DEFAULT_LOCATION_CODE,
  LOCATION_OPTIONS,
} from "@/shared/keyword-locations";

// Opportunities store target countries as ISO-style short labels ("US", "UK").
// DataForSEO wants numeric location codes; resolve at fetch time.

const ALIASES: Record<string, string> = { GB: "UK" };

export function locationCodesForCountries(countries: string[]): number[] {
  const codes = new Set<number>();
  for (const raw of countries) {
    const country = (ALIASES[raw.toUpperCase()] ?? raw).toUpperCase();
    const option = LOCATION_OPTIONS.find(
      (candidate) => candidate.shortLabel.toUpperCase() === country,
    );
    if (option) codes.add(option.code);
  }
  return codes.size > 0 ? [...codes] : [DEFAULT_LOCATION_CODE];
}
