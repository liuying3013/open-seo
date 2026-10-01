import { createServerFn } from "@tanstack/react-start";
import { pagePlanResult } from "@/server/features/page-plans/pagePlanErrors";
import { PagePlansService } from "@/server/features/page-plans/services/PagePlansService";
import { SitePagesService } from "@/server/features/page-plans/services/SitePagesService";
import {
  listSitePagesFilterSchema,
  pagePlanApproveInputSchema,
  pagePlanIncludeInputSchema,
  pagePlanPeriodInputSchema,
} from "@/types/schemas/pagePlans";
import { z } from "zod";
import { requireProjectContext } from "./middleware";

export const listSitePages = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSitePagesFilterSchema.extend({ projectId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { projectId: _projectId, ...filter } = data;
    const [{ rows, total }, languages] = await Promise.all([
      SitePagesService.list(context.projectId, filter),
      SitePagesService.listLanguages(context.projectId),
    ]);
    return { rows, total, languages };
  });

export const listPagePlans = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(({ context }) => PagePlansService.listPlans(context.projectId));

export const getPagePlan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pagePlanPeriodInputSchema)
  .handler(({ data, context }) =>
    PagePlansService.getPlan(context.projectId, data.period),
  );

export const setPagePlanItemsIncluded = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pagePlanIncludeInputSchema)
  .handler(({ data, context }) =>
    pagePlanResult(() =>
      PagePlansService.setIncluded(context.projectId, data.planId, data.items),
    ),
  );

// Approval comes from the signed-in web session only (the session user is
// recorded as the approver); MCP/API keys have no equivalent.
export const approvePagePlan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pagePlanApproveInputSchema)
  .handler(({ data, context }) =>
    pagePlanResult(() =>
      PagePlansService.approve({
        projectId: context.projectId,
        planId: data.planId,
        userId: context.userId,
      }),
    ),
  );
