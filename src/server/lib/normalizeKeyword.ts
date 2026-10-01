// Keyword normalization for clustering/dedup. Deliberately conservative:
// lowercase + unicode-normalize + whitespace collapse. No stemming — "vfd" vs
// "vfds" may genuinely differ in SERP, and SERP overlap (not string similarity)
// is the ground truth for merging.
export function normalizeKeyword(keyword: string): string {
  return keyword.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}
