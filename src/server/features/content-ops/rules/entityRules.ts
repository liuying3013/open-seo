// The entity taxonomy is a custom project-context section (slug below): one
// category per line, an optional prefix, then the category id — a single
// token such as MCM or PU_STONE — followed by prose. analyze_cluster's
// disambiguation returns one of those ids, and the prefix says what that
// category is to the business:
//
//   TARGET: MCM ...          sold here — deploy as usual.
//   ADJACENT: PU_STONE ...   not sold, but its searchers are our buyers (they
//                            want brick veneer; we sell what replaces it) —
//                            deploy as the honest alternative, never as a
//                            seller of it.
//   NATURAL_STONE ...        no prefix: off-target — never deploy.
//
// ADJACENT exists because "not TARGET" used to mean "skip everything", and
// the operator's rule (2026-09-05) is that product-related categories are
// worth content as long as it is honest about what the business sells.

export const ENTITY_TAXONOMY_SLUG = "entity-taxonomy";

type EntityRelation = "target" | "adjacent" | "off_target" | "unclassified";

type EntityTaxonomy = { target: string[]; adjacent: string[] };

const TARGET_PREFIX = "TARGET:";
const ADJACENT_PREFIX = "ADJACENT:";

/** "MCM — engineered clay panels" -> "MCM": the id is the bare first token. */
function categoryId(rest: string): string | null {
  const match = /^[A-Za-z0-9_-]+/.exec(rest.trim());
  return match ? match[0] : null;
}

export function parseEntityTaxonomy(taxonomy: string | null): EntityTaxonomy {
  const result: EntityTaxonomy = { target: [], adjacent: [] };
  if (!taxonomy) return result;
  for (const raw of taxonomy.split("\n")) {
    const line = raw.trim();
    const upper = line.toUpperCase();
    if (upper.startsWith(TARGET_PREFIX)) {
      const id = categoryId(line.slice(TARGET_PREFIX.length));
      if (id) result.target.push(id);
    } else if (upper.startsWith(ADJACENT_PREFIX)) {
      const id = categoryId(line.slice(ADJACENT_PREFIX.length));
      if (id) result.adjacent.push(id);
    }
  }
  return result;
}

export function classifyEntityRelation(input: {
  taxonomy: string | null;
  entityCategory: string | null;
}): EntityRelation {
  const { target, adjacent } = parseEntityTaxonomy(input.taxonomy);
  // Until the project declares what it sells nothing can be off-target, and a
  // cluster with no resolved category has nothing to classify.
  if (target.length === 0 || input.entityCategory === null) {
    return "unclassified";
  }
  if (target.includes(input.entityCategory)) return "target";
  if (adjacent.includes(input.entityCategory)) return "adjacent";
  return "off_target";
}
