import { describe, expect, it } from 'bun:test';
import { createCardContext, itemFields, parentOf, parseTags, toCard, toPerson } from '../src/serve/cards';
import { CLOSED_BUCKETS, OPEN_BUCKETS, isClosedCategory } from '../src/serve/categories';
import { buildMeta, currentSprint, previousSprint, stateLookup } from '../src/serve/meta';
import { defaultScopes, isCovered, itemsToKeep, matchesRule, scopeCondition, scopeContext } from '../src/serve/scopes';
import { ItemStore } from '../src/serve/store';
import { ANA, MINE, NOW, ORG, PROJECT, RAW_META, item } from './serveFixtures';

const meta = buildMeta(RAW_META, { orgUrl: ORG, project: PROJECT, now: NOW });

describe('buildMeta', () => {
  it('keeps enabled types with their states and the transitions the process allows', () => {
    expect(meta.types.map(t => t.name)).toEqual(['Task', 'Product Backlog Item']);
    const task = meta.types[0]!;
    expect(task.states[0]).toEqual({ name: 'To Do', category: 'Proposed', color: 'b2b2b2' });
    expect(task.transitions['']).toEqual(['To Do']);
    expect(task.transitions.Removed).toEqual(['To Do', 'homologing']);
    expect(task.transitions.Removed).not.toContain('Done');
  });

  it("merges the team's sprints into the project's, without the root, by start date", () => {
    expect(meta.sprints.map(s => s.name)).toEqual(['Sprint 80', 'Sprint 81', 'Sprint 82', 'Sprint 83']);
    expect(meta.sprints[2]).toEqual({
      id: 's82',
      name: 'Sprint 82',
      path: 'Demo\\Sprint 82',
      start: '2026-10-20T00:00:00Z',
      finish: '2026-11-02T00:00:00Z',
      timeframe: 'current',
    });
    expect(meta.sprints[0]!.timeframe).toBeUndefined();
  });

  it('finds the current sprint by timeframe and the previous as the last past one', () => {
    expect(currentSprint(meta, NOW)?.name).toBe('Sprint 82');
    expect(previousSprint(meta, NOW)?.name).toBe('Sprint 81');
  });

  it('falls back on dates when no sprint carries a timeframe', () => {
    const undated = { ...meta, sprints: meta.sprints.map(({ timeframe: _t, ...s }) => s) };
    expect(currentSprint(undated, NOW)?.name).toBe('Sprint 82');
    expect(previousSprint(undated, NOW)?.name).toBe('Sprint 81');
  });

  it('looks states up regardless of case', () => {
    expect(stateLookup(meta)('task', 'IN PROGRESS')?.category).toBe('InProgress');
    expect(stateLookup(meta)('Task', 'Nope')).toBeUndefined();
  });
});

describe('toCard', () => {
  const store = new ItemStore();
  store.upsert([
    item(100, { type: 'Product Backlog Item', state: 'Committed', title: 'História', assignee: ANA }),
    item(1, { parent: 100, state: 'In Progress', tags: 'api; backend', priority: 2, comments: 3, rev: 7 }),
    item(2, { parent: 100, state: 'Done' }),
    item(3, { parent: 100, state: 'Removed' }),
  ]);
  const context = createCardContext(meta, store, NOW);

  it('maps fields to the card, with category, color, sprint, parent and url', () => {
    expect(toCard(store.get(1)!, context)).toEqual({
      id: 1,
      rev: 7,
      type: 'Task',
      state: 'In Progress',
      stateCategory: 'InProgress',
      stateColor: '007acc',
      title: 'Card 1',
      assignedTo: { name: 'Renato', email: 'renato@acme.com' },
      sprint: { name: 'Sprint 82', path: 'Demo\\Sprint 82', start: '2026-10-20T00:00:00Z', finish: '2026-11-02T00:00:00Z', current: true },
      area: 'Demo\\Backend',
      tags: ['api', 'backend'],
      priority: 2,
      parent: { id: 100, title: 'História', type: 'Product Backlog Item' },
      children: { total: 0, done: 0 },
      commentCount: 3,
      changedBy: { name: 'Ana', email: 'ana@acme.com' },
      changedAt: '2026-10-30T10:00:00.000Z',
      createdAt: '2026-10-20T10:00:00.000Z',
      url: 'https://dev.azure.com/acme/Demo/_workitems/edit/1',
    });
  });

  it('counts children without the removed ones', () => {
    expect(toCard(store.get(100)!, context).children).toEqual({ total: 2, done: 1 });
  });

  it('leaves out what the item does not have and treats the project root as no sprint', () => {
    const card = toCard(item(9, { assignee: null, sprint: 'Demo', state: 'Weird' }), context);
    expect(card.assignedTo).toBeNull();
    expect(card.sprint).toBeNull();
    expect(card.parent).toBeNull();
    expect(card.stateCategory).toBe('Proposed');
    expect(card).not.toHaveProperty('priority');
    expect(card).not.toHaveProperty('stateColor');
  });

  it('marks a sprint the meta does not know as not current, named by its last segment', () => {
    expect(toCard(item(9, { sprint: 'Demo\\Hotfix 1' }), context).sprint).toEqual({ name: 'Hotfix 1', path: 'Demo\\Hotfix 1', current: false });
  });

  it('reads identities as the cache keeps them, or the legacy string form', () => {
    expect(toPerson(MINE)).toEqual({ name: 'Renato', email: 'renato@acme.com' });
    expect(toPerson('Ana <ana@acme.com>')).toEqual({ name: 'Ana', email: 'ana@acme.com' });
    expect(toPerson(undefined)).toBeNull();
    expect(parseTags(' a ;b;; ')).toEqual(['a', 'b']);
  });

  it('asks only for fields the project has', () => {
    const fields = itemFields(RAW_META.fieldRefs);
    expect(fields).toContain('Microsoft.VSTS.Common.Priority');
    expect(fields).not.toContain('Microsoft.VSTS.Scheduling.Effort');
    expect(fields).not.toContain('System.BoardColumn');
  });
});

describe('categories', () => {
  // The cache filter, the live WIQL and the scopes must agree on what "open" is.
  it('derives open and closed buckets from the same closed categories', () => {
    expect(CLOSED_BUCKETS).toEqual(['done', 'removed']);
    expect(OPEN_BUCKETS).toEqual(['todo', 'doing']);
    expect(isClosedCategory('completed')).toBe(true);
    expect(isClosedCategory('Resolved')).toBe(false);
  });

  it('reads the parent off the raw fields in one place', () => {
    expect(parentOf(item(1, { parent: 100 }))).toBe(100);
    expect(parentOf(item(1))).toBeUndefined();
  });
});

describe('ItemStore', () => {
  it('reports new or re-revised items as changed and moves seq only then', () => {
    const store = new ItemStore();
    expect(store.upsert([item(1), item(2)])).toEqual([1, 2]);
    const seq = store.seq;
    expect(store.upsert([item(1), item(2)])).toEqual([]);
    expect(store.seq).toBe(seq);
    expect(store.upsert([item(1, { rev: 2 })])).toEqual([1]);
    expect(store.seq).toBe(seq + 1);
  });

  it('removes only what it holds and keeps the child index current', () => {
    const store = new ItemStore();
    store.upsert([item(100), item(1, { parent: 100 })]);
    expect(store.childrenOf(100).map(i => i.id)).toEqual([1]);
    store.upsert([item(2, { parent: 100 })]);
    expect(store.childrenOf(100).map(i => i.id)).toEqual([1, 2]);
    expect(store.remove([1, 999])).toEqual([1]);
    expect(store.childrenOf(100).map(i => i.id)).toEqual([2]);
  });
});

describe('scopes', () => {
  const context = scopeContext(meta);

  it('tracks my open cards and the current sprint, and the watch list only when it has cards', () => {
    expect(defaultScopes(meta, [], NOW).map(s => s.key)).toEqual(['mine-open', 'sprint:Demo\\Sprint 82']);
    expect(defaultScopes(meta, [5, 5], NOW)[2]).toEqual({ key: 'watch', rule: { kind: 'watch', ids: [5] } });
  });

  it('turns each rule into WIQL', () => {
    const mine = scopeCondition({ kind: 'mine-open' }, context);
    expect(mine).toStartWith('[System.AssignedTo] = @me AND ');
    // bucketCondition lowercases state names; WIQL string comparison ignores case.
    expect(mine).toContain("'in progress'");
    expect(mine).not.toContain("'done'");
    expect(scopeCondition({ kind: 'sprint', path: "Demo\\D'Or" }, context)).toBe("[System.IterationPath] = 'Demo\\D''Or'");
    expect(scopeCondition({ kind: 'watch', ids: [5, 6] }, context)).toBe('([System.Id] IN (5, 6) OR [System.Parent] IN (5, 6))');
  });

  it('runs the same test locally, so a card that left a scope is noticed', () => {
    const rule = { kind: 'mine-open' } as const;
    expect(matchesRule(item(1, { assignee: { displayName: 'R', uniqueName: 'RENATO@acme.com' } }), rule, context)).toBe(true);
    expect(matchesRule(item(1, { state: 'Done' }), rule, context)).toBe(false);
    expect(matchesRule(item(1, { assignee: ANA }), rule, context)).toBe(false);
    expect(matchesRule(item(1, { parent: 5 }), { kind: 'watch', ids: [5] }, context)).toBe(true);
  });

  it("keeps members, their parents and their children, and nothing else", () => {
    const items = [
      item(1, { parent: 100 }),
      item(100, { type: 'Product Backlog Item', assignee: ANA, sprint: 'Demo\\Sprint 80' }),
      item(2, { parent: 1, assignee: ANA, sprint: 'Demo\\Sprint 80' }),
      item(3, { assignee: ANA, sprint: 'Demo\\Sprint 80' }),
    ];
    const keep = itemsToKeep(items, [{ key: 'mine-open', rule: { kind: 'mine-open' } }], context);
    expect([...keep].sort((a, b) => a - b)).toEqual([1, 2, 100]);
  });

  it('knows which filters the cache can answer alone', () => {
    const scopes = defaultScopes(meta, [], NOW);
    const none = { sprintPaths: null, memberIds: new Set<number>() };
    expect(isCovered({ assignee: ['@me'], open: true, type: ['Task'] }, scopes, none)).toBe(true);
    expect(isCovered({ assignee: ['@me'] }, scopes, none)).toBe(false);
    expect(isCovered({ sprint: ['current'] }, scopes, { ...none, sprintPaths: ['Demo\\Sprint 82'] })).toBe(true);
    expect(isCovered({ sprint: ['80'] }, scopes, { ...none, sprintPaths: ['Demo\\Sprint 80'] })).toBe(false);
    expect(isCovered({ parent: [100] }, scopes, { ...none, memberIds: new Set([100]) })).toBe(true);
    expect(isCovered({ type: ['Task'] }, scopes, none)).toBe(false);
  });
});
