/**
 * Flattens Notion's deeply nested property objects into plain JSON values an
 * LLM can read at a glance. Input is typed loosely (values arrive from API
 * responses) and narrowed at runtime; unsupported types become null rather
 * than leaking raw objects.
 */

interface TextSpan {
  plain_text?: string;
}

interface Named {
  name?: string | null;
}

export function plainText(spans: TextSpan[] | undefined): string {
  return (spans ?? []).map((s) => s.plain_text ?? '').join('');
}

export function simplifyProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [name, simplifyValue(value)]),
  );
}

export function pageTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    const v = value as { type?: string; title?: TextSpan[] };
    if (v?.type === 'title') {
      const text = plainText(v.title);
      if (text) return text;
    }
  }
  return 'Untitled';
}

function simplifyValue(value: unknown): unknown {
  const v = value as Record<string, unknown> & { type?: string };
  switch (v?.type) {
    case 'title':
      return plainText(v.title as TextSpan[]) || null;
    case 'rich_text':
      return plainText(v.rich_text as TextSpan[]) || null;
    case 'number':
      return v.number ?? null;
    case 'checkbox':
      return v.checkbox ?? null;
    case 'url':
      return v.url ?? null;
    case 'email':
      return v.email ?? null;
    case 'phone_number':
      return v.phone_number ?? null;
    case 'select':
      return (v.select as Named | null)?.name ?? null;
    case 'status':
      return (v.status as Named | null)?.name ?? null;
    case 'multi_select':
      return ((v.multi_select as Named[] | null) ?? []).map((o) => o.name ?? '');
    case 'people':
      return ((v.people as Named[] | null) ?? []).map((p) => p.name ?? 'unknown');
    case 'date':
      return simplifyDate(v.date as { start?: string; end?: string | null } | null);
    case 'formula':
      return simplifyFormula(v.formula as Record<string, unknown> & { type?: string });
    case 'created_time':
      return v.created_time ?? null;
    case 'last_edited_time':
      return v.last_edited_time ?? null;
    case 'unique_id': {
      const uid = v.unique_id as { prefix?: string | null; number?: number | null } | null;
      if (uid?.number == null) return null;
      return uid.prefix ? `${uid.prefix}-${uid.number}` : uid.number;
    }
    case 'relation':
      return ((v.relation as { id?: string }[] | null) ?? []).map((r) => r.id);
    default:
      return null;
  }
}

function simplifyDate(date: { start?: string; end?: string | null } | null): string | null {
  if (!date?.start) return null;
  return date.end ? `${date.start} → ${date.end}` : date.start;
}

function simplifyFormula(
  formula: (Record<string, unknown> & { type?: string }) | null,
): unknown {
  if (!formula?.type) return null;
  switch (formula.type) {
    case 'string':
      return formula.string ?? null;
    case 'number':
      return formula.number ?? null;
    case 'boolean':
      return formula.boolean ?? null;
    case 'date':
      return simplifyDate(formula.date as { start?: string; end?: string | null } | null);
    default:
      return null;
  }
}
