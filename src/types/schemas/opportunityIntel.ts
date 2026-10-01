import { z } from "zod";

export const opportunityIntelDetailSchema = z.object({
  opportunityId: z.string().min(1),
});

export const opportunityIntelReviewSchema = z.object({
  opportunityId: z.string().min(1),
  action: z.enum([
    "graduate",
    "reject",
    "watchlist",
    "resume",
    "sync_keywords",
  ]),
  projectId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});

export const storedSerpLookupSchema = z.object({
  keyword: z.string().min(1),
  locationCode: z.number().int().positive(),
});

export const opportunityIntelScanSchema = z.object({
  maxOpportunities: z.number().int().min(1).max(50).optional(),
});
