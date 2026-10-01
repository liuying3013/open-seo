import type { OpportunityType } from "./scoringRules";

// The per-type expansion word banks (PRD §4–§8) live HERE, versioned — not
// inside prompts. The expansion prompt is assembled from these banks so a
// prompt rewrite cannot silently change the vocabulary the funnel searches.

export const TEMPLATE_VERSION = "opp-tpl-v1";

/** How many keywords expansion aims for per opportunity. */
export const EXPANSION_TARGET = { min: 30, max: 200 } as const;

export const KEYWORD_ROLES = [
  "seed",
  "commercial",
  "service",
  "problem",
  "model",
  "supplier",
  "buyer",
  "comparison",
  "info",
] as const;
export type KeywordRole = (typeof KEYWORD_ROLES)[number];

/** Type A + generic B2B commercial modifiers. */
const COMMERCIAL_MODIFIERS = [
  "supplier",
  "manufacturer",
  "distributor",
  "wholesale",
  "parts",
  "replacement",
  "spare parts",
  "OEM",
  "price",
  "for sale",
  "bulk",
  "b2b",
] as const;

/** Type B/C ecosystem accessory nouns. */
const ACCESSORY_NOUNS = [
  "accessories",
  "holder",
  "mount",
  "stand",
  "organizer",
  "storage",
  "display",
  "case",
  "protector",
  "rack",
  "tray",
  "adapter",
  "replacement",
  "upgrade",
] as const;

/** Type D collector-infrastructure nouns (generic goods, never IP items). */
const COLLECTOR_NOUNS = [
  "display",
  "storage",
  "case",
  "holder",
  "binder",
  "stand",
  "protector",
  "organizer",
  "carrying case",
  "wall display",
  "shelf",
  "photography",
  "shipping",
] as const;

/** Type E service action verbs… */
const SERVICE_ACTION_VERBS = [
  "clean",
  "wash",
  "dry",
  "sanitize",
  "restore",
  "repair",
  "maintain",
  "polish",
  "sharpen",
  "wax",
  "test",
  "diagnose",
  "grade",
  "inspect",
  "fit",
  "scan",
  "calibrate",
  "personalize",
  "engrave",
  "print",
  "charge",
  "store",
  "rent",
  "recycle",
] as const;

/** …combined with equipment nouns ("bike chain" + "wax" + "station"). */
const EQUIPMENT_NOUNS = [
  "machine",
  "station",
  "workstation",
  "system",
  "kiosk",
  "booth",
  "cabinet",
  "locker",
  "equipment",
  "device",
] as const;

/** Service-commerce modifiers shared by types A/E. */
const SERVICE_COMMERCE_MODIFIERS = [
  "service",
  "near me",
  "price",
  "cost",
  "business",
  "commercial",
  "automatic",
  "professional",
] as const;

type TypeTemplate = {
  /** Words the expansion LLM must combine with the opportunity's entity. */
  wordBank: readonly string[];
  /** One-paragraph steering for the expansion prompt. */
  guidance: string;
};

export const TYPE_TEMPLATES: Record<OpportunityType, TypeTemplate> = {
  a_b2b_gap: {
    wordBank: [...COMMERCIAL_MODIFIERS, ...SERVICE_COMMERCE_MODIFIERS],
    guidance:
      "Industrial B2B supply gap: expand toward supplier/manufacturer/model/" +
      "spare-part queries and concrete model or spec numbers. Zero-volume " +
      "model and supplier queries are wanted, not noise.",
  },
  b_ecosystem: {
    wordBank: [...ACCESSORY_NOUNS, ...COMMERCIAL_MODIFIERS],
    guidance:
      "Ecosystem accessories: expand toward the periphery of the core " +
      "product (mounts, storage, organization, protection, upgrades), not " +
      "the core product itself.",
  },
  c_hobby: {
    wordBank: [...ACCESSORY_NOUNS, ...SERVICE_COMMERCE_MODIFIERS],
    guidance:
      "High-spend hobby infrastructure: expand toward maintenance, storage, " +
      "upgrade, and service needs of committed hobbyists (they already own " +
      "the expensive core).",
  },
  d_ip_spillover: {
    wordBank: [...COLLECTOR_NOUNS, ...COMMERCIAL_MODIFIERS],
    guidance:
      "IP/fandom spillover: expand toward GENERIC display/storage/" +
      "protection/shipping infrastructure around the collectible category. " +
      "Never generate queries for IP goods themselves (figures, cards, " +
      "plush) — only the infrastructure around them.",
  },
  e_service_automation: {
    wordBank: [
      ...SERVICE_ACTION_VERBS,
      ...EQUIPMENT_NOUNS,
      ...SERVICE_COMMERCE_MODIFIERS,
    ],
    guidance:
      "Service automation: combine the object + action verb + equipment " +
      "noun ('bike chain' + 'waxing' + 'station'), plus service-demand " +
      "queries ('chain waxing service near me') that prove the manual " +
      "workflow exists today.",
  },
  other: {
    wordBank: [...COMMERCIAL_MODIFIERS, ...ACCESSORY_NOUNS],
    guidance:
      "Uncategorized: expand toward commercially-intended queries " +
      "(suppliers, prices, replacements) around the entity.",
  },
};
