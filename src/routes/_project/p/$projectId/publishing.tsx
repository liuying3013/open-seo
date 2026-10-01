import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PublishingPage } from "@/client/features/page-publishing/PublishingPage";

const publishingSearchSchema = z.object({
  tab: z.enum(["review", "ledger"]).optional(),
  asset: z.string().optional(),
});

export const Route = createFileRoute("/_project/p/$projectId/publishing")({
  validateSearch: publishingSearchSchema,
  component: PublishingRoute,
});

function PublishingRoute() {
  const { projectId } = Route.useParams();
  const { tab, asset } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PublishingPage
      projectId={projectId}
      tab={tab ?? "review"}
      assetId={asset}
      onChange={(next) => void navigate({ search: next })}
    />
  );
}
