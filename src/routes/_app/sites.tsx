import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { GscMatchModal } from "@/client/features/sites/GscMatchModal";
import { SiteEditModal } from "@/client/features/sites/SiteEditModal";
import {
  CONTENT_FORMAT_LABELS,
  HOSTING_LABELS,
  ROLE_LABELS,
  STATUS_BADGES,
  STATUS_LABELS,
  TEMPLATE_LABELS,
  UNKNOWN_LABEL,
} from "@/client/features/sites/siteLabels";
import type { SiteOverviewRow } from "@/client/features/sites/types";
import { getSiteOverview } from "@/serverFunctions/site-registry";
import {
  SITE_OPS_STATUSES,
  SITE_TEMPLATE_FAMILIES,
} from "@/shared/siteRegistry";

export const Route = createFileRoute("/_app/sites")({
  component: SitesPage,
});

const ALL = "all";
// Filter value for sites whose registry field is empty.
const NONE = "none";

function Unknown() {
  return <span className="text-base-content/40">{UNKNOWN_LABEL}</span>;
}

function Connection({ on, onLabel }: { on: boolean; onLabel: string }) {
  return on ? (
    <span className="badge badge-success badge-sm">{onLabel}</span>
  ) : (
    <span className="badge badge-ghost badge-sm">未接入</span>
  );
}

const PLAUSIBLE_BADGES = {
  not_configured: { className: "badge-ghost", label: "未配置站点" },
  unconnected: { className: "badge-warning", label: "未接入（缺 API key）" },
  connected: { className: "badge-success", label: "已接入" },
} as const;

function PlausibleStatus({
  status,
}: {
  status: SiteOverviewRow["plausibleStatus"];
}) {
  const badge = PLAUSIBLE_BADGES[status];
  return (
    <span className={`badge badge-sm ${badge.className}`}>{badge.label}</span>
  );
}

function marketSummary(site: SiteOverviewRow) {
  return site.markets.map((market) => {
    const label = `${market.languageCode}${market.urlPrefix ? ` ${market.urlPrefix}` : ""}`;
    return market.isPrimary && site.markets.length > 1
      ? `${label} (primary)`
      : label;
  });
}

function SiteRow({
  site,
  onEdit,
}: {
  site: SiteOverviewRow;
  onEdit: () => void;
}) {
  const registry = site.registry;
  const repo = registry?.githubRepo;
  const server = registry?.coolifyServer;
  return (
    <tr>
      <td className="font-medium">
        <Link
          to="/p/$projectId"
          params={{ projectId: site.projectId }}
          className="link link-hover"
        >
          {site.domain ?? site.name}
        </Link>
        {registry?.brand ? (
          <div className="text-xs font-normal text-base-content/60">
            {registry.brand}
          </div>
        ) : null}
      </td>
      <td>{registry?.businessGroup ?? <Unknown />}</td>
      <td>{registry ? ROLE_LABELS[registry.siteRole] : <Unknown />}</td>
      <td>
        {registry ? (
          <span
            className={`badge badge-sm ${STATUS_BADGES[registry.opsStatus]}`}
          >
            {STATUS_LABELS[registry.opsStatus]}
          </span>
        ) : (
          <Unknown />
        )}
      </td>
      <td>
        {registry?.templateFamily ? (
          TEMPLATE_LABELS[registry.templateFamily]
        ) : (
          <Unknown />
        )}
      </td>
      <td>
        {registry && registry.contentFormat !== "unknown" ? (
          CONTENT_FORMAT_LABELS[registry.contentFormat]
        ) : (
          <Unknown />
        )}
      </td>
      <td>
        {repo ? (
          <>
            <div>{repo}</div>
            <div className="text-xs text-base-content/60">
              {registry.productionBranch ?? "分支未知"}
            </div>
          </>
        ) : (
          <Unknown />
        )}
      </td>
      <td>
        {registry && registry.hosting !== "unknown" ? (
          <>
            <div>{HOSTING_LABELS[registry.hosting]}</div>
            {server ? (
              <div className="text-xs text-base-content/60">{server}</div>
            ) : null}
          </>
        ) : (
          <Unknown />
        )}
      </td>
      <td>
        {registry?.autoDeploy == null ? (
          <Unknown />
        ) : registry.autoDeploy ? (
          "是"
        ) : (
          "否"
        )}
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {marketSummary(site).map((label) => (
            <span key={label} className="badge badge-outline badge-sm">
              {label}
            </span>
          ))}
        </div>
      </td>
      <td>
        <Connection on={site.gscConnected} onLabel="已连接" />
      </td>
      <td>
        <PlausibleStatus status={site.plausibleStatus} />
      </td>
      <td className="text-right">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          aria-label={`Edit ${site.domain ?? site.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">{label}</span>
      <select
        className="select select-bordered select-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ALL}>全部</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SitesPage() {
  const sitesQuery = useQuery({
    queryKey: ["sites"],
    queryFn: () => getSiteOverview(),
  });
  const sites = sitesQuery.data ?? [];
  const [group, setGroup] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [template, setTemplate] = React.useState(ALL);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [matchingGsc, setMatchingGsc] = React.useState(false);

  const groups = [
    ...new Set(
      sites.flatMap((site) =>
        site.registry?.businessGroup ? [site.registry.businessGroup] : [],
      ),
    ),
  ];
  const filtered = sites.filter((site) => {
    const registry = site.registry;
    if (group !== ALL && (registry?.businessGroup ?? NONE) !== group) {
      return false;
    }
    if (status !== ALL && (registry?.opsStatus ?? NONE) !== status) {
      return false;
    }
    return template === ALL || (registry?.templateFamily ?? NONE) === template;
  });
  const editing = sites.find((site) => site.projectId === editingId);

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">站点总览</h1>
          <p className="mt-1 text-sm text-base-content/60">
            Every project with its repository, hosting, template, markets and
            data connections. Fields that are not connected or not known show as{" "}
            {UNKNOWN_LABEL}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <FilterSelect
            label="业务组"
            value={group}
            onChange={setGroup}
            options={[
              ...groups.map((value) => ({ value, label: value })),
              { value: NONE, label: UNKNOWN_LABEL },
            ]}
          />
          <FilterSelect
            label="状态"
            value={status}
            onChange={setStatus}
            options={[
              ...SITE_OPS_STATUSES.map((value) => ({
                value,
                label: STATUS_LABELS[value],
              })),
              { value: NONE, label: UNKNOWN_LABEL },
            ]}
          />
          <FilterSelect
            label="模板"
            value={template}
            onChange={setTemplate}
            options={[
              ...SITE_TEMPLATE_FAMILIES.map((value) => ({
                value,
                label: TEMPLATE_LABELS[value],
              })),
              { value: NONE, label: UNKNOWN_LABEL },
            ]}
          />
          <button
            type="button"
            className="btn btn-outline btn-sm ml-auto"
            onClick={() => setMatchingGsc(true)}
          >
            按域名匹配 GSC
          </button>
          <span className="text-sm text-base-content/60">
            {filtered.length} / {sites.length}
          </span>
        </div>

        {sitesQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr className="text-xs text-base-content/60">
                  <th>域名</th>
                  <th>业务组</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>模板</th>
                  <th>内容形式</th>
                  <th>仓库 / 分支</th>
                  <th>托管 / 服务器</th>
                  <th>自动部署</th>
                  <th>市场</th>
                  <th>GSC</th>
                  <th>Plausible</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((site) => (
                  <SiteRow
                    key={site.projectId}
                    site={site}
                    onEdit={() => setEditingId(site.projectId)}
                  />
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={13}
                      className="text-center text-base-content/60"
                    >
                      No sites match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {matchingGsc ? (
        <GscMatchModal onClose={() => setMatchingGsc(false)} />
      ) : null}
      {editing ? (
        <SiteEditModal
          // Remount per site so the draft state starts from the stored row.
          key={editing.projectId}
          site={editing}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}
