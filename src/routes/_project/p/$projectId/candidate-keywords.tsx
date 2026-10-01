import { createFileRoute } from "@tanstack/react-router";
import { CandidateKeywordsPage } from "@/client/features/candidate-keywords/CandidateKeywordsPage";

export const Route = createFileRoute(
  "/_project/p/$projectId/candidate-keywords",
)({
  component: CandidateKeywordsRoute,
});

function CandidateKeywordsRoute() {
  const { projectId } = Route.useParams();
  return <CandidateKeywordsPage projectId={projectId} />;
}
