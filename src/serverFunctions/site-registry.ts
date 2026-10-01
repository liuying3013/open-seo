import { createServerFn } from "@tanstack/react-start";
import { SiteRegistryService } from "@/server/features/site-registry/services/SiteRegistryService";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";
import { updateSiteRowSchema } from "@/types/schemas/siteRegistry";

export const getSiteOverview = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) =>
    SiteRegistryService.listSites(context.organizationId),
  );

export const updateSiteRow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateSiteRowSchema)
  .handler(({ data, context }) =>
    SiteRegistryService.updateSiteRow({
      organizationId: context.organizationId,
      userId: context.userId,
      input: data,
    }),
  );
