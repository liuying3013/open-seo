import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { OffersService } from "@/server/features/content-ops/services/OffersService";

const offerInputSchema = z.object({
  id: z.string().optional().describe("Set to update an existing offer"),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  marginTier: z.enum(["high", "mid", "low"]),
  readiness: z
    .enum(["ready", "partial", "none"])
    .describe("Can we actually supply/fulfill this today?"),
  marketPriority: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("1 = top target market priority, 5 = lowest"),
  conversionAssets: z
    .string()
    .nullable()
    .optional()
    .describe(
      'JSON like {"landingPage":"/vfd","whatsapp":true,"rfqForm":"/rfq"}',
    ),
  notes: z.string().max(2000).nullable().optional(),
});

export const listOffersTool = {
  name: "list_offers",
  config: {
    title: "List offers",
    description:
      "List the project's offers (what the business can actually sell/fulfill). Business-value scoring reads margin/readiness/priority from the offer a cluster serves. Free.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      offers: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const offers = await OffersService.list(args.projectId);
    const text =
      offers.length > 0
        ? offers
            .map(
              (offer) =>
                `- ${offer.name} [${offer.id}] margin=${offer.marginTier} readiness=${offer.readiness} priority=${offer.marketPriority}`,
            )
            .join("\n")
        : "No offers yet. Save offers before scoring clusters — without a linked offer, supplier/margin/priority subscores are 0.";
    return mcpResponse({
      text,
      structuredContent: { offers },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};

type SaveOffersArgs = {
  projectId: string;
  offers: z.infer<typeof offerInputSchema>[];
};

export const saveOffersTool = {
  name: "save_offers",
  config: {
    title: "Save offers",
    description:
      "Create or update offers for a project (upsert by id). Confirm the offer list with the user before saving — offers drive business-value scoring. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      offers: z.array(offerInputSchema).min(1).max(50),
    },
    outputSchema: z.looseObject({
      savedIds: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: SaveOffersArgs, context) => {
    const { savedIds } = await OffersService.save(
      args.projectId,
      args.offers.map((offer) => ({
        ...offer,
        description: offer.description ?? null,
        conversionAssets: offer.conversionAssets ?? null,
        notes: offer.notes ?? null,
      })),
    );
    return mcpResponse({
      text: `Saved ${savedIds.length} offer(s).`,
      structuredContent: { savedIds },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};
