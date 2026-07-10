import { describe, expect, it } from 'vitest';
import { pageTitle, simplifyProperties } from './properties.js';

describe('simplifyProperties', () => {
  it('flattens common property types to plain values', () => {
    const result = simplifyProperties({
      Name: { id: 'title', type: 'title', title: [{ plain_text: 'My task' }] },
      Notes: {
        id: 'a',
        type: 'rich_text',
        rich_text: [{ plain_text: 'Some ' }, { plain_text: 'notes' }],
      },
      Points: { id: 'b', type: 'number', number: 5 },
      Status: { id: 'c', type: 'status', status: { name: 'In progress' } },
      Priority: { id: 'd', type: 'select', select: { name: 'High' } },
      Tags: { id: 'e', type: 'multi_select', multi_select: [{ name: 'api' }, { name: 'bug' }] },
      Done: { id: 'f', type: 'checkbox', checkbox: false },
      Due: { id: 'g', type: 'date', date: { start: '2026-07-01', end: null } },
      Link: { id: 'h', type: 'url', url: 'https://example.com' },
      Mail: { id: 'i', type: 'email', email: 'a@b.co' },
    });

    expect(result).toEqual({
      Name: 'My task',
      Notes: 'Some notes',
      Points: 5,
      Status: 'In progress',
      Priority: 'High',
      Tags: ['api', 'bug'],
      Done: false,
      Due: '2026-07-01',
      Link: 'https://example.com',
      Mail: 'a@b.co',
    });
  });

  it('renders date ranges as "start → end"', () => {
    const result = simplifyProperties({
      Sprint: { id: 'g', type: 'date', date: { start: '2026-07-01', end: '2026-07-14' } },
    });

    expect(result).toEqual({ Sprint: '2026-07-01 → 2026-07-14' });
  });

  it('maps empty values to null', () => {
    const result = simplifyProperties({
      Points: { id: 'b', type: 'number', number: null },
      Priority: { id: 'd', type: 'select', select: null },
      Due: { id: 'g', type: 'date', date: null },
      Empty: { id: 'x', type: 'rich_text', rich_text: [] },
    });

    expect(result).toEqual({ Points: null, Priority: null, Due: null, Empty: null });
  });

  it('maps people to their names and formulas to their values', () => {
    const result = simplifyProperties({
      Owner: { id: 'p', type: 'people', people: [{ name: 'Ada' }, { name: 'Grace' }] },
      Score: { id: 'q', type: 'formula', formula: { type: 'number', number: 42 } },
      Label: { id: 'r', type: 'formula', formula: { type: 'string', string: 'high' } },
    });

    expect(result).toEqual({ Owner: ['Ada', 'Grace'], Score: 42, Label: 'high' });
  });

  it('maps unsupported property types to null instead of leaking raw objects', () => {
    const result = simplifyProperties({
      Weird: { id: 'z', type: 'rollup', rollup: { type: 'array', array: [] } },
    });

    expect(result).toEqual({ Weird: null });
  });
});

describe('pageTitle', () => {
  it('finds the title property regardless of its column name', () => {
    const title = pageTitle({
      Estado: { id: 'c', type: 'status', status: { name: 'Done' } },
      Tarea: { id: 'title', type: 'title', title: [{ plain_text: 'Comprar ' }, { plain_text: 'pan' }] },
    });

    expect(title).toBe('Comprar pan');
  });

  it('falls back to "Untitled" when there is no title text', () => {
    expect(pageTitle({})).toBe('Untitled');
    expect(pageTitle({ Name: { id: 'title', type: 'title', title: [] } })).toBe('Untitled');
  });
});
