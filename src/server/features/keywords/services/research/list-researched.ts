import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import type { ResearchedKeywordRow } from "@/types/keywords";
import type { ListResearchedKeywordsInput } from "@/types/schemas/keywords";

export async function listResearchedKeywords(
  input: ListResearchedKeywordsInput,
): Promise<{ rows: ResearchedKeywordRow[]; totalCount: number }> {
  const result = await KeywordResearchRepository.listRecentKeywordMetrics({
    projectId: input.projectId,
    limit: input.limit,
  });

  return {
    rows: result.rows.map((row) => ({
      keyword: row.keyword,
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      searchVolume: row.searchVolume ?? null,
      cpc: row.cpc ?? null,
      competition: row.competition ?? null,
      keywordDifficulty: row.keywordDifficulty ?? null,
      intent: row.intent ?? null,
      fetchedAt: row.fetchedAt,
    })),
    totalCount: result.totalCount,
  };
}
