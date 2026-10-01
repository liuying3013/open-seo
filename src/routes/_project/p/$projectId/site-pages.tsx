import { createFileRoute } from "@tanstack/react-router";
import { SitePagesPage } from "@/client/features/page-plans/SitePagesPage";

export const Route = createFileRoute("/_project/p/$projectId/site-pages")({
  component: SitePagesRoute,
});

function SitePagesRoute() {
  const { projectId } = Route.useParams();
  return <SitePagesPage key={projectId} projectId={projectId} />;
}
