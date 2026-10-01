import { createFileRoute } from "@tanstack/react-router";
import { PagePlansPage } from "@/client/features/page-plans/PagePlansPage";

export const Route = createFileRoute("/_project/p/$projectId/page-plans")({
  component: PagePlansRoute,
});

function PagePlansRoute() {
  const { projectId } = Route.useParams();
  return <PagePlansPage key={projectId} projectId={projectId} />;
}
