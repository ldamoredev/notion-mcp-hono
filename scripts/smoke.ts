/**
 * End-to-end smoke test against a RUNNING server (local or deployed).
 * Run manually, never in CI — it talks to a real Notion workspace through
 * the server's NOTION_TOKEN. The script itself only needs:
 *
 *   MCP_URL       base URL of the server, e.g. https://xxx.up.railway.app
 *   MCP_API_KEY   bearer key the server expects
 *
 * Optional (skipped when unset):
 *   SMOKE_PARENT_PAGE_ID   enables create_page + append_blocks under this page
 *   SMOKE_DATABASE_ID      enables query_database against this database
 *   SMOKE_QUERY            search term for search_pages (default: "a")
 *
 * Usage: MCP_URL=... MCP_API_KEY=... npm run smoke
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MCP_URL = process.env.MCP_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;
if (!MCP_URL || !MCP_API_KEY) {
  console.error('Usage: MCP_URL=https://... MCP_API_KEY=... npm run smoke');
  process.exit(1);
}
const base = new URL(MCP_URL);

let failures = 0;

async function step(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    console.error(`❌ ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toolJson(result: CallToolResult): unknown {
  if (result.isError) {
    const text = result.content.find((c) => c.type === 'text')?.text ?? 'unknown tool error';
    throw new Error(`tool returned an error: ${text}`);
  }
  const text = result.content.find((c) => c.type === 'text')?.text;
  return text === undefined ? undefined : JSON.parse(text);
}

async function main(): Promise<void> {
  await step('GET /health is public and returns 200', async () => {
    const res = await fetch(new URL('/health', base));
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    return '';
  });

  await step('unauthenticated /mcp is rejected with 401', async () => {
    const res = await fetch(new URL('/mcp', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return '';
  });

  await step('GET / serves the landing page', async () => {
    const res = await fetch(base);
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const html = await res.text();
    if (!html.includes('notion-mcp-hono')) throw new Error('landing HTML marker missing');
    return `${Math.round(html.length / 1024)} KiB of HTML`;
  });

  await step('GET /demo/tools lists exactly the read-only tools', async () => {
    const res = await fetch(new URL('/demo/tools', base));
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = (await res.json()) as { tools: { name: string }[] };
    const names = body.tools.map((t) => t.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(['get_page', 'query_database', 'search_pages'])) {
      throw new Error(`got: ${names.join(', ')}`);
    }
    return '';
  });

  await step('POST /demo/run/search_pages runs against the demo workspace', async () => {
    const res = await fetch(new URL('/demo/run/search_pages', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'welcome' }),
    });
    if (res.status === 503) return 'demo disabled on this deployment (DEMO_NOTION_TOKEN unset)';
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { ok: boolean; result: { title: string }[] };
    return `${body.result.length} page(s)${body.result[0] ? `, first: "${body.result[0].title}"` : ''}`;
  });

  await step('write tools are unreachable through /demo/*', async () => {
    for (const tool of ['create_page', 'append_blocks']) {
      const res = await fetch(new URL(`/demo/run/${tool}`, base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parent_type: 'page', parent_id: 'x', title: 'x', page_id: 'x', markdown: 'x' }),
      });
      if (res.status !== 404) throw new Error(`${tool}: expected 404, got ${res.status}`);
    }
    return '';
  });

  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), {
    requestInit: { headers: { authorization: `Bearer ${MCP_API_KEY}` } },
  }) as Transport;

  await step('MCP initialize handshake', async () => {
    await client.connect(transport);
    return client.getServerVersion()?.name ?? '';
  });

  await step('tools/list exposes the 5 Notion tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    const expected = ['append_blocks', 'create_page', 'get_page', 'query_database', 'search_pages'];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`got: ${names.join(', ')}`);
    }
    return '';
  });

  let firstPageId: string | undefined;
  await step('search_pages returns results', async () => {
    const result = await client.callTool({
      name: 'search_pages',
      arguments: { query: process.env.SMOKE_QUERY ?? 'a', limit: 5 },
    });
    const pages = toolJson(result as CallToolResult) as Array<{ id: string; title: string }>;
    firstPageId = pages[0]?.id;
    return `${pages.length} page(s)${pages[0] ? `, first: "${pages[0].title}"` : ''}`;
  });

  await step('get_page returns markdown for the first search result', async () => {
    if (!firstPageId) throw new Error('skipped: search_pages returned no pages');
    const result = await client.callTool({ name: 'get_page', arguments: { page_id: firstPageId } });
    const page = toolJson(result as CallToolResult) as { title: string; markdown: string };
    return `"${page.title}", ${page.markdown.length} chars of markdown`;
  });

  const parentPageId = process.env.SMOKE_PARENT_PAGE_ID;
  if (parentPageId) {
    let createdPageId: string | undefined;
    await step('create_page under SMOKE_PARENT_PAGE_ID', async () => {
      const result = await client.callTool({
        name: 'create_page',
        arguments: {
          parent_type: 'page',
          parent_id: parentPageId,
          title: `Smoke test ${new Date().toISOString()}`,
          markdown: '# Smoke test\n\nCreated by scripts/smoke.ts — safe to delete.',
        },
      });
      const page = toolJson(result as CallToolResult) as { id: string; url: string | null };
      createdPageId = page.id;
      return page.url ?? page.id;
    });

    await step('append_blocks to the page just created', async () => {
      if (!createdPageId) throw new Error('skipped: create_page failed');
      const result = await client.callTool({
        name: 'append_blocks',
        arguments: { page_id: createdPageId, markdown: '- appended by the smoke test' },
      });
      toolJson(result as CallToolResult);
      return '';
    });
  } else {
    console.log('⏭️  create_page/append_blocks skipped (set SMOKE_PARENT_PAGE_ID to enable)');
  }

  const databaseId = process.env.SMOKE_DATABASE_ID;
  if (databaseId) {
    await step('query_database returns rows', async () => {
      const result = await client.callTool({
        name: 'query_database',
        arguments: { database_id: databaseId, page_size: 5 },
      });
      const data = toolJson(result as CallToolResult) as { rows: unknown[]; hasMore: boolean };
      return `${data.rows.length} row(s), hasMore=${data.hasMore}`;
    });
  } else {
    console.log('⏭️  query_database skipped (set SMOKE_DATABASE_ID to enable)');
  }

  await client.close();

  console.log(failures === 0 ? '\nSmoke test passed.' : `\nSmoke test FAILED (${failures} step(s)).`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
