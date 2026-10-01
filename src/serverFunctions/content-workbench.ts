import { workbenchResult } from "@/server/features/content-factory/services/workbenchResult";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "./middleware";
import {
  contentOpsProjectSchema,
  contentOpsClusterSchema,
} from "@/types/schemas/contentOps";
import {
  workbenchTopicSchema,
  workbenchOfferSchema,
  workbenchClusterActionSchema,
  workbenchAssetActionSchema,
  workbenchSaveDraftSchema,
} from "@/types/schemas/contentWorkbench";
import { ContentWorkbenchService } from "@/server/features/content-factory/services/ContentWorkbenchService";
import { OffersService } from "@/server/features/content-ops/services/OffersService";
import { DraftService } from "@/server/features/content-factory/services/DraftService";

export const getContentWorkbench = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(contentOpsProjectSchema)
  .handler(({ context }) =>
    workbenchResult(() => ContentWorkbenchService.overview(context.projectId)),
  );
export const getWorkbenchTopic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(contentOpsClusterSchema)
  .handler(({ data, context }) =>
    workbenchResult(() =>
      ContentWorkbenchService.detail(context.projectId, data.clusterId),
    ),
  );
export const createWorkbenchTopic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(workbenchTopicSchema)
  .handler(({ data, context }) =>
    workbenchResult(() =>
      ContentWorkbenchService.createTopic({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );
export const saveWorkbenchOffer = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(workbenchOfferSchema)
  .handler(({ data, context }) =>
    workbenchResult(() => OffersService.save(context.projectId, [data])),
  );
export const getWorkbenchSerpQuote = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(contentOpsClusterSchema)
  .handler(({ data, context }) =>
    workbenchResult(() =>
      ContentWorkbenchService.serpQuote(context.projectId, data.clusterId),
    ),
  );
export const runWorkbenchClusterAction = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(workbenchClusterActionSchema)
  .handler(({ data, context }) =>
    workbenchResult(() =>
      ContentWorkbenchService.runClusterAction(
        { ...data, projectId: context.projectId },
        context,
      ),
    ),
  );
export const runWorkbenchAssetAction = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(workbenchAssetActionSchema)
  .handler(({ data, context }) =>
    workbenchResult(() =>
      ContentWorkbenchService.runAssetAction({
        ...data,
        projectId: context.projectId,
      }),
    ),
  );
export const saveWorkbenchDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(workbenchSaveDraftSchema)
  .handler(({ data, context }) =>
    workbenchResult(() =>
      DraftService.saveEdited({ ...data, projectId: context.projectId }),
    ),
  );
