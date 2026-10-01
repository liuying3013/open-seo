import * as api from "@/serverFunctions/page-plans";

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export const listSitePages = api.listSitePages;
export const getPagePlan = api.getPagePlan;
export const listPagePlans = api.listPagePlans;

export async function setPagePlanItemsIncluded(
  input: Parameters<typeof api.setPagePlanItemsIncluded>[0],
) {
  return unwrap(await api.setPagePlanItemsIncluded(input));
}

export async function approvePagePlan(
  input: Parameters<typeof api.approvePagePlan>[0],
) {
  return unwrap(await api.approvePagePlan(input));
}
