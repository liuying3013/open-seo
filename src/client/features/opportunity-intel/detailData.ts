import type { getOpportunityIntelDetail } from "@/serverFunctions/opportunity-intel";

export type DetailData = NonNullable<
  Awaited<ReturnType<typeof getOpportunityIntelDetail>>
>;
