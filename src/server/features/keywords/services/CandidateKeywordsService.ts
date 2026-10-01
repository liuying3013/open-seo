import { CandidateKeywordsRepository } from "@/server/features/keywords/repositories/CandidateKeywordsRepository";
import { normalizeKeyword } from "@/server/features/keywords/services/research/helpers";
import type { CandidateKeywordRow } from "@/types/keywords";
import type {
  GetCandidateKeywordsInput,
  RemoveCandidateKeywordsInput,
  ResolvedSaveCandidateKeywordsInput,
} from "@/types/schemas/keywords";

async function list(
  input: GetCandidateKeywordsInput,
): Promise<{ rows: CandidateKeywordRow[] }> {
  const rows = await CandidateKeywordsRepository.listByProject(input.projectId);
  return { rows };
}

async function save(input: ResolvedSaveCandidateKeywordsInput) {
  const keywords = [
    ...new Set(
      input.keywords
        .map(normalizeKeyword)
        .filter((keyword) => keyword.length > 0),
    ),
  ];
  const rows = await CandidateKeywordsRepository.saveToProject({
    projectId: input.projectId,
    keywords,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    source: input.source ?? null,
  });
  return {
    savedCount: rows.length,
    rows,
  };
}

async function countByProjectIds(projectIds: string[]) {
  return CandidateKeywordsRepository.countByProjectIds(projectIds);
}

async function remove(input: RemoveCandidateKeywordsInput) {
  const deletedCount = await CandidateKeywordsRepository.remove(
    input.candidateKeywordIds,
    input.projectId,
  );
  return { deletedCount };
}

export const CandidateKeywordsService = {
  list,
  save,
  countByProjectIds,
  remove,
};
