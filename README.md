# notion-mcp-hono

A **remote MCP server** exposing Notion as tools — TypeScript, [Hono](https://hono.dev),
the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
over **Streamable HTTP**, deployed on Railway.

> Notion ships an official MCP server; this project is not trying to replace it.
> It is a portfolio piece demonstrating how to build a remote MCP server *properly*:
> focused scope, test-driven, authenticated, observable, and deployed.

## Tools

| Tool | What it does |
|------|--------------|
| `search_pages` | Search pages across the workspace by title |
| `get_page` | Retrieve one page as clean markdown |
| `create_page` | Create a page under a parent page or database |
| `append_blocks` | Append markdown to the end of an existing page |
| `query_database` | Query a database with Notion filters and sorts, rows simplified to flat JSON |

All tool inputs are validated with Zod (with size limits), all descriptions are written
for the LLM consuming them, and all Notion failures come back as actionable, in-band
error messages — never raw API errors.

## Architecture

```
                        ┌──────────────────────────────────────────────┐
 MCP client             │  notion-mcp-hono                             │
 (claude.ai /           │                                              │
  Claude Code)          │  Transport layer          MCP layer          │
     │                  │  ┌───────────────┐       ┌───────────────┐   │
     │ POST /mcp        │  │ Hono app      │       │ McpServer     │   │      Notion API
     ├─────────────────►│  │  bearer auth  ├──────►│  5 tools      │   │
     │ Authorization:   │  │  body limit   │       │  zod schemas  │   │
     │ Bearer <key>     │  │  req logging  │       │  tool runner  │   │
     │                  │  └───────────────┘       └───────┬───────┘   │
     │ GET /health      │        │                         │           │
     ├─────────────────►│   200, no auth          ┌────────▼────────┐  │
     │                  │                         │ Notion layer    │  │   ┌─────────┐
     │                  │                         │  NotionGateway  ├──┼──►│ Notion  │
     │                  │                         │  (interface)    │  │   └─────────┘
     │                  │                         │  SDK v5 adapter │  │
     │                  │                         └─────────────────┘  │
     └──────────────────┴──────────────────────────────────────────────┘
```

Three layers, dependency arrows pointing inward:

- **Transport** (`src/app.ts`, `src/auth.ts`) — Hono routes, bearer auth, body limit, request logging.
- **MCP** (`src/mcp/`) — server setup, the 5 tool registrations, the tool runner (error handling + per-call logging).
- **Notion** (`src/notion/`) — the `NotionGateway` interface (domain types only) and its `@notionhq/client` adapter. The MCP layer never imports the Notion SDK, so the integration is swappable without touching tool code.

## Quickstart (local)

```bash
git clone <this repo> && cd notion-mcp-hono
npm install
cp .env.example .env        # then fill in the two variables below
npm run dev                 # http://localhost:3000
```

You need two secrets in `.env` (or exported):

| Variable | What it is |
|----------|------------|
| `NOTION_TOKEN` | An internal integration token from [notion.so/my-integrations](https://www.notion.so/my-integrations). Share the pages/databases you want accessible with that integration (page → ⋯ → Connections). |
| `MCP_API_KEY` | The bearer key **clients of this server** must present. Generate one: `openssl rand -hex 32`. |

Check it's alive:

```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Authentication

Every request to `/mcp` requires:

```
Authorization: Bearer <MCP_API_KEY>
```

- Comparison is **timing-safe** (both sides are SHA-256-hashed, then `crypto.timingSafeEqual` — neither content nor length leaks through response timing).
- Missing/wrong token → `401` with a JSON body naming the expected header.
- `GET /health` is public (it's the deployment health check).

## Connecting from Claude

### claude.ai custom connector

Settings → Connectors → **Add custom connector**:

- **URL**: `https://<your-deployment>.up.railway.app/mcp`
- **Advanced settings → HTTP headers**: add `Authorization` = `Bearer <MCP_API_KEY>`

### Claude Code

```bash
claude mcp add --transport http notion-hono \
  https://<your-deployment>.up.railway.app/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```

Then `/mcp` inside Claude Code shows the connection; the five tools appear as
`mcp__notion-hono__*`.

## Deploy on Railway

1. Create a project from this repo (Railway dashboard → New Project → Deploy from GitHub repo). The default Nixpacks build works as-is: `npm ci && npm run build && npm start`.
2. Set the environment variables on the service:
   - `NOTION_TOKEN` — your Notion internal integration token
   - `MCP_API_KEY` — the bearer key for clients (generate: `openssl rand -hex 32`)
   - `DEMO_NOTION_TOKEN` (optional) — a second integration token for a **dedicated demo
     workspace**, powering the public playground at `/demo/*`. Leave it unset to disable
     the playground (its routes then respond `503`); never point it at a workspace with
     real data.

   `PORT` is injected by Railway automatically; the server reads it.
3. Set the service **health check path** to `/health`.
4. Generate a public domain (service → Settings → Networking) and use
   `https://<domain>/mcp` as the connector URL.

The server fails fast at boot with a clear message if either env var is missing.

## Smoke test (manual, not CI)

Exercises a running server end-to-end against a real Notion workspace:

```bash
MCP_URL=https://<your-deployment>.up.railway.app \
MCP_API_KEY=<key> \
SMOKE_PARENT_PAGE_ID=<page id>   # optional: enables create_page + append_blocks \
SMOKE_DATABASE_ID=<database id>  # optional: enables query_database \
npm run smoke
```

It verifies `/health`, the 401 on unauthenticated `/mcp`, the initialize handshake,
`tools/list`, and each tool (write tools only when their env var is set — pages it
creates are titled `Smoke test <timestamp>` and safe to delete).

## Development

```bash
npm test            # Vitest, all Notion calls mocked — no network
npm run test:watch
npm run typecheck   # strict, includes tests and scripts
npm run build       # compiles src/ to dist/
```

Tests run at three altitudes: pure functions (property simplification, auth, logger),
the MCP layer via `InMemoryTransport` with a fake gateway, and full HTTP integration
using the real MCP SDK client against the Hono app on an ephemeral port.

## Design decisions

- **Streamable HTTP, stateless mode.** This is a remote server, so stdio is out. Of Streamable HTTP's two modes we run stateless: a fresh `McpServer` + transport per request, no `Mcp-Session-Id`, no session map. Every tool is pure request/response, so sessions would only buy horizontal-scaling problems. Consequently `GET`/`DELETE /mcp` return `405` (nothing to stream or terminate).
- **Markdown conversion is delegated to Notion.** Notion's 2025-09-03 API has native markdown endpoints (`pages.retrieveMarkdown`, `pages.updateMarkdown`). Hand-rolling a blocks↔markdown converter is an entire class of fidelity bugs this project chose not to own.
- **`NotionGateway` interface as the seam.** MCP tools depend on a 5-method interface speaking domain types (markdown strings, flat property values). The `@notionhq/client` adapter — including the `database_id` → data-source resolution the 2025 API requires — is invisible to tool code and replaceable without touching it.
- **Errors are a UX surface for the model.** Zod validation failures and Notion errors return *in-band* (`isError: true`) with messages that say what to fix ("share the page with the integration via ⋯ → Connections"), so the calling LLM can self-correct. Unexpected errors return a generic in-band message and are logged server-side — raw internals never reach the client.
- **Auth is boring on purpose.** One static bearer key, timing-safe compare, injected via `createApp({ mcpApiKey })` so tests never touch `process.env`. OAuth is the spec's long-term answer for multi-user servers; for a single-workspace personal server it's complexity without benefit.
- **Structured logs to stdout.** One JSON line per HTTP request and per tool call (name, outcome, duration — never arguments, which can contain page content). Railway captures stdout; `/health` is excluded so the poller doesn't drown the signal.

## License

MIT
