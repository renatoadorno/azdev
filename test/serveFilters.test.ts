import { describe, expect, it } from 'bun:test';
import type { Card, ItemFilter } from '../src/interfaces/Serve';
import { createCardContext, toCard } from '../src/serve/cards';
import { matchContext, parseItemsQuery, queryCards, resolveSprintPaths } from '../src/serve/filters';
import { buildMeta } from '../src/serve/meta';
import { ProtocolError } from '../src/serve/protocol';
import { ItemStore } from '../src/serve/store';
import { ANA, NOW, ORG, PROJECT, RAW_META, item } from './serveFixtures';

const meta = buildMeta(RAW_META, { orgUrl: ORG, project: PROJECT, now: NOW });

const store = new ItemStore();
store.upsert([
  item(100, { type: 'Product Backlog Item', state: 'Committed', title: 'Integração de pagamento', assignee: ANA, tags: 'api' }),
  item(1, { parent: 100, state: 'In Progress', title: 'Revisão da ação de estorno', tags: 'backend; API', priority: 1, changedAt: '2026-10-31T09:00:00.000Z' }),
  item(2, { parent: 100, state: 'Done', title: 'Teste', priority: 2, changedAt: '2026-10-29T09:00:00.000Z' }),
  item(3, { state: 'To Do', assignee: null, sprint: 'Demo\\Sprint 81', area: 'Demo', changedAt: '2026-10-10T09:00:00.000Z' }),
  item(4, { state: 'Removed', assignee: ANA, sprint: 'Demo\\Sprint 80', area: 'Demo\\Backend\\Api' }),
]);
const context = createCardContext(meta, store, NOW);
const cards: Card[] = store.all().map(i => toCard(i, context));

function run(params: Record<string, unknown>) {
  const query = parseItemsQuery(params);
  return queryCards(cards, query, matchContext(query.filter, meta, NOW));
}
const ids = (filter: ItemFilter) => run({ filter, sort: ['id'] }).items.map(c => c.id);

function invalidRequest(fn: () => unknown): ProtocolError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).kind).toBe('invalid_request');
    return err as ProtocolError;
  }
  throw new Error('expected invalid_request');
}

describe('parseItemsQuery', () => {
  it('fills the defaults', () => {
    expect(parseItemsQuery({})).toEqual({ filter: {}, sort: [{ field: 'changedAt', descending: true }], limit: 200, offset: 0, facets: [] });
  });

  it('accepts a single value where a list is expected and always keeps id in fields', () => {
    const query = parseItemsQuery({ filter: { state: 'Done', parent: 100 }, fields: ['title'] });
    expect(query.filter).toEqual({ state: ['Done'], parent: [100] });
    expect(query.fields).toEqual(['id', 'title']);
  });

  it.each([
    ['an unknown filter key', { filter: { status: 'Done' } }, 'Unknown filter key "status"'],
    ['a non-boolean open', { filter: { open: 'yes' } }, 'filter.open'],
    ['an empty state list', { filter: { state: [] } }, 'filter.state'],
    ['a parent that is not an id', { filter: { parent: ['x'] } }, 'filter.parent'],
    ['a bad changedSince', { filter: { changedSince: 'last week' } }, 'filter.changedSince'],
    ['an unknown sort field', { sort: ['-mood'] }, 'Cannot sort by "-mood"'],
    ['unknown fields', { fields: ['title', 'mood'] }, '"fields"'],
    ['a limit past the maximum', { limit: 5000 }, '"limit"'],
    ['a negative offset', { offset: -1 }, '"offset"'],
    ['an unknown facet', { facets: ['mood'] }, '"facets"'],
  ])('refuses %s', (_case, params, message) => {
    expect(invalidRequest(() => parseItemsQuery(params as Record<string, unknown>)).message).toContain(message);
  });
});

describe('filters', () => {
  it('by assignee: me, none, any or an account', () => {
    expect(ids({ assignee: ['@me'] })).toEqual([1, 2]);
    expect(ids({ assignee: ['none'] })).toEqual([3]);
    expect(ids({ assignee: ['ana@acme.com'] })).toEqual([4, 100]);
    expect(ids({ assignee: ['any'] })).toEqual([1, 2, 3, 4, 100]);
    expect(ids({ assignee: ['@me', 'none'] })).toEqual([1, 2, 3]);
  });

  it('by sprint: current, previous, a number, a name or a path', () => {
    expect(ids({ sprint: ['current'] })).toEqual([1, 2, 100]);
    expect(ids({ sprint: ['previous'] })).toEqual([3]);
    expect(ids({ sprint: ['80'] })).toEqual([4]);
    expect(ids({ sprint: ['Sprint 81', 'demo\\sprint 80'] })).toEqual([3, 4]);
  });

  it('refuses a sprint it cannot find, suggesting names', () => {
    const err = invalidRequest(() => resolveSprintPaths(['Sprint 8'], meta, NOW));
    expect(err.message).toContain('Sprint "Sprint 8" not found');
    expect(err.hint).toContain('Sprint 80');
  });

  it('by state, category, open and type, ignoring case', () => {
    expect(ids({ state: ['in progress'] })).toEqual([1]);
    expect(ids({ category: ['Completed', 'Removed'] })).toEqual([2, 4]);
    expect(ids({ open: true })).toEqual([1, 3, 100]);
    expect(ids({ open: false })).toEqual([2, 4]);
    expect(ids({ type: ['product backlog item'] })).toEqual([100]);
  });

  it('by tag, area (with sub-areas) and parent', () => {
    expect(ids({ tag: ['api'] })).toEqual([1, 100]);
    expect(ids({ area: ['Demo\\Backend'] })).toEqual([1, 2, 4, 100]);
    expect(ids({ area: ['Demo\\Back'] })).toEqual([]);
    expect(ids({ parent: [100] })).toEqual([1, 2]);
  });

  it('by text, ignoring case and accents, or by #id', () => {
    expect(ids({ q: 'revisao' })).toEqual([1]);
    expect(ids({ q: 'acao' })).toEqual([1, 100]);
    expect(ids({ q: 'INTEGRAÇÃO' })).toEqual([100]);
    expect(ids({ q: '#2' })).toEqual([2]);
    expect(ids({ q: '2' })).toEqual([2]);
  });

  it('by changedSince, as an instant or a relative span', () => {
    expect(ids({ changedSince: '2026-10-30T00:00:00Z' })).toEqual([1, 4, 100]);
    // Relative spans count from the local start of day; 5d stays clear of any time zone.
    expect(ids({ changedSince: '5d' })).toEqual([1, 2, 4, 100]);
  });

  it('ANDs different keys', () => {
    expect(ids({ assignee: ['@me'], open: true, tag: ['backend'] })).toEqual([1]);
  });
});

describe('shape of the answer', () => {
  it('sorts by the given fields, missing values last, ties by the newest id', () => {
    expect(run({ sort: ['priority'] }).items.map(c => c.id)).toEqual([1, 2, 100, 4, 3]);
    expect(run({ sort: ['-priority'] }).items.map(c => c.id)).toEqual([2, 1, 100, 4, 3]);
    expect(run({}).items[0]!.id).toBe(1);
  });

  it('pages after counting the whole match', () => {
    const page = run({ sort: ['id'], limit: 2, offset: 1 });
    expect(page.items.map(c => c.id)).toEqual([2, 3]);
    expect(page.total).toBe(5);
  });

  it('returns only the asked fields', () => {
    expect(run({ filter: { q: '#1' }, fields: ['title', 'state'] }).items).toEqual([
      { id: 1, title: 'Revisão da ação de estorno', state: 'In Progress' },
    ]);
  });

  it('counts facets over the filtered set, before paging', () => {
    const result = run({ filter: { open: true }, facets: ['state', 'assignee', 'tag'], limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.facets).toEqual({
      state: { 'In Progress': 1, 'To Do': 1, Committed: 1 },
      assignee: { Renato: 1, '(unassigned)': 1, Ana: 1 },
      tag: { backend: 1, API: 1, api: 1 },
    });
  });
});
