import { normalizeKeyword } from "@/server/lib/normalizeKeyword";
import type { z } from "zod";
import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { SerpRepository } from "@/server/features/content-ops/repositories/SerpRepository";
import { EvidencePacksRepository } from "@/server/features/content-ops/repositories/EvidencePacksRepository";
import { DecisionsRepository } from "@/server/features/content-ops/repositories/DecisionsRepository";
import { DecisionLogRepository } from "@/server/features/content-ops/repositories/DecisionLogRepository";
import { BudgetService } from "@/server/features/content-ops/services/BudgetService";
import { OffersService } from "@/server/features/content-ops/services/OffersService";
import { ClusteringService } from "@/server/features/content-ops/services/ClusteringService";
import { ScoreService } from "@/server/features/content-ops/services/ScoreService";
import { SerpFetchService } from "@/server/features/content-ops/services/SerpFetchService";
import { AnalyzeService } from "@/server/features/content-ops/services/AnalyzeService";
import { DecideService } from "@/server/features/content-ops/services/DecideService";
import { EvidencePackService } from "@/server/features/content-ops/services/EvidencePackService";
import { BriefService } from "@/server/features/content-ops/services/BriefService";
import { CandidateKeywordsService } from "@/server/features/keywords/services/CandidateKeywordsService";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { SitePagesRepository } from "@/server/features/page-plans/repositories/SitePagesRepository";
import { resolveMarket } from "@/shared/keyword-locations";
import { estimateRankCheckCredits } from "@/shared/rank-tracking";
import { SERP_DEPTH } from "@/server/features/content-ops/rules/scoringRules";
import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { ResearchPagesRepository } from "../repositories/ResearchPagesRepository";
import { ReadPagesService } from "./ReadPagesService";
import { DraftService } from "./DraftService";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type {
  WorkbenchClusterAction,
  workbenchTopicSchema,
  workbenchAssetActionSchema,
} from "@/types/schemas/contentWorkbench";
import { serpRequestKey } from "@/shared/content-workbench";

async function overview(projectId: string) {
  const [clusters, offers, candidates, budget] = await Promise.all([
    ClustersRepository.listByProject(projectId),
    OffersService.list(projectId),
    ClustersRepository.getUnclusteredCandidateKeywords(projectId),
    BudgetService.getToday(projectId),
  ]);
  return { clusters, offers, candidates, budget };
}

async function detail(projectId: string, clusterId: string) {
  const cluster = await ClustersRepository.getById(projectId, clusterId);
  if (!cluster)
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "找不到此项目的选题。");
  const [
    keywords,
    snapshots,
    decisions,
    assets,
    pack,
    log,
    pages,
    targetPages,
  ] = await Promise.all([
    ClustersRepository.getKeywords(clusterId),
    SerpRepository.getLatestForCluster(clusterId),
    DecisionsRepository.listByCluster(clusterId),
    AssetsRepository.listByCluster(clusterId),
    EvidencePacksRepository.getLatestForCluster(clusterId),
    DecisionLogRepository.listByCluster(clusterId, 30),
    ResearchPagesRepository.getLatestForCluster(clusterId),
    cluster.targetPageId
      ? SitePagesRepository.getByIds(projectId, [cluster.targetPageId])
      : [],
  ]);
  const targetPage = targetPages[0];
  return {
    cluster,
    targetPage: targetPage
      ? { id: targetPage.id, url: targetPage.url, title: targetPage.title }
      : null,
    keywords,
    snapshots,
    decisions,
    assets,
    pack,
    log,
    pages: pages.map(
      ({ id, url, title, fetchedAt, fetchStatus, wordCount, bodyText }) => ({
        id,
        url,
        title,
        fetchedAt,
        fetchStatus,
        wordCount,
        excerpt: bodyText?.slice(0, 1200) ?? null,
      }),
    ),
  };
}

async function createTopic(input: z.infer<typeof workbenchTopicSchema>) {
  const project = await ProjectRepository.getProjectById(input.projectId);
  if (!project) throw new ContentOpsError("CLUSTER_NOT_FOUND", "项目不存在。");
  if (
    input.offerId &&
    !(await OffersService.list(input.projectId)).some(
      (o) => o.id === input.offerId,
    )
  ) {
    throw new ContentOpsError("OFFER_NOT_FOUND", "产品不属于此项目。");
  }
  const keywords = [...new Set(input.keywords.map(normalizeKeyword))];
  await CandidateKeywordsService.save({
    projectId: input.projectId,
    keywords,
    ...resolveMarket({}, project),
    source: "manual",
  });
  return ClusteringService.save({
    projectId: input.projectId,
    createdBy: "user",
    clusters: [
      {
        ...input,
        keywords,
        representatives: keywords.slice(0, 3),
        entityCategory: input.entityCategory || null,
      },
    ],
  });
}

async function serpQuote(projectId: string, clusterId: string) {
  if (!(await ClustersRepository.getById(projectId, clusterId)))
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "选题不存在。");
  const representatives = (
    await ClustersRepository.getKeywords(clusterId)
  ).filter((k) => k.isRepresentative);
  const estimate = estimateRankCheckCredits(
    representatives.length,
    "desktop",
    SERP_DEPTH,
    "live",
  );
  return {
    representatives,
    requestCount: representatives.length,
    depth: SERP_DEPTH,
    ...estimate,
    requestKey: serpRequestKey(representatives, SERP_DEPTH),
  };
}

async function runClusterAction(
  input: WorkbenchClusterAction,
  customer: BillingCustomerContext,
) {
  switch (input.action) {
    case "pre_score":
      return ScoreService.preScore({ ...input, createdBy: "user" });
    case "fetch_serps":
      return SerpFetchService.fetchClusterSerps({
        ...input,
        customer,
        devices: ["desktop"],
      });
    case "analyze":
      return AnalyzeService.analyzeCluster(input);
    case "score":
      return ScoreService.scoreBusinessValue({
        ...input,
        createdBy: "user",
        agent: {
          purchaseProximity: input.purchaseProximity,
          conversionReadiness: input.conversionReadiness,
          coreRelevance: input.coreRelevance,
        },
      });
    case "decide":
      return DecideService.decideDeployment(input);
    case "read_pages":
      return ReadPagesService.readClusterPages(input);
    case "build_pack":
      return EvidencePackService.buildPack(input);
  }
}

async function runAssetAction(
  input: z.infer<typeof workbenchAssetActionSchema>,
) {
  switch (input.action) {
    case "brief":
      return BriefService.generateBrief(input);
    case "draft":
      return DraftService.generate(input);
    case "qa":
      return DraftService.runQa(input);
  }
}

export const ContentWorkbenchService = {
  overview,
  detail,
  createTopic,
  serpQuote,
  runClusterAction,
  runAssetAction,
};
