import { serpRequestKey } from "@/shared/content-workbench";
import { env } from "cloudflare:workers";
import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { SerpLiveItem } from "@/server/lib/dataforseo/serp";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { ContentOpsError } from "../contentOpsErrors";
import { SERP_DEPTH } from "../rules/scoringRules";
import {
  heuristicContentType,
  platformForDomain,
} from "@/server/lib/serp/platformMap";
import { flattenSerpItems } from "@/server/lib/serp/flattenSerpItems";
import { assertClusterTransition } from "../stateMachine";
import { ClustersRepository } from "../repositories/ClustersRepository";
import {
  SerpRepository,
  type NewSerpSnapshot,
} from "../repositories/SerpRepository";
import { BudgetService } from "./BudgetService";

// Fetches live SERPs for a cluster's representative keywords and persists
// classified snapshots. Classification here is purely mechanical (item types,
// domain->platform map, owned/competitor flags, URL heuristics); the LLM
// content-type pass lives in AnalyzeService.

const RAW_PAYLOAD_PREFIX = "content-ops/serp-raw/";

type ClassifiedRow = NewSerpSnapshot["results"][number];

function bareHost(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "");
}

function matchesDomain(candidate: string, target: string): boolean {
  const c = bareHost(candidate);
  const t = bareHost(target);
  return c === t || c.endsWith(`.${t}`);
}

/**
 * Flatten SERP items (shared generic flattening) and decorate each row with
 * the content-ops classification: platform, heuristic content type, and
 * owned/competitor flags.
 */
function classifySerpItems(input: {
  items: SerpLiveItem[];
  ownedDomain: string | null;
  competitorDomains: string[];
}): {
  rows: ClassifiedRow[];
  features: string[];
  relatedSearches: string[];
} {
  const { rows, features, relatedSearches } = flattenSerpItems(input.items);
  return {
    rows: rows.map((row) => {
      const platform = platformForDomain(row.domain);
      return {
        ...row,
        platform,
        contentType: heuristicContentType({
          resultType: row.resultType,
          url: row.url,
          title: row.title,
          platform,
        }),
        isOwned: input.ownedDomain
          ? matchesDomain(row.domain, input.ownedDomain)
          : false,
        isCompetitor: input.competitorDomains.some((domain) =>
          matchesDomain(row.domain, domain),
        ),
      };
    }),
    features,
    relatedSearches,
  };
}

/**
 * Fetch + persist SERP snapshots for a cluster's representative keywords.
 * Consumes 1 serpFetches budget unit per keyword×device BEFORE each call.
 */
async function fetchClusterSerps(input: {
  projectId: string;
  clusterId: string;
  customer: BillingCustomerContext;
  devices?: Array<"desktop" | "mobile">;
  approvedRequestKey?: string;
}) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  const fromStatus = cluster.status;
  assertClusterTransition(fromStatus, "serp_pending");

  const keywords = await ClustersRepository.getKeywords(input.clusterId);
  const representatives = keywords.filter((k) => k.isRepresentative);
  if (
    input.approvedRequestKey !== undefined &&
    (input.approvedRequestKey !== serpRequestKey(representatives, SERP_DEPTH) ||
      (input.devices !== undefined &&
        (input.devices.length !== 1 || input.devices[0] !== "desktop")))
  ) {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      "代表词或市场已变化，请重新查看费用并确认。",
    );
  }
  if (representatives.length === 0) {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      "Cluster has no representative keywords to fetch SERPs for.",
    );
  }

  const [project, competitors] = await Promise.all([
    ProjectRepository.getProjectById(input.projectId),
    ProjectContextRepository.listCompetitors(input.projectId),
  ]);
  const ownedDomain = project?.domain ?? null;
  const competitorDomains = competitors.map((c) => c.domain);

  const claimed = await ClustersRepository.transitionStatus(
    input.projectId,
    input.clusterId,
    fromStatus,
    "serp_pending",
  );
  if (!claimed) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "Cluster changed before the SERP fetch started; refresh and retry.",
    );
  }
  const client = createDataforseoClient(input.customer);
  const devices = input.devices?.length ? input.devices : ["desktop" as const];
  const snapshotIds: string[] = [];

  try {
    for (const representative of representatives) {
      for (const device of devices) {
        await BudgetService.consume(input.projectId, "serpFetches");
        const items = await client.serp.live({
          keyword: representative.keyword,
          locationCode: representative.locationCode,
          languageCode: representative.languageCode,
          device,
          depth: SERP_DEPTH,
        });
        const { rows, features, relatedSearches } = classifySerpItems({
          items,
          ownedDomain,
          competitorDomains,
        });
        const snapshotId = await SerpRepository.insertSnapshot({
          projectId: input.projectId,
          clusterId: input.clusterId,
          keyword: representative.keyword,
          locationCode: representative.locationCode,
          languageCode: representative.languageCode,
          device,
          resultCount: rows.length,
          serpFeatures: JSON.stringify({ features, relatedSearches }),
          r2Key: await storeRawPayload(crypto.randomUUID(), items),
          results: rows,
        });
        snapshotIds.push(snapshotId);
      }
    }
  } catch (error) {
    // Revert so the cluster doesn't wedge in serp_pending; partial snapshots
    // (already persisted) stay — refetching simply appends newer ones.
    await ClustersRepository.transitionStatus(
      input.projectId,
      input.clusterId,
      "serp_pending",
      fromStatus,
    );
    throw error;
  }

  const completed = await ClustersRepository.transitionStatus(
    input.projectId,
    input.clusterId,
    "serp_pending",
    "serp_ready",
  );
  if (!completed) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "Cluster changed while SERP results were being saved; refresh before continuing.",
    );
  }
  return { snapshotIds };
}

// R2 raw-payload storage is best-effort: losing the raw JSON never fails the
// fetch (the distilled rows are already the system of record).
async function storeRawPayload(
  key: string,
  items: SerpLiveItem[],
): Promise<string | null> {
  const r2Key = `${RAW_PAYLOAD_PREFIX}${key}.json`;
  try {
    await env.R2.put(r2Key, JSON.stringify(items), {
      httpMetadata: { contentType: "application/json" },
    });
    return r2Key;
  } catch {
    return null;
  }
}

export const SerpFetchService = {
  fetchClusterSerps,
};
