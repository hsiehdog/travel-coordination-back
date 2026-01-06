# AGENTS.md — Travel Coordination Backend

This document describes the **intent, boundaries, and operating principles** of the Travel Coordination backend.

It is not an API reference.  
It explains *how to think* when building or extending this service.

---

## What this backend exists to do

This backend is the **coordination and judgment layer** for business travel.

Its purpose is to turn messy, unstructured, real-world travel information into:
- Clear structure
- Explicit assumptions
- Trustworthy summaries
- Actionable signals

It is **not** a booking engine.
It is **not** an expense system.
It is **not** a chatbot.

It is the system that answers:
> “What is this trip, what matters, and what should I do next?”

---

## Core abstraction: Trip as an Object

Everything in this backend revolves around a single abstraction:

**A Trip is a first-class object.**

A trip includes:
- Why the travel exists (purpose)
- When and where things happen (timeline)
- What is known vs inferred (assumptions)
- What is missing (clarifying questions)
- Where risk exists (tight windows, conflicts)
- How to explain it to an executive (summaries)

All AI outputs must reinforce this abstraction.

If a feature does not clearly strengthen the “Trip as an Object,” it likely does not belong here.

---

## Role of AI in this system

AI in this backend is used for **reasoning and reconstruction**, not automation.

Specifically, AI is used to:
- Reconstruct structure from unstructured text
- Infer relationships and chronology when justified
- Surface risks and ambiguities
- Generate calm, executive-ready summaries

AI must **never**:
- Invent facts
- Hide uncertainty
- Claim precision it does not have
- Act autonomously on behalf of the user

The backend treats AI as a **fallible collaborator**, not an authority.

---

## The backend as the AI boundary

This backend is the **only place** where:
- LLMs are called
- Prompts are written
- Output is validated and repaired
- Hallucination risk is mitigated

Frontend code must never:
- Call LLMs directly
- Re-interpret or “fix” AI output
- Guess missing data

All AI outputs must be:
1. Schema-validated
2. Explicit about assumptions
3. Safe to render directly in the UI

---

## Week-1 MVP principle: Reconstruction over perfection

The Week-1 MVP endpoint (`POST /ai/reconstruct`) is intentionally constrained.

Its goal is to prove that:
- Meaning can be reconstructed from chaos
- Structure can be inferred transparently
- Executives and assistants gain clarity immediately

Week-1 constraints are deliberate:
- No maps
- No travel-time APIs
- No booking or payments
- No real-time integrations

If a feature requires pretending we know more than we do, it is out of scope.

---

## Assumptions and missing info are first-class data

This backend treats uncertainty as a **feature**, not a failure.

Every AI output must:
- Mark inferred fields (`isInferred = true`)
- Record *why* the inference was made (`assumptions[]`)
- Ask for clarification when information is missing (`missingInfo[]`)

If the model is unsure, the correct response is:
> “Here’s what I think — and here’s what I’m not sure about.”

This is how trust is built.

---

## Risk flags are advisory, not absolute

Risk flags exist to:
- Draw attention
- Prompt reconsideration
- Support assistant judgment

They must:
- Be phrased conservatively (“Potentially tight window”)
- Be based only on known or inferred schedule data
- Avoid claims about travel time or logistics not supported by data

This backend does not panic.  
It **flags and explains**.

---

## Authentication and scope

All meaningful endpoints are protected by authentication.

The backend assumes:
- Requests come from a trusted frontend
- Users are authenticated via Better Auth
- Session cookies are the source of truth

Authorization logic should remain simple in early phases.
Complex org/role logic comes later.

---

## Logging, privacy, and safety

This backend handles sensitive personal and business information.

Rules:
- Do not log raw pasted travel text in production
- Do not expose model/provider errors to clients
- Prefer structured error codes over messages
- Store only what is needed for the product to function

Privacy is not a compliance exercise — it is core to user trust.

---

## Design philosophy (non-negotiable)

When in doubt:

- Prefer clarity over completeness
- Prefer explicit uncertainty over silent inference
- Prefer structure over cleverness
- Prefer calm explanations over automation
- Prefer correctness over speed

This backend exists to make high-stakes travel **understandable, explainable, and calm**.

If a change violates that, it is the wrong change.

---

## Coding guidelines

## Prime Directives
1. **Prefer the simplest working solution** that fits existing patterns.
2. **Do not grow files unnecessarily** — refactor when a file starts to feel “heavy”.
3. **Avoid framework churn** (don’t introduce new libs/patterns unless asked).
4. **Keep behavior stable** — avoid breaking existing routes/response shapes.
5. **Leave the codebase cleaner than you found it** (remove dead code and unused imports).

---

### Controllers must be thin
Controllers should:
- Parse/validate input (Zod, schemas, params)
- Call a service function
- Return JSON

Controllers must **not**:
- Contain business logic
- Call LLM/external APIs directly
- Construct Prisma create/update payloads (except tiny passthrough cases)
- Contain branching workflows (move to services)

**Pattern:**
- `src/routes/*` → route wiring only
- `src/controllers/*` → HTTP-only glue
- `src/services/*` → orchestration / workflows (call helpers and integrations)
- `src/integrations/*` → external API clients (fetch, auth headers, response normalization)
- `src/mappers/*` → “pure” mapping logic (domain → Prisma inputs, formatting)
- `src/auth/*` → group/member assertions, resolution helpers
- `src/ai/*` → parsing, memory helpers, tool registry, pending-action resolver

### Services must be slim and composable
Services should:
- Orchestrate helpers/integrations/mappers
- Be testable without HTTP context
- Prefer small helpers at file bottom for local glue

Services should **not**:
- Embed huge JSON prompts inline (use `src/prompts/...`)
- Duplicate external API calls (centralize in `integrations/`)
- Mix unrelated concerns in one function

### Prisma usage
- Keep Prisma calls in services (or specialized repository/helper modules).
- Prefer `build*CreateInput()` / `build*UpdateInput()` mappers over inline payloads.
- Always validate membership/ownership before querying or mutating group-scoped data:
  - Prefer helpers like `assertMembersBelongToGroup(groupId, memberIds)`.

### Errors
- Throw `ApiError(message, status)` (or existing error handler pattern).
- No `console.log` in final code unless behind a debug flag.

---

## AI / LLM Integration Rules (Critical)
### Never let the LLM write DB inputs directly
LLM output must be a **structured “intent”** (tool call / command), then backend code:
- validates
- resolves IDs (members, group, itinerary item)
- calls services to mutate data

### Pending actions (confirmations / choices)
- Implement confirmations via a **PendingAction** state that is:
  - persisted in `aiSession.response` payload
  - resolved before running the LLM (pending resolver first)
- Use “stop-at-clear” semantics: once a payload stores `pendingAction: null`, do not resurrect older pending actions.

### Keep prompts in prompt files
- System prompts go in `src/prompts/system/...`
- Avoid inline prompt blobs inside services.

---

## Naming + Types
- TypeScript everywhere.
- Public service functions should have explicit input/output types.
- Prefer `type` over `interface` for small shapes.
- Use consistent naming:
  - `createX`, `updateX`, `deleteX`, `getX`, `listX`
  - `buildXCreateInput`, `mapX`, `enrichX`

---

## Refactor Triggers (when Codex should proactively refactor)
Refactor if:
- A controller exceeds ~80–120 lines or has branching workflows.
- A service exceeds ~200–300 lines **and** contains multiple responsibilities.
- Duplicate logic appears in >2 places (extract helper/integration/mapper).
- A module imports too many unrelated domains.

Refactor style:
- Prefer adding **1–3 helper files** (not big new folder trees) unless requested.
- Keep exports minimal.
- Avoid “utility dumping grounds”.

---

## Commands
- `pnpm install`
- `pnpm prisma:migrate` (apply migrations + generate)
- `pnpm dev`
- `pnpm build`

---

## Security
- Never commit secrets or `.env*`.
- Backend must enforce auth + group authorization.

---

## Output Expectations (what Codex should provide)
When implementing a change, always output:
1. **Files changed** (list)
2. **Key behavior changes**
3. **How to run/verify**
4. If schema changed: migration steps + Prisma generate

Prefer small PR-sized changes over massive rewrites.

