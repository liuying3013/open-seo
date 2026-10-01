import type { getSiteOverview } from "@/serverFunctions/site-registry";

export type SiteOverviewRow = Awaited<
  ReturnType<typeof getSiteOverview>
>[number];
