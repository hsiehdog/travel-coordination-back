# Travel Coordination — Backend

An AI-powered coordination backend for business travel, built for executive assistants and self-assisted executives.

This service provides authentication, structured data handling, and AI endpoints that turn messy, real-world travel information into clear, trustworthy **trip objects**.

---

## What this service is

Most travel software is built around transactions:
- Book a flight
- Submit an expense
- Enforce a policy

This backend is built around **coordination**.

Its job is to:
- Accept unstructured, messy travel inputs
- Reason about trips holistically
- Produce structured, explainable outputs
- Act as a reliable AI boundary for the frontend

AI here is not a chatbot.  
It is an engine for **reconstruction, judgment, and clarity**.

---

## Core product concept: Trip as an Object

The backend models travel as a single object that includes:
- Purpose and destination
- Date range and day-by-day structure
- Timeline items (flights, lodging, meetings, notes)
- Explicit assumptions and inferred logic
- Risks and missing information
- Executive-ready summaries

Everything else in the system builds on this abstraction.

---

## Week-1 MVP: Magic Itinerary Reconstructor

The first production endpoint demonstrates the full value proposition.

### POST `/ai/reconstruct`

Accepts:
- A large, unstructured block of pasted travel text  
  (confirmation emails, notes, receipts, Slack messages, etc.)
- Minimal client context (timezone, current time)

Returns:
- A validated `TripReconstruction` JSON object containing:
  - A 2–3 sentence executive summary
  - A day-grouped itinerary timeline
  - Schedule-based risk flags (e.g., tight windows)
  - Explicit assumptions and missing information

### Explicit constraints (Week-1)
- No booking or payments
- No maps or travel-time APIs
- No hallucinated facts
- Conservative inference with full transparency
- Strict schema validation with one repair retry

This endpoint proves that AI can **reconstruct meaning**, not just parse fields.

---

## What the full backend will evolve into

Over time, this service will expand to support:
- Persistent trips with editing and versioning
- Preference profiles per traveler
- Change detection and “what changed / what to do” summaries
- Assistant-managed workflows across multiple travelers
- Optional integrations (calendar read, email parsing, travel data APIs)
- Organization and role support

The schema-first, validation-heavy approach is intentional.  
**Trust is the product.**

---

## Tech stack

- Express + TypeScript
- PostgreSQL + Prisma
- Better Auth (Prisma adapter, secure cookie sessions)
- Vercel AI SDK for LLM integration

---

## Running locally

```bash
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
