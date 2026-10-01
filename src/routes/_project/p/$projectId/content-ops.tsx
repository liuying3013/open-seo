import { createFileRoute } from "@tanstack/react-router";
import { ContentOpsPage } from "@/client/features/content-ops/ContentOpsPage";

export const Route = createFileRoute("/_project/p/$projectId/content-ops")({
  component: ContentOpsRoute,
});

function ContentOpsRoute() {
  const { projectId } = Route.useParams();
  return <ContentOpsPage key={projectId} projectId={projectId} />;
}
