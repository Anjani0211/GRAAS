import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { Case } from "../../models/Case";
import { graphDB } from "../../services/graphDB";

export const checkCrossCaseMatchesTool: AgentTool<{ entity: string }, Record<string, unknown>> = {
  name: "check_cross_case_matches",
  description:
    "Check whether an entity value appears in other cases (cross-case correlation). Use for significant phone/UPI/IP/domain/email identifiers to detect clusters.",
  inputSchema: z.object({
    entity: z.string().min(1).describe("Entity value to search across cases"),
  }),
  execute: async (input, ctx) => {
    const entity = input.entity.trim();
    if (!entity) {
      return {
        success: false,
        rawText: "Cross-case matching requires a non-empty entity.",
        confidence: ConfidenceScore.UNVERIFIED,
        error: "INVALID_ENTITY",
        data: { entity: input.entity },
      };
    }

    const current = await Case.findOne({ caseNumber: ctx.caseId }).select("_id caseNumber").lean();
    const currentId = current?._id?.toString();
    const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mongoHits = await Case.find({
      ...(currentId ? { _id: { $ne: currentId } } : {}),
      $or: [
        { "osintInvestigation.entities.value": entity },
        { description: { $regex: escaped, $options: "i" } },
      ],
    })
      .select("caseNumber category severity updatedAt")
      .limit(50)
      .lean();

    let graphHits: string[] = [];
    if (graphDB.isAvailable()) {
      try {
        const rows = await graphDB.runQuery<{ caseId: string }>(
          `MATCH (c:Case)-[:INVOLVED]->(e {value: $entity})
           WHERE c.caseId <> $caseId
           RETURN DISTINCT c.caseId AS caseId
           LIMIT 50`,
          { entity, caseId: ctx.caseId },
        );
        graphHits = rows.map((r) => String(r.caseId));
      } catch {
        graphHits = [];
      }
    }

    const merged = [...new Set([...mongoHits.map((h) => h.caseNumber), ...graphHits])];
    const confidence =
      merged.length >= 5 ? ConfidenceScore.HIGH : merged.length >= 1 ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW;
    return {
      success: true,
      rawText: `Cross-case matches for ${entity}: ${merged.length} linked case(s) found.`,
      confidence,
      data: {
        entity,
        currentCaseId: ctx.caseId,
        linkedCaseNumbers: merged,
        mongoMatches: mongoHits.map((h) => ({
          caseNumber: h.caseNumber,
          category: h.category,
          severity: h.severity,
          updatedAt: h.updatedAt,
        })),
        graphMatches: graphHits,
      },
    };
  },
  shouldScreenshot: false,
  tier: "INTERNAL",
  requiresKey: null,
};
