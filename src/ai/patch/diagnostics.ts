import { z } from "zod";
import {
  RiskFlagSchema,
  AssumptionSchema,
  MissingInfoSchema,
} from "../reconstruct/schema";

export const DiagnosticsRefreshSchema = z
  .object({
    executiveSummary: z.string().min(1).max(200),
    destinationSummary: z.string().min(1).max(120),
    risks: z.array(RiskFlagSchema),
    assumptions: z.array(AssumptionSchema),
    missingInfo: z.array(MissingInfoSchema),
  })
  .strict();

export type DiagnosticsRefresh = z.infer<typeof DiagnosticsRefreshSchema>;

export function buildDiagnosticsSystemPrompt() {
  return `
You refresh trip diagnostics after a user update.

Rules:
- Output JSON only. No markdown. No extra text.
- Do NOT invent facts.
- Remove missingInfo entries that are now answered by the update or explicit item data.
- Update assumptions and risks only when supported by provided facts.
- Keep executiveSummary 1–2 sentences, <=200 chars.
- destinationSummary <=120 chars.
- Only reference itemIds that exist in the provided items list.
`.trim();
}

export function buildDiagnosticsUserPrompt(args: {
  rawUpdateText: string;
  itemsSnapshot: string;
  previousDiagnostics: string;
}) {
  return `
User update text:
"""
${args.rawUpdateText}
"""

Canonical trip items (id + fields):
${args.itemsSnapshot}

Previous diagnostics:
${args.previousDiagnostics}

Return JSON with:
{
  "executiveSummary": "...",
  "destinationSummary": "...",
  "risks": [...],
  "assumptions": [...],
  "missingInfo": [...]
}

Guidance:
- If the update answers a missingInfo prompt, remove that entry.
- If assumptions are now explicit, remove or update them.
- Keep risks conservative; remove only if clearly resolved.
- Do not add new items. Only update diagnostics.
`.trim();
}
