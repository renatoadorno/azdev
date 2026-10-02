import { describe, expect, it } from 'bun:test';
import { DEFAULT_HISTORY_FIELDS, revisionTimeline } from '../src/services/history';

const by = { displayName: 'Renato Adorno', uniqueName: 'renato@x.dev' };
const rev = (n: number, fields: Record<string, unknown>) => ({
  rev: n,
  fields: { 'System.ChangedDate': `2026-09-0${n}T12:00:00Z`, 'System.ChangedBy': by, 'System.Rev': n, ...fields },
});

describe('revisionTimeline', () => {
  const revisions = [
    rev(1, { 'System.State': 'New', 'System.Title': 'Testes' }),
    rev(2, { 'System.State': 'New', 'System.Title': 'Testes', 'System.AssignedTo': by }),
    rev(3, { 'System.State': 'New', 'System.Title': 'Testes', 'System.AssignedTo': by, 'System.Watermark': 99 }),
    rev(4, { 'System.State': 'Done', 'System.Title': 'Testes', 'System.AssignedTo': by, 'System.History': '<div>ok</div><div>feito</div>' }),
  ];

  it('lists only what changed in each revision, identities as names', () => {
    expect(revisionTimeline(revisions, DEFAULT_HISTORY_FIELDS)).toEqual([
      { rev: 1, date: '2026-09-01T12:00:00.000Z', by: 'Renato Adorno', changes: 'State: ∅ → New | Title: ∅ → Testes' },
      { rev: 2, date: '2026-09-02T12:00:00.000Z', by: 'Renato Adorno', changes: 'AssignedTo: ∅ → Renato Adorno' },
      { rev: 4, date: '2026-09-04T12:00:00.000Z', by: 'Renato Adorno', changes: 'State: New → Done', comment: 'ok feito' },
    ]);
  });

  it('skips revisions that only touched bookkeeping fields', () => {
    expect(revisionTimeline(revisions, undefined).map(e => e.rev)).toEqual([1, 2, 4]);
  });

  it('follows every field when fields is undefined, not just the defaults', () => {
    const custom = [rev(1, { 'Custom.Cliente': 'A' }), rev(2, { 'Custom.Cliente': 'B' })];
    expect(revisionTimeline(custom, DEFAULT_HISTORY_FIELDS)).toEqual([]);
    expect(revisionTimeline(custom, undefined).map(e => e.changes)).toEqual(['Cliente: ∅ → A', 'Cliente: A → B']);
  });

  it('follows only the requested fields, by short or full name', () => {
    expect(revisionTimeline(revisions, ['state']).map(e => e.changes)).toEqual(['State: ∅ → New', 'State: New → Done']);
    expect(revisionTimeline(revisions, ['System.AssignedTo']).map(e => e.rev)).toEqual([2, 4]);
  });

  it('truncates long values', () => {
    const long = [rev(1, { 'System.Description': 'x'.repeat(50) })];
    expect(revisionTimeline(long, ['Description'], 10)[0]!.changes).toBe(`Description: ∅ → ${'x'.repeat(10)}…`);
  });
});
