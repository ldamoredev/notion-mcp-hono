# Project status

Phased build — one review + commit per phase. See AGENTS.md for full context.

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Scaffold: repo, tsconfig, Vitest, Hono + `/health` | ✅ done | App factory pattern; PORT contract verified against built output |
| 2 | MCP skeleton: server init, capabilities, dummy tool over Streamable HTTP | ✅ done | Stateless mode via `@hono/mcp`; per-request server; GET/DELETE → 405; tested with real SDK client over HTTP + InMemoryTransport |
| 3 | Auth middleware: bearer token, timing-safe compare, tests | ✅ done | SHA-256-then-timingSafeEqual; `createApp({ mcpApiKey })` injects config; index.ts fails fast if env var missing |
| 4 | Notion layer: client wrapper + markdown conversion, tested | ✅ done | `NotionGateway` interface + SDK v5 adapter; markdown via Notion's native `retrieveMarkdown`/`updateMarkdown`; property simplification; typed `NotionError` |
| 5 | The 5 tools, TDD, one at a time | 🔄 next — owner: Codex | search_pages, get_page, create_page, append_blocks, query_database. **Read "Phase 5 handoff" in AGENTS.md first.** |
| 6 | Hardening: error taxonomy, input limits, logging, README | ⬜ pending | |
| 7 | Deploy: Railway, verify /health, claude.ai connector, prod smoke test | ⬜ pending | |
