import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import { assertOpportunityTransition } from "../stateMachine";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { collectRowsToSync, writeKeywordRowsToProject } from "./keywordSync";

// Graduation is the status crossing into a project. Keyword rows themselves
// are written at fetch time (metrics / SERP); this step upserts the full set
// again (idempotent) and seeds project memory. SERP snapshots stay in the
// opportunity tables — Saved Keywords reads them through by keyword+location.

function memorySlug(normalizedName: string, id: string): string {
  const slug = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `opp-${slug || id.slice(0, 8)}`;
}

async function promoteKeywordsIntoProject(
  opportunityId: string,
  projectId: string,
): Promise<number> {
  return writeKeywordRowsToProject(
    projectId,
    await collectRowsToSync(opportunityId),
  );
}

/**
 * Backfill into a chosen project without graduating. New fetches already
 * write themselves; this is for a different project or a pre-change pool.
 */
async function syncKeywordsToProject(input: {
  opportunityId: string;
  projectId: string;
  organizationId: string;
  notes?: string | null;
}): Promise<{ promotedKeywords: number }> {
  const opportunity = await OpportunitiesRepository.getById(
    input.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }
  const project = await ProjectService.getProjectForOrganization(
    input.organizationId,
    input.projectId,
  );
  if (!project) {
    throw new OpportunityIntelError(
      "PROJECT_NOT_FOUND",
      "Project not found in this organization.",
    );
  }
  const promotedKeywords = await promoteKeywordsIntoProject(
    input.opportunityId,
    input.projectId,
  );
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "review",
    decision: JSON.stringify({
      action: "sync_keywords",
      projectId: input.projectId,
      promotedKeywords,
    }),
    reasonSummary:
      input.notes ??
      `Synced ${promotedKeywords} keywords into project ${project.name ?? input.projectId} (no status change).`,
    createdBy: "user",
  });
  return { promotedKeywords };
}

async function graduateOpportunity(input: {
  opportunityId: string;
  projectId: string;
  organizationId: string;
  notes?: string | null;
}): Promise<{ promotedKeywords: number }> {
  const opportunity = await OpportunitiesRepository.getById(
    input.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }
  if (opportunity.status !== "shortlisted") {
    throw new OpportunityIntelError(
      "GRADUATION_NOT_ALLOWED",
      `Only SHORTLISTED opportunities graduate (current status: ${opportunity.status}).`,
      { status: opportunity.status },
    );
  }
  assertOpportunityTransition(opportunity.status, "graduated");
  const project = await ProjectService.getProjectForOrganization(
    input.organizationId,
    input.projectId,
  );
  if (!project) {
    throw new OpportunityIntelError(
      "PROJECT_NOT_FOUND",
      "Project not found in this organization.",
    );
  }
  const claim = await OpportunitiesRepository.claimGraduation(
    input.organizationId,
    input.opportunityId,
    input.projectId,
  );
  if (claim === "conflict") {
    throw new OpportunityIntelError(
      "GRADUATION_NOT_ALLOWED",
      "Opportunity is already graduating to another project or changed status.",
    );
  }

  const promotedKeywords = await promoteKeywordsIntoProject(
    input.opportunityId,
    input.projectId,
  );

  // Seed project memory so content-ops business rules start warm.
  const summary = [
    `Graduated from opportunity-intel on ${new Date().toISOString().slice(0, 10)}.`,
    `Type: ${opportunity.type}. Score: ${opportunity.latestScore ?? "?"} (confidence ${opportunity.latestConfidence ?? "?"}, ${opportunity.latestScoreVersion ?? "unversioned"}). IP risk: ${opportunity.ipRisk}.`,
    opportunity.description ? `Definition: ${opportunity.description}` : null,
    `Promoted ${promotedKeywords} keywords (saved_keywords source='opportunity').`,
    `Full evidence: /opportunities/${opportunity.id}`,
    input.notes ? `Reviewer notes: ${input.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  await ProjectContextService.applyContextUpdates(
    input.projectId,
    [
      {
        customSection: memorySlug(opportunity.normalizedName, opportunity.id),
        title: `Opportunity: ${opportunity.name}`,
        content: summary,
      },
    ],
    "mcp",
  );

  const transitioned = await OpportunitiesRepository.updateStatus(
    input.organizationId,
    input.opportunityId,
    "shortlisted",
    "graduated",
    input.projectId,
  );
  if (!transitioned) {
    const current = await OpportunitiesRepository.getById(
      input.organizationId,
      input.opportunityId,
    );
    if (
      current?.status === "graduated" &&
      current.graduatedProjectId === input.projectId
    ) {
      return { promotedKeywords };
    }
    throw new OpportunityIntelError(
      "INVALID_STATUS_TRANSITION",
      "Opportunity changed while it was graduating; refresh before retrying.",
    );
  }
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "graduation",
    decision: JSON.stringify({
      projectId: input.projectId,
      promotedKeywords,
    }),
    reasonSummary:
      input.notes ??
      `Graduated onto project ${project.name ?? input.projectId}.`,
    createdBy: "user",
  });
  return { promotedKeywords };
}

export const GraduationService = {
  graduateOpportunity,
  syncKeywordsToProject,
};
