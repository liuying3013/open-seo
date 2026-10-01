import { useQuery } from "@tanstack/react-query";
import { listResearchedKeywords } from "@/serverFunctions/keywords";

export function useResearchedKeywords(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["researched-keywords", projectId],
    queryFn: () => listResearchedKeywords({ data: { projectId } }),
    enabled: enabled && projectId.length > 0,
    staleTime: 60_000,
  });
}
