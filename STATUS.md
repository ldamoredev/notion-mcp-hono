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
| 7 | Deploy: Railway, verify /health, claude.ai connector, prod smoke test | ✅ done | Live at https://notion-mcp-hono-production.up.railway.app — prod smoke test passed: health, 401, handshake, tools/list, search_pages, get_page, create_page, append_blocks. query_database verified in tests only (no database shared yet). Claude Code connected as `notion-hono` |

## Landing page + live playground (second build)

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 8 | Static landing at `GET /`: hero, architecture diagram, tool cards, connect section | ✅ done | `public/` served via `@hono/node-server` serveStatic (cwd-relative, ships uncompiled); routes added after logging middleware, `/mcp` chain untouched (regression-tested); brand: #0E1A2E / #4E9BE8 / dashed=external motif; verified desktop + 390px mobile in Chrome |
| 9 | Demo routes: `POST /demo/run/:tool`, read-only allowlist, in-memory rate limiter, `DEMO_NOTION_TOKEN` wiring, tests | ✅ done | Closed-map allowlist (write tools have no entry — structurally unreachable, fuzz-tested incl. `__proto__`); zod shapes shared with the MCP tools (exported from the 3 read tool modules); fixed-window limiter 10/min per x-forwarded-for IP, injectable clock; demo gateway is a second `NotionGateway` — tests prove the real gateway is never called; unset token → 503; errors: zod→400, NotionError→502 curated, else→500 generic + server log; 32 KiB body limit |
| 10 | Playground UI wired to the demo routes | ✅ done | `GET /demo/tools` serves name/description/JSON Schema via `z.toJSONSchema` from the same zod shapes (single source of truth); vanilla JS builds the forms from it — data enters the DOM via textContent only; human view per tool (result list / markdown / table) + raw JSON + JSON-RPC `tools/call` payload side by side; `scripts/preview.ts` runs the UI offline with an in-memory gateway; verified happy paths + NotionError state in Chrome |
| 11 | Polish: mobile states, loading/error/empty, favicon, meta/OG | ✅ done | Favicon SVG (dashed→solid chevrons); OG card 1200×630 rendered via headless Chrome from branded HTML; canonical/theme-color/twitter meta; Cache-Control (assets 1h, HTML no-cache — set before delegating to serveStatic, its onFound runs after the Response is built); fixed `background-attachment: fixed` (broken on iOS) and flex min-width overflow in the hero pill; copy buttons on connect blocks; "open in get_page →" on search results; aria-live output; verified at true 390px via CDP emulation (headless `--window-size` clamps at 500) |
| 12 | Deploy + verify: MCP auth intact, `/` renders, playground hits demo workspace | ⬜ next | Set `DEMO_NOTION_TOKEN` in Railway |
