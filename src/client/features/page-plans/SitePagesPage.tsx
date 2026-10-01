import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { PAGE_ROLES } from "@/shared/pagePlans";
import { listSitePages } from "./pagePlansApi";
import { pageRoleLabels } from "./pageLabels";

const PAGE_SIZE = 100;
const STATUS_CODE_OPTIONS = [200, 301, 302, 404, 410, 500];

export function SitePagesPage({ projectId }: { projectId: string }) {
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [status, setStatus] = useState("");
  const [noindex, setNoindex] = useState(false);
  const [role, setRole] = useState("");
  const [offset, setOffset] = useState(0);
  const deferredSearch = useDeferredValue(search);

  const query = useQuery({
    queryKey: [
      "site-pages",
      projectId,
      deferredSearch,
      language,
      status,
      noindex,
      role,
      offset,
    ],
    queryFn: () =>
      listSitePages({
        data: {
          projectId,
          search: deferredSearch || undefined,
          language: language || undefined,
          statusCode: status ? Number(status) : undefined,
          noindex: noindex || undefined,
          pageRole: PAGE_ROLES.find((value) => value === role),
          limit: PAGE_SIZE,
          offset,
        },
      }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const resetOffset = () => setOffset(0);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">页面清单</h1>
        <p className="mt-1 text-sm text-base-content/60">
          站点现有页面、对应源文件，以及有多少选题簇指向它。由 Claude 通过
          import_site_pages 导入。
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input input-bordered input-sm w-64"
          placeholder="搜索网址、标题或 H1"
          aria-label="搜索页面"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetOffset();
          }}
        />
        <select
          className="select select-bordered select-sm"
          aria-label="按语言筛选"
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value);
            resetOffset();
          }}
        >
          <option value="">全部语言</option>
          {(query.data?.languages ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-sm"
          aria-label="按角色筛选"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            resetOffset();
          }}
        >
          <option value="">全部角色</option>
          {PAGE_ROLES.map((value) => (
            <option key={value} value={value}>
              {pageRoleLabels[value]}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-sm"
          aria-label="按状态码筛选"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            resetOffset();
          }}
        >
          <option value="">全部状态码</option>
          {STATUS_CODE_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={noindex}
            onChange={(event) => {
              setNoindex(event.target.checked);
              resetOffset();
            }}
          />
          仅看 noindex
        </label>
        <span className="text-xs text-base-content/60">共 {total} 个页面</span>
      </div>

      {query.isError && (
        <div role="alert" className="rounded-lg bg-error/10 p-3 text-sm">
          {getStandardErrorMessage(query.error)}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>网址</th>
              <th>语言</th>
              <th>标题</th>
              <th>路由 / 内容文件</th>
              <th>状态码</th>
              <th>noindex</th>
              <th>角色</th>
              <th>选题簇</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((page) => (
              <tr key={page.id}>
                <td className="max-w-[24rem] break-all">
                  <SafeExternalLink
                    url={page.url}
                    label={page.path}
                    className="link link-hover"
                  />
                  {!page.inSitemap && (
                    <span className="badge badge-ghost badge-sm ml-2">
                      不在站点地图
                    </span>
                  )}
                </td>
                <td>{page.language ?? "-"}</td>
                <td className="max-w-[20rem]">{page.title ?? "-"}</td>
                <td className="font-mono text-xs text-base-content/70">
                  <div>{page.routeFile ?? "-"}</div>
                  <div>{page.contentFile ?? "-"}</div>
                </td>
                <td>{page.statusCode ?? "未检测"}</td>
                <td>
                  {page.noindex ? (
                    <span className="badge badge-warning badge-sm">
                      noindex
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{page.pageRole ? pageRoleLabels[page.pageRole] : "-"}</td>
                <td>{page.clusterCount}</td>
              </tr>
            ))}
            {rows.length === 0 && !query.isPending && (
              <tr>
                <td
                  colSpan={8}
                  className="py-8 text-center text-base-content/60"
                >
                  没有符合条件的页面。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            className="btn btn-ghost btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            上一页
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
