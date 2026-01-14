export function buildPatchSystemPrompt() {
  return `
You update an existing trip by producing patch operations (not a full reconstruction).

Rules:
- Output JSON only. No markdown. No extra text.
- Do NOT invent facts. If ambiguous, choose NEED_CLARIFICATION.
- Prefer UPDATE_ITEM when modifying an existing item.
- Use CANCEL_ITEM only when the user explicitly cancels.
- Use REPLACE_ITEM when the user explicitly changes to a new item (e.g., \"changed to Restaurant B\").
- Use CREATE_ITEM only when the update adds a brand-new item.

Output must match the PatchIntent schema provided in the user prompt.
`.trim();
}

export function buildPatchUserPrompt(args: {
  clientTimezone: string;
  nowIso?: string;
  rawUpdateText: string;
  tripItemsSnapshot: string;
}) {
  return `
Client context:
- timezone: ${args.clientTimezone}
- nowIso: ${args.nowIso ?? "(not provided)"}

Trip items snapshot (compact):
${args.tripItemsSnapshot}

User update text:
"""
${args.rawUpdateText}
"""

PatchIntent schema:
{
  "ops": [
    {
      "opType": "CREATE_ITEM|UPDATE_ITEM|CANCEL_ITEM|DISMISS_ITEM|REPLACE_ITEM|NEED_CLARIFICATION",
      "targetHints": {
        "kind": "FLIGHT|LODGING|MEETING|MEAL|TRANSPORT|ACTIVITY|NOTE|OTHER",
        "localDate": "YYYY-MM-DD",
        "localTime": "HH:mm",
        "titleKeywords": ["short", "keywords"],
        "locationKeywords": ["short", "keywords"]
      },
      "updates": {
        "title": "string",
        "locationText": "string",
        "start": { "localDate": "YYYY-MM-DD", "localTime": "HH:mm", "timezone": "IANA", "iso": "ISO" },
        "end": { "localDate": "YYYY-MM-DD", "localTime": "HH:mm", "timezone": "IANA", "iso": "ISO" },
        "kind": "FLIGHT|LODGING|MEETING|MEAL|TRANSPORT|ACTIVITY|NOTE|OTHER"
      },
      "replacement": {
        "kind": "FLIGHT|LODGING|MEETING|MEAL|TRANSPORT|ACTIVITY|NOTE|OTHER",
        "title": "string",
        "start": { "localDate": "YYYY-MM-DD", "localTime": "HH:mm", "timezone": "IANA", "iso": "ISO" },
        "end": { "localDate": "YYYY-MM-DD", "localTime": "HH:mm", "timezone": "IANA", "iso": "ISO" },
        "locationText": "string"
      },
      "confidence": 0.0,
      "reason": "short explanation"
    }
  ]
}

Guidance:
- If the update text does not clearly identify a single item, use NEED_CLARIFICATION.
- Provide targetHints whenever an existing item is referenced.
- Use 24-hour HH:mm times; if time is missing, omit localTime.
- Do not return item IDs.
- Keep reasons short and factual.

Return JSON only.
`.trim();
}
