import { z } from "zod";

// Plausible `date_range` presets accepted by the Stats API v2.
const PLAUSIBLE_DATE_RANGES = [
  "day",
  "7d",
  "28d",
  "30d",
  "91d",
  "month",
  "6mo",
  "12mo",
  "year",
  "all",
] as const;

const PLAUSIBLE_DIMENSIONS = ["page", "source"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const plausibleStatsInputSchema = z.object({
  projectId: z.string().min(1),
  dateRange: z
    .enum(PLAUSIBLE_DATE_RANGES)
    .optional()
    .describe(
      'Preset window. Defaults to "30d". Ignored with startDate/endDate.',
    ),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  dimension: z
    .enum(PLAUSIBLE_DIMENSIONS)
    .optional()
    .describe(
      'Also return a breakdown: "page" (top pages) or "source" (traffic sources).',
    ),
  limit: z.number().int().min(1).max(500).optional(),
});

export type PlausibleStatsInput = z.infer<typeof plausibleStatsInputSchema>;
