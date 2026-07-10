# notion-mcp-hono — Agent Context

Remote MCP server exposing Notion as tools. TypeScript + Hono, deployed on Railway.
This is a **public portfolio piece** demonstrating how to build a remote MCP server
properly (Notion's official MCP server already exists — this does not compete with it).
Scope stays small and excellent.

## Working style (important)

- The developer is a senior TypeScript engineer (7+ years, XP culture: TDD, small
  commits, clean architecture) who has **never built an MCP server or used Hono**.
  This is a guided build: before each phase, explain the MCP/Hono concepts involved
  (transports, tool registration, session handling, auth middleware) in 3–5 sentences,
  then code.
- **TDD is mandatory**: write the failing test first (Notion API mocked — no real API
  calls in tests), watch it fail, then implement.
- Work **phase by phase** (see STATUS.md); stop after each phase for review + commit.
- Suggest a **conventional commit** message at the end of each phase. The developer
  commits and pushes manually.
- Keep STATUS.md updated as phases progress.

## Stack (fixed — do not substitute)

- TypeScript, strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on)
- Hono as the HTTP framework, `@hono/node-server` adapter for Node
- `@modelcontextprotocol/sdk` with **Streamable HTTP** transport (remote server, not stdio)
- Zod for input validation on every tool
- Vitest for tests
- `@notionhq/client` for the Notion API
- Secrets via env vars: `NOTION_TOKEN`, `MCP_API_KEY` — never committed

## Commands

- `npm test` — run Vitest once; `npm run test:watch` for watch mode
- `npm run typecheck` — `tsc --noEmit` (includes tests)
- `npm run build` — compile to `dist/` (excludes tests via tsconfig.build.json)
- `npm run dev` — tsx watch mode
- `npm start` — run compiled server (what Railway runs)

## Architecture (clean separation, three layers)

```
Transport layer   src/app.ts + auth middleware   Hono routes, bearer auth, /health
MCP layer         src/mcp/                       server init, tool registry, zod schemas
Notion layer      src/notion/                    client wrapper + markdown conversion
```

The Notion wrapper must be replaceable without touching MCP code. Tool handlers
depend on the wrapper's interface, never on `@notionhq/client` directly.

- `src/app.ts` is a factory (`createApp()`) so tests use `app.request()` in-process.
- `src/index.ts` is the only place that binds a port (`process.env.PORT`, Railway injects it).

## Authentication (required)

- Bearer-token Hono middleware on every MCP route; `/health` stays public.
- Compare against `MCP_API_KEY` with a **timing-safe comparison**.
- Missing/invalid token → 401 JSON body naming the expected header (never echo secrets).

## Tool scope (exactly 5 tools)

1. `search_pages` — search across the workspace
2. `get_page` — page content as clean markdown
3. `create_page` — create a page under a parent (page or database)
4. `append_blocks` — append markdown to an existing page
5. `query_database` — query a database with filters and sorts

Each tool: zod schema, description written for LLM consumption (the model reads it),
typed errors with actionable messages — never leak raw Notion API errors.

## Phase 5 handoff — implementing the 5 tools

Phases 1–4 are done (see STATUS.md). What exists and what phase 5 must do:

**Existing pieces**
- `src/notion/gateway.ts` — `NotionGateway` interface (domain types only) with exactly
  the 5 methods the tools need: `searchPages`, `getPageMarkdown`, `createPage`,
  `appendMarkdown`, `queryDatabase`. Also `NotionError` (typed, LLM-readable messages).
- `src/notion/client.ts` — `createNotionGateway(notionClient)` implements it against
  `@notionhq/client` v5 (Notion API 2025-09-03: markdown conversion is done by Notion's
  native `pages.retrieveMarkdown` / `pages.updateMarkdown`; database queries resolve
  `database_id` → first data source via `databases.retrieve` then `dataSources.query`).
- `src/mcp/server.ts` — `createMcpServer()` with a placeholder `ping` tool showing the
  `registerTool` pattern (zod raw shape as `inputSchema`, `.describe()` on every field).
- `src/app.ts` — `createApp({ mcpApiKey })`; auth + stateless transport already wired.

**Phase 5 tasks**
1. Change `createMcpServer()` to `createMcpServer(gateway: NotionGateway)` and
   `AppConfig` to `{ mcpApiKey: string; gateway: NotionGateway }`; in `src/index.ts`
   build the gateway from `new Client({ auth: NOTION_TOKEN })` and fail fast if
   `NOTION_TOKEN` is unset (same pattern as `MCP_API_KEY`).
2. Implement the 5 tools in `src/mcp/` (one module per tool or a `tools/` dir), TDD,
   **one tool at a time**: failing test → implement → green, then next tool.
3. Tool handlers catch `NotionError` and return it in-band:
   `{ isError: true, content: [{ type: 'text', text: err.message }] }` — never throw
   raw errors at the protocol layer; the LLM should be able to read and self-correct.
   Let unexpected (non-NotionError) errors propagate.
4. Update the integration test(s) to inject a fake `NotionGateway` (in-memory object);
   keep the existing test altitudes: MCP layer via `InMemoryTransport`
   (see `src/mcp/server.test.ts`), HTTP via real SDK client
   (see `src/mcp/http.integration.test.ts` — note the `asTransport` cast workaround).
5. Remove the `ping` tool once the real tools exist (and its tests).
6. Update STATUS.md; suggest one conventional commit per tool.

**Conventions that already bit us (respect them)**
- `exactOptionalPropertyTypes` is on: never pass `key: undefined` explicitly to SDK
  options — omit the key (spread pattern in `src/notion/client.ts` shows how).
- Tool descriptions are written for the LLM consuming them: say what the tool returns,
  what IDs it accepts, and when to use it vs a sibling tool.
- Zod input limits (max lengths, page_size bounds) are welcome now but the full
  hardening pass is phase 6.

## Deploy (Railway, Node runtime)

- Nixpacks default: `npm ci && npm run build && npm start`
- `GET /health` → 200, unauthenticated (Railway health check)
- Env vars set in Railway: `NOTION_TOKEN`, `MCP_API_KEY`
- A manual smoke-test script exercises the deployed server end-to-end against a real
  Notion workspace (reads URL, `MCP_API_KEY`, `NOTION_TOKEN` from env; not run in CI).
