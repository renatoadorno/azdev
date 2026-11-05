import { describe, expect, it } from 'bun:test';
import type { Connection } from '../src/serve/session';
import { parseItemsQuery } from '../src/serve/filters';
import { filterConditions, filterKey, filterWiql, isTextOnly } from '../src/serve/liveQuery';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  FULL_EVERY_MS,
  INCREMENTAL_EVERY_MS,
  STALE_AFTER_MS,
  backoffDelay,
  nextSync,
  pausesSync,
  refreshOnRequest,
  retryAfterMs,
  type ScheduleState,
} from '../src/serve/schedule';
import { SyncScheduler, statusFingerprint } from '../src/serve/scheduler';
import { Subscriptions, resultFingerprint } from '../src/serve/subscriptions';
import { TempScopes, TEMP_SCOPE_TTL_MS } from '../src/serve/tempScopes';
import type { ItemsResult, ServerMessage, Status } from '../src/interfaces/Serve';
import { buildMeta } from '../src/serve/meta';
import { NOW, ORG, PROJECT, RAW_META } from './serveFixtures';

const T = NOW.getTime();
const state = (over: Partial<ScheduleState> = {}): ScheduleState => ({
  now: T,
  active: true,
  lastSyncAt: T - 10_000,
  lastFullAt: T - 10_000,
  backoffUntil: null,
  paused: false,
  ...over,
});

describe('nextSync', () => {
  it('plans nothing without a watcher, and nothing while paused for a login', () => {
    expect(nextSync(state({ active: false }))).toBeNull();
    expect(nextSync(state({ paused: true }))).toBeNull();
  });

  it('plans an incremental 60 s after the last sync', () => {
    expect(nextSync(state())).toEqual({ kind: 'incremental', at: T - 10_000 + INCREMENTAL_EVERY_MS });
  });

  it('plans a full sync once 30 min have passed since the last one', () => {
    const plan = nextSync(state({ lastSyncAt: T - 5_000, lastFullAt: T - FULL_EVERY_MS - 1 }));
    expect(plan).toEqual({ kind: 'full', at: T - FULL_EVERY_MS - 1 + FULL_EVERY_MS });
  });

  it('syncs now when nothing has been synced yet', () => {
    expect(nextSync(state({ lastSyncAt: null, lastFullAt: null }))).toEqual({ kind: 'full', at: T });
  });

  it('never plans earlier than the end of a backoff', () => {
    const plan = nextSync(state({ backoffUntil: T + 5 * 60_000 }));
    expect(plan?.at).toBe(T + 5 * 60_000);
  });
});

describe('refreshOnRequest', () => {
  const base = { now: T, lastSyncAt: T - 1_000, lastFullAt: T - 1_000, backoffUntil: null, paused: false };

  it('leaves a fresh cache alone and refreshes one older than 30 s', () => {
    expect(refreshOnRequest(base)).toBeNull();
    expect(refreshOnRequest({ ...base, lastSyncAt: T - STALE_AFTER_MS - 1 })).toBe('incremental');
  });

  it('asks for a full sync when none ran in this run or the last is 30 min old', () => {
    expect(refreshOnRequest({ ...base, lastSyncAt: null, lastFullAt: null })).toBe('full');
    expect(refreshOnRequest({ ...base, lastFullAt: T - FULL_EVERY_MS })).toBe('full');
  });

  it('does not ask during a backoff or a pause', () => {
    expect(refreshOnRequest({ ...base, lastSyncAt: null, lastFullAt: null, backoffUntil: T + 1 })).toBeNull();
    expect(refreshOnRequest({ ...base, lastSyncAt: null, lastFullAt: null, paused: true })).toBeNull();
  });
});

describe('backoff', () => {
  it('grows from 30 s and stops at 10 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(n => backoffDelay(n))).toEqual([
      BACKOFF_MIN_MS,
      60_000,
      120_000,
      240_000,
      480_000,
      BACKOFF_MAX_MS,
      BACKOFF_MAX_MS,
      BACKOFF_MAX_MS,
    ]);
  });

  it('waits for a longer Retry-After, within reason', () => {
    expect(backoffDelay(1, 120_000)).toBe(120_000);
    expect(backoffDelay(3, 1_000)).toBe(120_000);
    expect(backoffDelay(1, 24 * 3_600_000)).toBe(3_600_000);
  });

  it('reads Retry-After as seconds or a date, and ignores what it cannot read', () => {
    expect(retryAfterMs({ retryAfter: 30 })).toBe(30_000);
    expect(retryAfterMs({ headers: { 'retry-after': '45' } })).toBe(45_000);
    expect(retryAfterMs({ headers: { 'Retry-After': new Date(T + 90_000).toUTCString() } }, T)).toBe(90_000);
    expect(retryAfterMs({ headers: { 'retry-after': 'soon' } })).toBeUndefined();
    expect(retryAfterMs(new Error('boom'))).toBeUndefined();
  });

  it('pauses only for what a new credential fixes', () => {
    expect(pausesSync('needs_login')).toBe(true);
    expect(pausesSync('offline')).toBe(false);
    expect(pausesSync('rate_limited')).toBe(false);
    expect(pausesSync('upstream')).toBe(false);
  });
});

describe('SyncScheduler', () => {
  it('sets one timer for the plan, replaces it on poke and does nothing without a watcher', () => {
    const timers: Array<{ run: () => void; ms: number; live: boolean }> = [];
    let active = false;
    let nextAt: number | null | undefined;
    const engine = {
      scheduleState: () => ({ now: T, lastSyncAt: T, lastFullAt: T, backoffUntil: null, paused: false }),
      setNextAt: (at: number | null) => (nextAt = at),
      sync: async () => ({ changed: 0, removed: 0, syncedAt: '' }),
    };
    const scheduler = new SyncScheduler({
      engine: () => engine as never,
      active: () => active,
      setTimer: (run, ms) => {
        const timer = { run, ms, live: true };
        timers.push(timer);
        return timer;
      },
      clearTimer: handle => ((handle as { live: boolean }).live = false),
    });

    scheduler.poke();
    expect(timers).toHaveLength(0);
    expect(nextAt).toBeNull();

    active = true;
    scheduler.poke();
    scheduler.poke();
    expect(timers.filter(t => t.live)).toHaveLength(1);
    expect(timers.at(-1)!.ms).toBe(INCREMENTAL_EVERY_MS);
    expect(nextAt).toBe(T + INCREMENTAL_EVERY_MS);

    active = false;
    scheduler.poke();
    expect(timers.filter(t => t.live)).toHaveLength(0);
  });
});

const sample = (over: Partial<Status> = {}): Status =>
  ({
    auth: { state: 'ok' },
    cache: { stale: false, items: 1, syncedAt: 'a', fullSyncedAt: 'a' },
    sync: { running: false, nextAt: null, backoffUntil: null, lastError: null },
    ...over,
  }) as Status;

describe('statusFingerprint', () => {
  it('ignores what moves on every sync and sees login, stale and error', () => {
    const base = statusFingerprint(sample());
    expect(statusFingerprint(sample({ cache: { stale: false, items: 99, syncedAt: 'b', fullSyncedAt: 'b' } }))).toBe(base);
    expect(statusFingerprint(sample({ auth: { state: 'needs_login' } }))).not.toBe(base);
    expect(statusFingerprint(sample({ cache: { stale: true, items: 1, syncedAt: 'a', fullSyncedAt: 'a' } }))).not.toBe(base);
    const error = { kind: 'offline', message: 'down', at: 'x' } as const;
    expect(statusFingerprint(sample({ sync: { running: false, nextAt: null, backoffUntil: null, lastError: error } }))).not.toBe(base);
  });
});

describe('liveQuery', () => {
  const meta = buildMeta(RAW_META, { orgUrl: ORG, project: PROJECT, now: NOW });

  it('writes each filter key as a WIQL condition, OR within a key', () => {
    const conditions = filterConditions(
      { assignee: ['@me', 'ana@acme.com'], type: ['Task'], tag: ['a', 'b'], parent: [10] },
      meta,
      null,
    );
    expect(conditions).toContain("([System.AssignedTo] = @me OR [System.AssignedTo] = 'ana@acme.com')");
    expect(conditions).toContain("[System.WorkItemType] = 'Task'");
    expect(conditions).toContain("([System.Tags] CONTAINS 'a' OR [System.Tags] CONTAINS 'b')");
    expect(conditions).toContain('[System.Parent] = 10');
  });

  it('turns resolved sprints into paths, categories into states, and open into buckets', () => {
    const conditions = filterConditions({ category: ['InProgress'], open: true }, meta, ['Demo\\Sprint 79']);
    expect(conditions).toContain("[System.IterationPath] = 'Demo\\Sprint 79'");
    expect(conditions.join(' ')).toContain("[System.State] IN ('In Progress', 'homologing')");
    expect(conditions.join(' ')).toContain('[System.State] IN');
    expect(filterConditions({ open: false }, meta, null).join(' ')).toContain("'done'");
  });

  it('drops the assignee condition for "any", and matches title text only', () => {
    expect(filterConditions({ assignee: ['any'] }, meta, null)).toEqual([]);
    expect(filterConditions({ q: "it's" }, meta, null)).toEqual(["[System.Title] CONTAINS 'it''s'"]);
    expect(filterConditions({ q: '#12' }, meta, null)).toEqual(["([System.Id] = 12 OR [System.Title] CONTAINS '12')"]);
    expect(filterWiql({ q: 'x' }, meta, null)).toContain('[System.TeamProject] = @project');
  });

  it('knows a free-text search alone, and spells one filter one way', () => {
    expect(isTextOnly({ q: 'x' })).toBe(true);
    expect(isTextOnly({ q: 'x', open: true })).toBe(false);
    expect(isTextOnly({})).toBe(false);
    expect(filterKey({ state: ['B', 'a'], open: true })).toBe(filterKey({ open: true, state: ['a', 'b'] }));
    expect(filterKey({ state: ['a'] })).not.toBe(filterKey({ state: ['c'] }));
  });
});

describe('TempScopes', () => {
  const scope = (key: string, ...members: number[]) => ({ key, filter: {}, wiql: '', members: new Set(members) });

  it('expires only the scopes unused for 30 min, and a touch renews one', () => {
    const scopes = new TempScopes();
    scopes.set(scope('a', 1), 0);
    scopes.set(scope('b', 2), 0);
    scopes.touch('b', 20 * 60_000);
    expect(scopes.expire(TEMP_SCOPE_TTL_MS).map(s => s.key)).toEqual(['a']);
    expect(scopes.size).toBe(1);
    expect([...scopes.memberIds()]).toEqual([2]);
    expect(scopes.expire(TEMP_SCOPE_TTL_MS + 19 * 60_000)).toHaveLength(0);
    expect(scopes.expire(50 * 60_000)).toHaveLength(1);
  });
});

function fakeConnection(id: number) {
  const sent: ServerMessage[] = [];
  const cleanups: Array<() => void> = [];
  const conn: Connection = {
    id,
    send: message => sent.push(message),
    close: () => {},
    onClose: cleanup => cleanups.push(cleanup),
  };
  return { conn, sent, close: () => cleanups.forEach(c => c()) };
}

const result = (ids: number[], seq = 1): ItemsResult => ({
  items: ids.map(id => ({ id })),
  total: ids.length,
  seq,
  syncedAt: `at-${seq}`,
  stale: false,
  source: 'cache',
});

describe('Subscriptions', () => {
  const query = parseItemsQuery({});

  it('pushes only when the result changed, ignoring seq and syncedAt', () => {
    const subs = new Subscriptions();
    const { conn, sent } = fakeConnection(1);
    const sub = subs.add(conn, query, result([1, 2]));
    expect(subs.refresh(() => result([1, 2], 7))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(subs.refresh(() => result([1, 2, 3], 8))).toBe(1);
    expect(sent).toEqual([{ sub, result: result([1, 2, 3], 8) }]);
    expect(subs.refresh(() => result([1, 2, 3], 9))).toBe(0);
    expect(resultFingerprint(result([1], 1))).toBe(resultFingerprint(result([1], 2)));
  });

  it('ends a subscription on unwatch, only for the connection that opened it', () => {
    const subs = new Subscriptions();
    const a = fakeConnection(1);
    const b = fakeConnection(2);
    const sub = subs.add(a.conn, query, result([1]));
    expect(subs.remove(b.conn, sub)).toBe(false);
    expect(subs.remove(a.conn, sub)).toBe(true);
    expect(subs.remove(a.conn, sub)).toBe(false);
    expect(subs.refresh(() => result([9]))).toBe(0);
    expect(a.sent).toHaveLength(0);
  });

  it('drops every subscription of a connection when it closes, and tells the schedule', () => {
    let changes = 0;
    const subs = new Subscriptions(() => changes++);
    const a = fakeConnection(1);
    const b = fakeConnection(2);
    subs.add(a.conn, query, result([1]));
    subs.add(a.conn, query, result([1]));
    subs.add(b.conn, query, result([1]));
    expect(subs.count).toBe(3);
    a.close();
    expect(subs.count).toBe(1);
    expect(changes).toBe(4);
    subs.refresh(() => result([5]));
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
  });

  it('keeps the last result of a query that stopped resolving', () => {
    const subs = new Subscriptions();
    const { conn, sent } = fakeConnection(1);
    subs.add(conn, query, result([1]));
    expect(
      subs.refresh(() => {
        throw new Error('sprint gone');
      }),
    ).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
