# AI-Ready Backend

TypeScript + Express backend scaffold that combines PostgreSQL/Prisma persistence, Better Auth powered authentication, and the Vercel AI SDK for LLM-powered endpoints. Designed to plug into multiple AI-focused products.

## Tech Stack
- **Express 5** with Helmet/Cors/Morgan hardening
- **TypeScript** tooling with `ts-node-dev` for hot reload
- **Prisma** ORM targeting PostgreSQL (with Better Auth tables baked in)
- **Better Auth** Prisma adapter for password auth + secure session cookies (per [discussion #5578](https://github.com/better-auth/better-auth/discussions/5578))
- **Vercel AI SDK** (`ai` + `@ai-sdk/openai`) for LLM calls

## Getting Started
1. Install dependencies (pnpm is required):
   ```bash
   pnpm install
   ```
2. Copy the environment template and fill in secrets:
   ```bash
   cp .env.example .env
   ```
   - Set `BETTER_AUTH_SECRET` to a long random value.
   - Update `APP_BASE_URL` and `TRUSTED_ORIGINS` so Better Auth can validate callback URLs and allow your frontend origin(s) to exchange cookies.
3. Apply database migrations (creates the Prisma Client as well):
   ```bash
   pnpm prisma:migrate
   ```
4. Start the dev server:
   ```bash
   pnpm dev
   ```

## Scripts
- `pnpm dev` – start Express with `ts-node-dev`
- `pnpm build` – compile to `dist/`
- `pnpm start` – run the compiled build
- `pnpm prisma:migrate` – run migrations against the `DATABASE_URL`
- `pnpm prisma:generate` – regenerate Prisma Client

## API Surface
| Method | Route | Description | Auth |
| --- | --- | --- | --- |
| GET | `/health` | Health probe | Public |
| GET | `/users/me` | Returns the authenticated user record | Better Auth session cookie |
| GET | `/users/me/sessions` | Last 20 AI sessions tied to the user | Better Auth session cookie |
| POST | `/ai/generate` | Accepts `{ "prompt": string }` and streams an LLM response persisted to the DB | Better Auth session cookie |

Better Auth issues HTTP-only cookies (`better-auth.session_token`, etc.) that the frontend must forward on every request to protected routes. Non-browser clients can store the session cookie manually and send it via the `Cookie` header.

### Better Auth Endpoints
- The entire Better Auth router is exposed at `/auth/*` (the Express app proxies requests directly to `betterAuth.handler` as recommended in discussion #5578).
- Use the stock endpoints such as `POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `GET /auth/get-session`, etc.
- Successful sign-in/sign-up responses include `Set-Cookie` headers for `better-auth.session_token` and its related helpers. These cookies are the only credentials the API expects.

## Project Structure
```
src
├── app.ts               # Express app wiring
├── index.ts             # HTTP server bootstrap
├── config               # env + runtime flags
├── controllers          # Route handlers
├── middleware           # Auth context + error handlers
├── routes               # Express routers (auth proxy, health, users, ai)
├── services             # Domain logic (LLM helpers)
├── lib                  # Prisma singleton + Better Auth instance
└── types                # Express augmentations
```

## Vercel AI Usage
`aiService.generateResponse` demonstrates how to call the Vercel AI SDK with an OpenAI model. Swap providers/models by editing `AI_MODEL` or by injecting a different client in the service.

## Authentication Flow
1. Call the Better Auth endpoints under `/auth` (e.g., `POST /auth/sign-in/email`).
2. Let the frontend/browser store the HTTP-only cookies that Better Auth sets. For non-browser clients, capture the `Set-Cookie` response headers and reuse them for subsequent API calls.
3. Ensure every protected request forwards the cookies (typically via `fetch(..., { credentials: "include" })`). The backend uses `auth.api.getSession({ headers })` to resolve the session and populate `req.user`.
4. For split frontend/backends, set `TRUSTED_ORIGINS` so Better Auth will accept cross-site cookie requests, matching the pattern from the shared GitHub discussion.

## Next Steps
- Define additional Prisma models if your AI workflows need metadata (projects, datasets, etc.)
- Layer in streaming responses via `generateTextStream`
- Deploy behind a process manager (e.g., Vercel, Fly, Railway) and configure `DATABASE_URL` + secrets via your platform
