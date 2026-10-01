import { z } from "zod";
import type { EvidencePackContent } from "./evidencePack";

export const GENERATE_BRIEF_PROMPT_VERSION = "generate-brief-v1";

export const briefOutputSchema = z.object({
  angle: z
    .string()
    .describe(
      "The differentiated angle for THIS platform, one sentence, distinct " +
        "from every sibling angle listed in the prompt",
    ),
  title: z.string().describe("Working title in the platform's native style"),
  brief: z
    .string()
    .describe(
      "The full content brief in markdown: audience, angle rationale, " +
        "outline with per-section evidence citations, brand mention plan, " +
        "CTA, and what NOT to claim",
    ),
});

const PLATFORM_GUIDANCE: Record<string, string> = {
  money_site:
    "A money-site page brief. Outline the page section by section for the decided page type; include internal linking targets, structured data hints, and the conversion module (WhatsApp/RFQ).",
  medium:
    "A Medium article brief. Independent-analyst voice with disclosed affiliation; a genuinely useful standalone read, NOT a rewrite of the money page. No hard selling; one contextual brand mention plus author bio.",
  youtube:
    "A YouTube video script brief: hook (first 15s), segment-by-segment outline with what to SHOW on screen, spoken CTA, title + description + tags.",
  pinterest:
    "A Pinterest pin (or board) brief: visual concept, overlay text, description with keywords, destination link.",
  linkedin:
    "A LinkedIn post/article brief: professional buyer's angle (procurement, risk, TCO), first-person practitioner voice with disclosed role, engagement question at the end.",
  reddit:
    "A Reddit participation brief for a HUMAN operator: which communities, what genuinely helpful contribution to make, disclosed-affiliation phrasing, and hard rules (no astroturfing, no link drops).",
  quora:
    "A Quora answer brief for a HUMAN operator: the exact questions to answer, the expert angle, disclosed affiliation, evidence to cite.",
  pdf: "A downloadable document brief: spec sheet / checklist / catalog structure, what tables and data it contains, where it gets distributed.",
  facebook:
    "A Facebook Page post brief for the company's OWN page: one concrete buyer problem, the image or short video to pair with it, a plain-language explanation, and the enquiry CTA. Company voice, never a fake individual. Say which pack facts it draws on.",
  instagram:
    "An Instagram post/carousel brief for the company's OWN account: the visual sequence (what each frame shows — finish, texture, install step, scale reference), the caption's single takeaway, and the enquiry CTA. Specify what must be PHOTOGRAPHED; never pass a render or a stock image off as a real install.",
};

export const GENERATE_BRIEF_SYSTEM = `You write ONE platform-specific content brief from a master evidence pack.

Hard rules:
- Use ONLY facts from the evidence pack. Never add specifications, prices, or claims that are not in it. Respect prohibitedClaims absolutely.
- The angle MUST be materially different from every sibling angle listed — different question, different audience entry point, or different evidence emphasis. Not a paraphrase.
- Follow the brand mention mode given: the brand appears naturally and identity/affiliation is always disclosed. No fake independence, no invented experience.
- The brief instructs a writer; it is not the article itself. Cite which evidence-pack items each section should use.
- Respect the writing preferences when provided.`;

export function buildBriefPrompt(input: {
  platform: string;
  assetType: string | null;
  brandMentionMode: string | null;
  clusterName: string;
  userJob: string | null;
  pack: EvidencePackContent;
  siblingAngles: Array<{ platform: string; angle: string }>;
  writingPreferences: string | null;
}): string {
  return `Platform: ${input.platform} (${input.assetType ?? "default"})
${PLATFORM_GUIDANCE[input.platform] ?? "A platform-native content brief."}

Cluster: ${input.clusterName} | User job: ${input.userJob ?? "(unset)"}
Brand mention mode: ${input.brandMentionMode ?? "author_attribution"}

Sibling angles already taken (yours MUST differ from all of these):
${input.siblingAngles.map((s) => `- [${s.platform}] ${s.angle}`).join("\n") || "(none yet)"}
${input.writingPreferences ? `\nWriting preferences:\n${input.writingPreferences}` : ""}

MASTER EVIDENCE PACK:
${JSON.stringify(input.pack, null, 2)}`;
}
