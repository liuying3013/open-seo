import {
  deleteSavedKeywordTag,
  getSavedKeywords,
  getSerpAnalysis,
  listResearchedKeywords,
  removeSavedKeywords,
  research,
  saveKeywords,
  exportSavedKeywords,
  updateSavedKeywordTag,
  updateSavedKeywordTags,
  refreshSavedKeywordMetrics,
} from "@/server/features/keywords/services/research";

export const KeywordResearchService = {
  research,
  getSerpAnalysis,
  saveKeywords,
  getSavedKeywords,
  exportSavedKeywords,
  updateSavedKeywordTags,
  updateSavedKeywordTag,
  deleteSavedKeywordTag,
  removeSavedKeywords,
  refreshSavedKeywordMetrics,
  listResearchedKeywords,
} as const;
