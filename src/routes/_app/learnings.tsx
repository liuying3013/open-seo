import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/learnings")({
  component: LearningsLayout,
});

function LearningsLayout() {
  return <Outlet />;
}
