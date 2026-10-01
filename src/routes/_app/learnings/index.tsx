import { createFileRoute } from "@tanstack/react-router";
import { LearningsIndexPage } from "@/client/features/learnings/LearningsPage";

export const Route = createFileRoute("/_app/learnings/")({
  component: LearningsIndexPage,
});
