/* Live playground: builds forms from /demo/tools (JSON Schema derived from the
   server's zod shapes), runs read-only tools via POST /demo/run/:tool, and shows
   the equivalent MCP JSON-RPC payload. All Notion data enters the DOM through
   textContent — never innerHTML. */
(() => {
  'use strict';

  const root = document.querySelector('[data-playground]');
  if (!root) return;

  const PLACEHOLDERS = {
    query: 'e.g. welcome',
    limit: '1–100 (optional)',
    page_id: 'paste a page ID from search_pages',
    database_id: 'paste a database ID',
    filter: '{ "property": "Status", "select": { "equals": "Done" } }',
    sorts: '[ { "property": "Name", "direction": "ascending" } ]',
    page_size: '1–100 (optional)',
    start_cursor: 'nextCursor from a previous run (optional)',
  };

  const state = { tools: [], active: null, requestId: 0 };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function init() {
    fetch('/demo/tools')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body) => {
        state.tools = body.tools;
        renderShell();
        selectTool(state.tools[0].name);
      })
      .catch(() => {
        root.replaceChildren(
          el('p', 'pg-boot-error', 'Could not load the playground tools. Refresh to retry.'),
        );
      });
  }

  /* ---------- shell ---------- */

  let tablist;
  let toolDescription;
  let form;
  let fieldsBox;
  let runButton;
  let outputBox;

  function renderShell() {
    tablist = el('div', 'pg-tabs');
    tablist.setAttribute('role', 'tablist');
    for (const tool of state.tools) {
      const tab = el('button', 'pg-tab', tool.name);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset.tool = tool.name;
      tab.addEventListener('click', () => selectTool(tool.name));
      tablist.append(tab);
    }

    toolDescription = el('p', 'pg-tool-desc');
    fieldsBox = el('div', 'pg-fields');
    runButton = el('button', 'btn btn-primary pg-run', 'Run tool');
    runButton.type = 'submit';

    form = el('form', 'pg-form');
    form.append(toolDescription, fieldsBox, runButton);
    form.addEventListener('submit', onSubmit);

    outputBox = el('div', 'pg-output');
    outputBox.setAttribute('aria-live', 'polite');
    renderIdle();

    const panel = el('div', 'pg-panel');
    panel.append(form, outputBox);
    root.replaceChildren(tablist, panel);
  }

  function selectTool(name) {
    state.active = state.tools.find((t) => t.name === name);
    for (const tab of tablist.querySelectorAll('.pg-tab')) {
      tab.classList.toggle('is-active', tab.dataset.tool === name);
      tab.setAttribute('aria-selected', String(tab.dataset.tool === name));
    }
    toolDescription.textContent = state.active.description;
    renderFields(state.active);
    renderIdle();
  }

  /* ---------- form from JSON Schema ---------- */

  function renderFields(tool) {
    fieldsBox.replaceChildren();
    const schema = tool.inputSchema;
    const required = schema.required || [];

    for (const [name, prop] of Object.entries(schema.properties || {})) {
      const isJson = prop.type === 'object' || prop.type === 'array';
      const isNumber = prop.type === 'integer' || prop.type === 'number';

      const label = el('label', 'pg-field');
      const caption = el('span', 'pg-field-name');
      caption.append(
        el('code', null, name),
        el('span', 'pg-field-kind', fieldKind(prop, required.includes(name))),
      );

      let input;
      if (isJson) {
        input = el('textarea', 'pg-input pg-input-json');
        input.rows = 3;
        input.spellcheck = false;
      } else {
        input = el('input', 'pg-input');
        input.type = isNumber ? 'number' : 'text';
        if (isNumber) {
          if (prop.minimum !== undefined) input.min = String(prop.minimum);
          if (prop.maximum !== undefined) input.max = String(prop.maximum);
        }
      }
      input.name = name;
      input.placeholder = PLACEHOLDERS[name] || '';
      if (required.includes(name)) input.required = true;

      label.append(caption, input);
      if (prop.description) label.append(el('span', 'pg-field-help', prop.description));
      fieldsBox.append(label);
    }
  }

  function fieldKind(prop, isRequired) {
    const kind =
      prop.type === 'object' ? 'JSON object'
      : prop.type === 'array' ? 'JSON array'
      : prop.type === 'integer' ? 'integer'
      : prop.type || 'value';
    return isRequired ? kind : `${kind} · optional`;
  }

  function collectArguments() {
    const args = {};
    for (const input of fieldsBox.querySelectorAll('.pg-input')) {
      const raw = input.value.trim();
      input.setCustomValidity('');
      if (raw === '') continue;
      if (input.classList.contains('pg-input-json')) {
        try {
          args[input.name] = JSON.parse(raw);
        } catch {
          input.setCustomValidity('Must be valid JSON.');
          input.reportValidity();
          return null;
        }
      } else if (input.type === 'number') {
        args[input.name] = Number(raw);
      } else {
        args[input.name] = raw;
      }
    }
    return args;
  }

  /* ---------- run ---------- */

  function onSubmit(event) {
    event.preventDefault();
    const tool = state.active;
    const args = collectArguments();
    if (args === null) return;

    const rpc = {
      jsonrpc: '2.0',
      id: ++state.requestId,
      method: 'tools/call',
      params: { name: tool.name, arguments: args },
    };

    runButton.disabled = true;
    runButton.textContent = 'Running…';
    renderOutput({ loading: true, rpc });

    fetch(`/demo/run/${tool.name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
      .then(async (res) => ({ status: res.status, body: await res.json() }))
      .catch(() => ({ status: 0, body: { message: 'Network error — check your connection and retry.' } }))
      .then(({ status, body }) => {
        runButton.disabled = false;
        runButton.textContent = 'Run tool';
        if (status === 200) {
          renderOutput({ tool: tool.name, result: body.result, rpc });
        } else {
          renderOutput({
            error: body.message || `Request failed (HTTP ${status}).`,
            rateLimited: status === 429,
            rpc,
          });
        }
      });
  }

  /* ---------- output ---------- */

  function renderIdle() {
    outputBox.replaceChildren(
      el('p', 'pg-idle', 'Fill the form and run the tool — the result and the MCP call appear here.'),
    );
  }

  function renderOutput({ loading, error, rateLimited, tool, result, rpc }) {
    const panes = [];

    if (loading) {
      panes.push(el('p', 'pg-idle', 'Running against the demo workspace…'));
    } else if (error !== undefined) {
      const box = el('div', rateLimited ? 'pg-error pg-error-rate' : 'pg-error');
      box.append(el('strong', null, rateLimited ? 'Rate limited' : 'Error'), el('p', null, error));
      panes.push(box);
    } else {
      panes.push(humanView(tool, result));
    }

    const grid = el('div', 'pg-pane-grid');
    if (!loading && error === undefined) {
      grid.append(pane('Raw JSON response', jsonPre(result)));
    }
    grid.append(pane('Equivalent MCP call (JSON-RPC)', jsonPre(rpc)));

    outputBox.replaceChildren(...panes, grid);
  }

  function pane(title, content) {
    const box = el('details', 'pg-pane');
    box.open = true;
    const summary = el('summary', 'pg-pane-title', title);
    box.append(summary, content);
    return box;
  }

  function jsonPre(value) {
    const pre = el('pre', 'pg-json');
    pre.textContent = JSON.stringify(value, null, 2);
    return pre;
  }

  /* ---------- human-friendly renderings ---------- */

  function humanView(tool, result) {
    if (tool === 'search_pages') return searchView(result);
    if (tool === 'get_page') return pageView(result);
    if (tool === 'query_database') return databaseView(result);
    return jsonPre(result);
  }

  function searchView(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return el('p', 'pg-empty', 'No pages matched — try another query.');
    }
    const list = el('ul', 'pg-results');
    for (const item of items) {
      const li = el('li');
      const title = item.url ? el('a', 'pg-result-title', item.title || '(untitled)') : el('span', 'pg-result-title', item.title || '(untitled)');
      if (item.url) {
        title.href = item.url;
        title.rel = 'noopener';
        title.target = '_blank';
      }
      const meta = el('span', 'pg-result-meta', `${item.id} · edited ${formatDate(item.lastEditedTime)}`);
      const useId = el('button', 'pg-use-id', 'open in get_page →');
      useId.type = 'button';
      useId.addEventListener('click', () => {
        selectTool('get_page');
        const input = fieldsBox.querySelector('input[name="page_id"]');
        if (input) {
          input.value = item.id;
          input.focus();
        }
      });
      li.append(title, meta, useId);
      list.append(li);
    }
    return list;
  }

  function pageView(page) {
    const box = el('div', 'pg-page');
    box.append(el('h4', 'pg-page-title', page.title || '(untitled)'));
    if (page.truncated) {
      box.append(el('p', 'pg-empty', 'Content truncated by Notion — the page is very large.'));
    }
    box.append(page.markdown ? markdownView(page.markdown) : el('p', 'pg-empty', '(empty page)'));
    return box;
  }

  /* ---------- minimal markdown renderer ----------
     Everything is built with createElement/textContent — page content from
     Notion never touches innerHTML, so it cannot inject markup. Links are
     restricted to http(s) URLs by the inline pattern. */

  function markdownView(md) {
    const root = el('div', 'pg-md');
    const lines = md.split('\n');
    let list = null;
    const closeList = () => {
      list = null;
    };
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        const buf = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1;
        closeList();
        const pre = el('pre', 'pg-md-code');
        pre.textContent = buf.join('\n');
        root.append(pre);
        continue;
      }

      // Notion markdown artifacts: skip structural tags, keep their content.
      if (trimmed === '<empty-block/>' || trimmed === '<details>' || trimmed === '</details>') {
        i += 1;
        continue;
      }
      const summary = trimmed.match(/^<summary>(.*)<\/summary>$/);
      if (summary) {
        closeList();
        root.append(el('p', 'pg-md-summary', `▸ ${summary[1]}`));
        i += 1;
        continue;
      }
      const pageTag = trimmed.match(/^<(page|database) url="(https?:\/\/[^"]+)"[^>]*>(.*)<\/\1>$/);
      if (pageTag) {
        closeList();
        const p = el('p', 'pg-md-pagelink');
        const label = pageTag[3] || (pageTag[1] === 'database' ? 'Database' : 'Page');
        const a = el('a', null, `↳ ${label}`);
        a.href = pageTag[2];
        a.rel = 'noopener';
        a.target = '_blank';
        p.append(a);
        root.append(p);
        i += 1;
        continue;
      }

      // Any other purely structural tag line from Notion: skip, never print raw.
      if (/^<\/?[a-z][^>]*>$/.test(trimmed)) {
        i += 1;
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        const h = el('p', `pg-md-h pg-md-h${Math.min(heading[1].length, 3)}`);
        h.append(...inlineNodes(heading[2]));
        root.append(h);
        i += 1;
        continue;
      }

      if (/^(---+|\*\*\*+)$/.test(trimmed)) {
        closeList();
        root.append(el('hr', 'pg-md-hr'));
        i += 1;
        continue;
      }

      const quote = trimmed.match(/^>\s?(.*)$/);
      if (quote) {
        closeList();
        const q = el('blockquote', 'pg-md-quote');
        q.append(...inlineNodes(quote[1]));
        root.append(q);
        i += 1;
        continue;
      }

      const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
      const bullet = task ? null : line.match(/^\s*[-*]\s+(.*)$/);
      const ordered = task || bullet ? null : line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (task || bullet || ordered) {
        const type = ordered ? 'ol' : 'ul';
        if (!list || list.type !== type) {
          list = { type, box: el(type, 'pg-md-list') };
          root.append(list.box);
        }
        const li = el('li');
        if (task) {
          li.className = 'pg-md-task';
          li.append(el('span', task[1].trim() ? 'pg-md-check is-done' : 'pg-md-check', task[1].trim() ? '☑' : '☐'));
          li.append(...inlineNodes(task[2]));
        } else {
          li.append(...inlineNodes((bullet || ordered)[1]));
        }
        list.box.append(li);
        i += 1;
        continue;
      }

      if (trimmed === '') {
        closeList();
        i += 1;
        continue;
      }

      closeList();
      const p = el('p', 'pg-md-p');
      p.append(...inlineNodes(trimmed));
      root.append(p);
      i += 1;
    }
    return root;
  }

  const INLINE_TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;

  function inlineNodes(text) {
    const nodes = [];
    let rest = text;
    while (rest.length > 0) {
      const match = rest.match(INLINE_TOKEN);
      if (!match) {
        nodes.push(document.createTextNode(rest));
        break;
      }
      if (match.index > 0) nodes.push(document.createTextNode(rest.slice(0, match.index)));
      const token = match[0];
      if (token.startsWith('`')) {
        nodes.push(el('code', 'pg-md-inline-code', token.slice(1, -1)));
      } else if (token.startsWith('**')) {
        const strong = el('strong');
        strong.append(...inlineNodes(token.slice(2, -2)));
        nodes.push(strong);
      } else if (token.startsWith('[')) {
        const a = el('a', null, match[4]);
        a.href = match[5];
        a.rel = 'noopener';
        a.target = '_blank';
        nodes.push(a);
      } else {
        const em = el('em');
        em.append(...inlineNodes(token.slice(1, -1)));
        nodes.push(em);
      }
      rest = rest.slice(match.index + token.length);
    }
    return nodes;
  }

  function databaseView(data) {
    const rows = (data && data.rows) || [];
    if (rows.length === 0) {
      return el('p', 'pg-empty', 'The query returned no rows.');
    }

    const columns = [];
    for (const row of rows) {
      for (const key of Object.keys(row.properties || {})) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
    const shown = columns.slice(0, 5);

    const wrap = el('div', 'pg-table-wrap');
    const table = el('table', 'pg-table');
    const head = el('tr');
    head.append(el('th', null, 'Title'));
    for (const column of shown) head.append(el('th', null, column));
    table.append(head);

    for (const row of rows) {
      const tr = el('tr');
      tr.append(el('td', null, row.title || '(untitled)'));
      for (const column of shown) tr.append(el('td', null, cellText((row.properties || {})[column])));
      table.append(tr);
    }
    wrap.append(table);

    const box = el('div');
    box.append(wrap);
    if (data.hasMore) {
      box.append(el('p', 'pg-empty', `More rows available — pass start_cursor: ${data.nextCursor}`));
    }
    return box;
  }

  function cellText(value) {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value)) return value.map(cellText).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.valueOf()) ? '?' : date.toISOString().slice(0, 10);
  }

  init();

  /* ---------- copy affordances ---------- */

  function wireCopy(btn, getText) {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(getText()).then(() => {
        btn.textContent = 'copied ✓';
        btn.classList.add('is-copied');
        setTimeout(() => {
          btn.textContent = 'copy';
          btn.classList.remove('is-copied');
        }, 1600);
      });
    });
  }

  // The button must live OUTSIDE the pre: pre scrolls horizontally, and
  // absolutely-positioned children of a scroll container travel with the
  // content. The wrapper stays put, so the end-cap does too.
  for (const block of document.querySelectorAll('.connect-card pre')) {
    const wrap = el('div', 'codeblock');
    block.replaceWith(wrap);
    wrap.append(block);
    const btn = el('button', 'copy-btn', 'copy');
    btn.type = 'button';
    wireCopy(btn, () => block.querySelector('code').textContent);
    wrap.append(btn);
  }

  for (const btn of document.querySelectorAll('button[data-copy]')) {
    wireCopy(btn, () => btn.dataset.copy);
  }

  /* ---------- heartbeat: "live" is demonstrably true ----------
     Pings /health (excluded from server request logs) and only shows the
     green pulse while the server actually answers. */

  const beat = document.querySelector('[data-heartbeat]');
  if (beat) {
    const ping = () =>
      fetch('/health')
        .then((res) => beat.classList.toggle('is-live', res.ok))
        .catch(() => beat.classList.remove('is-live'));
    ping();
    setInterval(ping, 30_000);
  }

  /* ---------- theme toggle (initial theme is set pre-paint in <head>) ---------- */

  const toggle = document.querySelector('[data-theme-toggle]');
  if (toggle) {
    const themeColor = { dark: '#080a14', light: '#f4f5fb' };
    const syncMeta = () => {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = themeColor[document.documentElement.dataset.theme] || themeColor.dark;
    };
    syncMeta();
    toggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('theme', next);
      syncMeta();
    });
  }
})();
