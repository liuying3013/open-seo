import { Link } from "@tanstack/react-router";

export function PublishingCountLink({
  projectId,
  count,
  tab,
  badge,
}: {
  projectId: string;
  count: number | undefined;
  tab: "review" | "ledger";
  badge: string;
}) {
  if (!count) return <span className="text-base-content/40">0</span>;
  return (
    <Link
      to="/p/$projectId/publishing"
      params={{ projectId }}
      search={{ tab }}
      className={`badge badge-sm ${badge}`}
    >
      {count}
    </Link>
  );
}
