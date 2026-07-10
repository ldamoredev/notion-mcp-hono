# Project status

Phased build — one review + commit per phase. See AGENTS.md for full context.

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Scaffold: repo, tsconfig, Vitest, Hono + `/health` | ✅ done | App factory pattern; PORT contract verified against built output |
| 2 | MCP skeleton: server init, capabilities, dummy tool over Streamable HTTP | ✅ done | Stateless mode via `@hono/mcp`; per-request server; GET/DELETE → 405; tested with real SDK client over HTTP + InMemoryTransport |
| 3 | Auth middleware: bearer token, timing-safe compare, tests | ✅ done | SHA-256-then-timingSafeEqual; `createApp({ mcpApiKey })` injects config; index.ts fails fast if env var missing |
| 4 | Notion layer: client wrapper + markdown conversion, tested | ✅ done | `NotionGateway` interface + SDK v5 adapter; markdown via Notion's native `retrieveMarkdown`/`updateMarkdown`; property simplification; typed `NotionError` |
| 5 | The 5 tools, TDD, one at a time | ✅ done | Exactly five tools; gateway injected through app/server; Zod-described inputs; actionable Notion errors returned in-band; fake-gateway MCP + HTTP integration coverage |
| 6 | Hardening: error taxonomy, input limits, logging, README | ✅ done | Tool runner (no internals leak to clients); JSON logs to stdout; 2 MiB body limit → 413; README; `npm run smoke` script verified against a local server |
| 7 | Deploy: Railway, verify /health, claude.ai connector, prod smoke test | 🔄 next | Needs: Railway service + env vars, health check path `/health`, public domain, claude.ai connector with Authorization header, `npm run smoke` against prod |
