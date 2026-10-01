import { createFileRoute } from "@tanstack/react-router";
import { LearningDocPage } from "@/client/features/learnings/LearningsPage";

export const Route = createFileRoute("/_app/learnings/$slug")({
  component: LearningDocRoute,
});

function LearningDocRoute() {
  const { slug } = Route.useParams();
  return <LearningDocPage slug={slug} />;
}
