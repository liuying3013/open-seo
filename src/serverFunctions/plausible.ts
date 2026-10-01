import { createServerFn } from "@tanstack/react-start";
import { PlausibleService } from "@/server/features/plausible/services/PlausibleService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { plausibleStatsInputSchema } from "@/types/schemas/plausible";

export const getPlausibleStats = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(plausibleStatsInputSchema)
  .handler(({ data }) => PlausibleService.getStats(data));
