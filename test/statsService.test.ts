import { describe, expect, it } from 'bun:test';
import { StatsService } from '../src/services/StatsService';

const ORG = 'https://dev.azure.com/acme';
const DAY = 86_400_000;

/** UTC midnight `days` from today — iteration dates as Azure DevOps stores them. */
function utcDay(days: number): string {
  const d = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}

const SPRINTS = [
  { name: 'Sprint 100', path: 'Demo\\Sprint 100', start: utcDay(-40), finish: utcDay(-30) },
  { name: 'Sprint 80', path: 'Demo\\Sprint 80', start: utcDay(-33), finish: utcDay(-20) },
  { name: 'Sprint 81', path: 'Demo\\Sprint 81', start: utcDay(-19), finish: utcDay(-6) },
  { name: 'Sprint 82', path: 'Demo\\Sprint 82', start: utcDay(-5), finish: utcDay(5) },
];

const ITEMS: Record<number, Record<string, unknown>> = {
  1: { 'System.WorkItemType': 'Task', 'System.State': 'To Do', 'System.Title': 'Carried twice', 'System.IterationPath': 'Demo\\Sprint 82' },
  2: { 'System.WorkItemType': 'Publication', 'System.State': 'New', 'System.Title': 'Deploy [PROD]', 'System.IterationPath': 'Demo\\Sprint 82' },
  3: { 'System.WorkItemType': 'Task', 'System.State': 'Done', 'System.Title': 'New this sprint', 'System.IterationPath': 'Demo\\Sprint 82' },
  4: { 'System.WorkItemType': 'Task', 'System.State': 'To Do', 'System.Title': 'Back from the waiting list', 'System.IterationPath': 'Demo\\Sprint 82' },
  5: { 'System.WorkItemType': 'Task', 'System.State': 'To Do', 'System.Title': 'Parked', 'System.IterationPath': 'Demo\\Sprint 100' },
  6: { 'System.WorkItemType': 'Task', 'System.State': 'Done', 'System.Title': 'Closed late', 'System.IterationPath': 'Demo\\Sprint 81' },
  7: { 'System.WorkItemType': 'Task', 'System.State': 'Removed', 'System.Title': 'Dropped', 'System.IterationPath': 'Demo\\Sprint 81' },
  8: {
    'System.WorkItemType': 'Task', 'System.State': 'Done', 'System.Title': 'No ClosedDate',
    'System.CreatedDate': utcDay(-10), 'Microsoft.VSTS.Common.StateChangeDate': utcDay(-2),
  },
  9: {
    'System.WorkItemType': 'Task', 'System.State': 'Done', 'System.Title': 'Closed long ago',
    'System.CreatedDate': utcDay(-300), 'Microsoft.VSTS.Common.ClosedDate': utcDay(-200), 'Microsoft.VSTS.Common.StateChangeDate': utcDay(-2),
  },
};

/** Which ids each query returns: the sprint it names, now or at an ASOF moment. */
function answer(query: string): number[] {
  const asOf = query.includes(' ASOF ');
  if (query.includes('ClosedDate] >=')) return [8, 9];
  if (query.includes("'Demo\\Sprint 100'")) return asOf ? [4] : [5];
  if (query.includes("'Demo\\Sprint 80'")) return asOf ? [1] : [];
  if (query.includes("'Demo\\Sprint 81b'")) return asOf ? [3] : [];
  if (query.includes("'Demo\\Sprint 81'")) return asOf ? [1, 2, 5, 6, 7] : [6];
  if (query.includes("'Demo\\Sprint 82'")) return asOf ? [] : [1, 2, 3, 4];
  return [];
}

function makeService(sprints = SPRINTS) {
  const queries: string[] = [];
  const witApi = {
    queryByWiql: async ({ query }: { query: string }) => {
      queries.push(query);
      return { workItems: answer(query).map(id => ({ id })) };
    },
    getWorkItems: async (ids: number[]) => ids.map(id => ({ id, fields: ITEMS[id] })),
    getWorkItemTypes: async () => [
      { name: 'Task', states: [{ name: 'To Do', category: 'Proposed' }, { name: 'Done', category: 'Completed' }] },
      { name: 'Publication', states: [{ name: 'New', category: 'Proposed' }, { name: 'Done', category: 'Completed' }] },
    ],
    getFields: async () => [],
    getClassificationNode: async () => ({
      identifier: 'root',
      name: 'Demo',
      path: '\\Demo\\Iteration',
      children: sprints.map(s => ({
        identifier: s.name,
        name: s.name,
        path: `\\Demo\\Iteration\\${s.name}`,
        attributes: { startDate: s.start, finishDate: s.finish },
      })),
    }),
  };
  const workApi = {
    getTeamIterations: async () => sprints.map(s => ({ name: s.name, path: s.path, attributes: { startDate: new Date(s.start), finishDate: new Date(s.finish) } })),
  };
  const svc = new StatsService({ orgUrl: ORG, project: 'Demo', personalAccessToken: 'tok', auth: { type: 'pat' } });
  (svc as any).connection = {
    getWorkItemTrackingApi: async () => witApi,
    getWorkApi: async () => workApi,
    connect: async () => ({ authenticatedUser: { properties: { Account: { $value: 'me@acme.dev' } } } }),
  };
  return { svc, queries };
}

const RULES = {
  backlogSprints: ['Sprint 100'],
  expected: [{ key: 'pub-prod', type: 'Publication', title: '{title} [PROD]', match: '\\[\\s*PROD\\s*\\]', expectedCarryover: true }],
};

describe('StatsService.sprintCarryover', () => {
  it('counts what came unfinished from earlier sprints, never the backlog sprint, and lists expected moves apart', async () => {
    const { svc, queries } = makeService();
    const result = await svc.sprintCarryover({ sprint: '82', rules: RULES });

    expect(result.lookedBack).toBe('Sprint 80, Sprint 81');
    expect(queries.some(q => q.includes("'Demo\\Sprint 100'"))).toBe(false);
    expect(result.totals).toEqual({ items: 4, carriedIn: 1, carriedInPct: 25, timesCarried: 2, expected: 1 });
    expect((result.carriedIn as any[]).map(r => [r.id, r.carried, r.from])).toEqual([[1, 2, 'Sprint 80, Sprint 81']]);
    expect((result.expected as any[]).map(r => r.id)).toEqual([2]);
    expect(result.carriedOut).toBeUndefined();
  });

  it('tells, for a finished sprint, where each unfinished item went', async () => {
    const { svc } = makeService();
    const result = await svc.sprintCarryover({ sprint: '81', rules: RULES });
    const out = result.carriedOut as Record<string, any>;
    expect(out.unfinishedAtEnd).toBe(5);
    expect(out.items.map((r: any) => [r.id, r.kind, r.nowIn])).toEqual([
      [1, 'moved', 'Sprint 82'],
      [5, 'parked', 'Sprint 100'],
      [2, 'expected', 'Sprint 82'],
      [6, 'closed late', 'Sprint 81'],
      [7, 'removed', 'Sprint 81'],
    ]);
  });

  it('looks back only as far as asked', async () => {
    const { svc, queries } = makeService();
    const result = await svc.sprintCarryover({ sprint: '82', lookback: 1, rules: RULES });
    expect(result.lookedBack).toBe('Sprint 81');
    expect(queries.some(q => q.includes("'Demo\\Sprint 80'"))).toBe(false);
    expect((result.carriedIn as any[]).map(r => [r.id, r.carried])).toEqual([[1, 1]]);
  });

  it('counts a sprint that ends on the first day of this one, but not one that overlaps it', async () => {
    const sprints = [
      ...SPRINTS,
      { name: 'Sprint 81b', path: 'Demo\\Sprint 81b', start: utcDay(-12), finish: utcDay(-5) },
      { name: 'Sprint 81c', path: 'Demo\\Sprint 81c', start: utcDay(-12), finish: utcDay(-4) },
    ];
    const { svc } = makeService(sprints);
    const result = await svc.sprintCarryover({ sprint: '82', rules: RULES });
    expect(result.lookedBack).toBe('Sprint 80, Sprint 81, Sprint 81b');
    expect((result.carriedIn as any[]).map(r => r.id)).toContain(3);
  });

  it('counts the backlog sprint like any other when no rules are given', async () => {
    const { svc } = makeService();
    const result = await svc.sprintCarryover({ sprint: '82' });
    expect(result.lookedBack).toBe('Sprint 100, Sprint 80, Sprint 81');
    expect((result.carriedIn as any[]).map(r => r.id)).toEqual([1, 2, 4]);
  });
});

describe('StatsService.cycleTime', () => {
  it('counts an item closed in the period by its state change when the type sets no ClosedDate', async () => {
    const { svc, queries } = makeService();
    const result = await svc.cycleTime({ since: '30d', by: 'none' });
    expect(queries[0]).toContain('[Microsoft.VSTS.Common.StateChangeDate] >=');
    expect(result.items).toBe(1);
    expect((result.slowest as any[]).map(r => r.id)).toEqual([8]);
    expect((result.leadTimeDays as any).median).toBe(8);
  });
});

describe('StatsService.sprintProgress', () => {
  it('buckets the sprint items by state category and places the sprint in time', async () => {
    const { svc } = makeService();
    const result = await svc.sprintProgress({ sprint: '82' });
    expect(result.totals).toEqual({ items: 4, todo: 3, doing: 0, done: 1, donePct: 25, removed: 0 });
    expect((result.sprint as any).state).toBe('running');
    expect(result.effort).toBeUndefined();
  });
});
