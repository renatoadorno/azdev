import { afterEach, describe, expect, it } from 'bun:test';
import { DaemonError, connectDaemon } from '../src/serve/client';
import { SyncEngine, type EngineOptions } from '../src/serve/engine';
import { parseItemsQuery } from '../src/serve/filters';
import { dataHandlers } from '../src/serve/handlers';
import { serverEvent } from '../src/serve/protocol';
import { startServer, type RunningServer } from '../src/serve/server';
import { Subscriptions, followEngine } from '../src/serve/subscriptions';
import type { Status } from '../src/interfaces/Serve';
import { ANA, FakeSource, NOW, ORG, PROJECT, item, offlineError } from './serveFixtures';

const MIN = 60_000;

/** My open card in an old sprint, its story, a sprint card of Ana's, and noise outside every scope. */
function project() {
  return new FakeSource([
    item(100, { type: 'Product Backlog Item', state: 'Committed', title: 'História', assignee: ANA, sprint: 'Demo\\Sprint 80' }),
    item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80' }),
    item(2, { parent: 100, state: 'To Do', assignee: ANA, sprint: 'Demo\\Sprint 80' }),
    item(3, { assignee: ANA }),
    item(4, { state: 'Done', sprint: 'Demo\\Sprint 81' }),
    item(5, { assignee: ANA, sprint: 'Demo\\Sprint 81' }),
  ]);
}

let clock = NOW;
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));
const later = (ms: number) => new Date(clock.getTime() + ms).toISOString();

function engine(source: FakeSource, options: Partial<EngineOptions> = {}): SyncEngine {
  clock = NOW;
  return new SyncEngine({ orgUrl: ORG, project: PROJECT, source, now: () => clock, ...options });
}

const ids = (cache: SyncEngine, filter: object = {}) =>
  cache.list(parseItemsQuery({ filter, sort: ['id'], limit: 1000 })).items.map(card => card.id);
const query = (filter: object) => parseItemsQuery({ filter, sort: ['id'], limit: 1000 });

const servers: RunningServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

describe('incremental sync', () => {
  it('asks only for what changed since the last sync, with time precision, 2 min back', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    advance(5 * MIN);
    source.queries.length = 0;
    source.precise.length = 0;
    await cache.incrementalSync();
    expect(source.queries).toHaveLength(1);
    expect(source.queries[0]).toContain(`[System.ChangedDate] > '${new Date(NOW.getTime() - 2 * MIN).toISOString()}'`);
    expect(source.precise).toEqual([true]);
  });

  it('starts the next window where the last query began, not where the sync ended', async () => {
    const source = project();
    const cache = engine(source);
    const run = source.runQuery.bind(source);
    // The sync takes 10 minutes: the clock moves while its queries run.
    source.runQuery = async (wiql, precise) => {
      advance(MIN);
      return run(wiql, precise);
    };
    await cache.fullSync();
    const started = NOW.getTime();
    source.queries.length = 0;
    await cache.incrementalSync();
    expect(source.queries[0]).toContain(new Date(started - 2 * MIN).toISOString());
  });

  it('picks up a changed card, and ignores one whose revision is the same', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.set(item(3, { assignee: ANA, title: 'Renamed', rev: 2, changedAt: later(30_000) }));
    source.set(item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80', changedAt: later(30_000) }));
    advance(MIN);
    expect(await cache.incrementalSync()).toMatchObject({ changed: 1, removed: 0 });
    expect((await cache.card(3)).title).toBe('Renamed');
  });

  it('removes a card that left every scope, with the story only it kept', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.set(item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80', assignee: ANA, rev: 2, changedAt: later(30_000) }));
    advance(MIN);
    expect(await cache.incrementalSync()).toMatchObject({ changed: 0, removed: 2 });
    expect(ids(cache)).toEqual([3]);
  });

  it('brings in a card that joined a scope, with the parent it lacked', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.set(item(200, { type: 'Product Backlog Item', state: 'Committed', assignee: ANA, sprint: 'Demo\\Sprint 80' }));
    source.set(item(7, { parent: 200, sprint: 'Demo\\Sprint 80', changedAt: later(30_000) }));
    advance(MIN);
    expect(await cache.incrementalSync()).toMatchObject({ changed: 2, removed: 0 });
    expect(ids(cache)).toEqual([1, 3, 7, 100, 200]);
    expect((await cache.card(7)).parent?.title).toBe('Card 200');
  });

  it('brings in the children of a story that became mine', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.set(item(100, { type: 'Product Backlog Item', state: 'Committed', sprint: 'Demo\\Sprint 80', rev: 2, changedAt: later(30_000) }));
    advance(MIN);
    await cache.incrementalSync();
    expect(ids(cache)).toEqual([1, 2, 3, 100]);
    expect((await cache.card(100)).children.total).toBe(2);
  });

  it('reads everything again when the window holds more than 1000 cards', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    for (let id = 1000; id < 2001; id++) source.set(item(id, { assignee: ANA, sprint: 'Demo\\Sprint 81', changedAt: later(30_000) }));
    source.set(item(3, { assignee: ANA, title: 'Renamed', rev: 2 }));
    advance(MIN);
    source.queries.length = 0;
    expect(await cache.incrementalSync()).toMatchObject({ changed: 1 });
    expect(source.queries.some(q => q.includes('[System.AssignedTo] = @me'))).toBe(true);
  });

  it('is a full sync when the current sprint changed, or nothing was synced yet', async () => {
    const source = project();
    const cache = engine(source);
    source.queries.length = 0;
    await cache.incrementalSync();
    expect(source.queries.some(q => q.includes('[System.AssignedTo] = @me'))).toBe(true);

    const watching = engine(project(), { watched: () => [] });
    await watching.fullSync();
    const list = [100];
    const changed = engine(project(), { watched: () => list });
    await changed.fullSync();
    list.push(2);
    const queries = (changed as unknown as { source: FakeSource }).source.queries;
    queries.length = 0;
    await changed.incrementalSync();
    expect(queries.some(q => q.includes('[System.AssignedTo] = @me'))).toBe(true);
  });

  it('shares one run between callers, and waits for a running full sync instead of racing it', async () => {
    const cache = engine(project());
    await cache.fullSync();
    const [a, b] = [cache.incrementalSync(), cache.incrementalSync()];
    expect(a).toBe(b);
    await a;
    const full = cache.fullSync();
    expect(cache.incrementalSync()).toBe(full);
    await full;
  });
});

describe('data requests refresh behind the answer', () => {
  it('runs an incremental when the last sync is older than 30 s, and not before', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.queries.length = 0;
    advance(10_000);
    await cache.ready();
    expect(source.queries).toHaveLength(0);
    advance(25_000);
    await cache.ready();
    await cache.incrementalSync();
    expect(source.queries.filter(q => q.includes('ChangedDate'))).toHaveLength(1);
  });

  it('does not touch Azure DevOps during a backoff', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.failWith = Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    advance(2 * MIN);
    await expect(cache.incrementalSync()).rejects.toThrow('down');
    source.failWith = null;
    source.queries.length = 0;
    advance(10_000);
    await cache.ready();
    expect(source.queries).toHaveLength(0);
  });
});

describe('backoff and login', () => {
  const offline = () => Object.assign(new Error('down'), { code: 'ECONNREFUSED' });

  it('waits 30 s, then 60 s, and shows it in the status; a good sync clears it', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.failWith = offline();
    advance(2 * MIN);
    await expect(cache.incrementalSync()).rejects.toThrow();
    expect(cache.syncStatus().backoffUntil).toBe(later(30_000));
    expect(cache.syncStatus().lastError?.kind).toBe('offline');
    expect(cache.cacheStatus().stale).toBe(true);
    await expect(cache.incrementalSync()).rejects.toThrow();
    expect(cache.syncStatus().backoffUntil).toBe(later(60_000));
    source.failWith = null;
    await cache.incrementalSync();
    expect(cache.syncStatus()).toMatchObject({ backoffUntil: null, lastError: null });
    expect(cache.scheduleState().backoffUntil).toBeNull();
  });

  it('honors Retry-After from a 429', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.failWith = Object.assign(new Error('slow down'), { statusCode: 429, retryAfter: 300 });
    advance(2 * MIN);
    await expect(cache.incrementalSync()).rejects.toThrow();
    expect(cache.syncStatus().backoffUntil).toBe(later(300_000));
  });

  it('keeps answering from the cache, marked stale, while it waits', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.failWith = offline();
    advance(2 * MIN);
    await expect(cache.incrementalSync()).rejects.toThrow();
    const result = await cache.query(query({ assignee: ['@me'], open: true }));
    expect(result).toMatchObject({ source: 'cache', stale: true, total: 1 });
  });

  it('re-reads the credential once on a 401 and repeats the call', async () => {
    const source = project();
    source.failWith = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    const errors: string[] = [];
    let renewals = 0;
    const cache = engine(source, {
      onError: error => errors.push(error.kind),
      onUnauthorized: async () => {
        renewals++;
        source.failWith = null;
        return true;
      },
    });
    expect(await cache.fullSync()).toMatchObject({ changed: 3 });
    expect(renewals).toBe(1);
    expect(errors).toEqual([]);
    expect(cache.syncStatus().lastError).toBeNull();
  });

  it('answers needs_login and pauses when the new credential fails too', async () => {
    const source = project();
    source.failWith = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    const errors: string[] = [];
    let renewals = 0;
    const cache = engine(source, {
      onError: error => errors.push(error.kind),
      onUnauthorized: async () => {
        renewals++;
        return true;
      },
    });
    await expect(cache.fullSync()).rejects.toThrow('Unauthorized');
    expect(renewals).toBe(1);
    expect(errors).toEqual(['needs_login']);
    expect(cache.scheduleState().paused).toBe(true);
    expect(cache.syncStatus().backoffUntil).toBeNull();
    cache.setSource(source);
    expect(cache.scheduleState().paused).toBe(false);
  });

  it('does not retry a 401 when there is no way to renew', async () => {
    const source = project();
    source.failWith = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    const cache = engine(source, { onUnauthorized: async () => false });
    await expect(cache.fullSync()).rejects.toThrow();
    expect(source.metaCalls).toBe(0);
  });
});

describe('live queries', () => {
  it('asks Azure DevOps for what the cache does not hold, and serves the next one from the cache', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.queries.length = 0;

    const first = await cache.query(query({ sprint: ['Sprint 81'] }));
    expect(first).toMatchObject({ source: 'live', total: 2 });
    expect(first.items.map(card => card.id)).toEqual([4, 5]);
    expect(source.queries[0]).toContain("[System.IterationPath] = 'Demo\\Sprint 81'");
    expect(cache.liveScopes()).toBe(1);

    const asked = source.queries.length;
    const second = await cache.query(query({ sprint: ['Demo\\Sprint 81'] }));
    expect(second).toMatchObject({ source: 'cache', total: 2 });
    expect(source.queries).toHaveLength(asked);
  });

  it('answers what the default scopes cover from the cache, with no query', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.queries.length = 0;
    expect((await cache.query(query({ assignee: ['@me'], open: true }))).source).toBe('cache');
    expect((await cache.query(query({ sprint: ['current'] }))).source).toBe('cache');
    expect(source.queries).toHaveLength(0);
  });

  it('answers from the snapshot after a restart without going live', async () => {
    const source = project();
    const first = engine(source);
    await first.fullSync();
    const file = `${process.env.TMPDIR ?? '/tmp'}/azdev-live-${process.pid}.json`;
    const writer = engine(project(), { snapshotFile: file });
    await writer.fullSync();
    const offline = project();
    offline.failWith = offlineError();
    const restarted = engine(offline, { snapshotFile: file });
    restarted.loadSnapshot();
    expect(await restarted.query(query({ assignee: ['@me'], open: true }))).toMatchObject({ source: 'cache', stale: true });
    expect(offline.queries).toHaveLength(0);
    (await import('fs')).rmSync(file, { force: true });
  });

  it('runs free text alone live and keeps nothing', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    const before = ids(cache);
    const result = await cache.query(query({ q: 'Card 5' }));
    expect(result).toMatchObject({ source: 'live', total: 1 });
    expect(result.items[0]).toMatchObject({ id: 5 });
    expect(cache.liveScopes()).toBe(0);
    expect(ids(cache)).toEqual(before);
    expect((await cache.query(query({ q: 'Card 5' }))).source).toBe('live');
  });

  it('caps a live query at 1000 cards, newest first', async () => {
    const source = project();
    for (let id = 1000; id < 2200; id++) source.set(item(id, { assignee: ANA, sprint: 'Demo\\Sprint 81', changedAt: later(id * 1000) }));
    const cache = engine(source);
    await cache.fullSync();
    const result = await cache.query(parseItemsQuery({ filter: { sprint: ['Demo\\Sprint 81'] }, sort: ['-changedAt'], limit: 1000 }));
    expect(result.total).toBe(1000);
    expect(result.items[0]).toMatchObject({ id: 2199 });
  });

  it('keeps a live scope fresh: a card that joins it arrives with the next incremental sync', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    await cache.query(query({ sprint: ['Sprint 81'] }));
    source.set(item(6, { assignee: ANA, sprint: 'Demo\\Sprint 81', changedAt: later(30_000) }));
    advance(MIN);
    await cache.incrementalSync();
    expect(ids(cache, { sprint: ['Sprint 81'] })).toEqual([4, 5, 6]);
  });

  it('expires after 30 min without use and takes its cards along, unless it was used again', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    await cache.query(query({ sprint: ['Sprint 81'] }));
    expect(ids(cache)).toEqual([1, 3, 4, 5, 100]);

    advance(20 * MIN);
    await cache.query(query({ sprint: ['Sprint 81'] }));
    advance(20 * MIN);
    await cache.fullSync();
    expect(cache.liveScopes()).toBe(1);
    expect(ids(cache)).toEqual([1, 3, 4, 5, 100]);

    advance(31 * MIN);
    await cache.fullSync();
    expect(cache.liveScopes()).toBe(0);
    expect(ids(cache)).toEqual([1, 3, 100]);
  });

  it('does not expire a scope someone watches', async () => {
    const source = project();
    const cache = engine(source);
    const subscriptions = new Subscriptions();
    followEngine(cache, subscriptions);
    await cache.fullSync();
    const watched = query({ sprint: ['Sprint 81'] });
    const result = await cache.query(watched);
    subscriptions.add({ id: 1, send() {}, close() {}, onClose() {} }, watched, result);
    for (let i = 0; i < 4; i++) {
      advance(20 * MIN);
      await cache.fullSync();
    }
    expect(cache.liveScopes()).toBe(1);
  });
});

describe('watching over the protocol', () => {
  const TOKEN = 'e'.repeat(64);
  const STATUS = { version: '0.11.0' } as Status;

  async function watchSetup(source: FakeSource) {
    const cache = engine(source);
    const subscriptions = new Subscriptions();
    followEngine(cache, subscriptions);
    const server = startServer({ token: TOKEN, version: '0.11.0', status: () => STATUS, handlers: dataHandlers(() => cache, subscriptions) });
    servers.push(server);
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    const pushes: Array<{ sub: string; result: { items: Array<{ id: number; title?: string }> } }> = [];
    client.onPush(push => pushes.push(push as never));
    return { cache, subscriptions, server, client, pushes };
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));

  it('answers with the list and a sub, then pushes only when the result changes', async () => {
    const source = project();
    const { cache, client, pushes } = await watchSetup(source);
    const watch = await client.call('items.watch', { filter: { assignee: ['@me'], open: true }, fields: ['title'] });
    expect(watch.sub).toBeString();
    expect(watch).toMatchObject({ total: 1, source: 'cache' });

    advance(MIN);
    await cache.incrementalSync();
    await settle();
    expect(pushes).toHaveLength(0);

    source.set(item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80', title: 'Novo título', rev: 2, changedAt: later(30_000) }));
    advance(MIN);
    await cache.incrementalSync();
    await settle();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ sub: watch.sub, result: { items: [{ id: 1, title: 'Novo título' }] } });

    // A change outside the watched list says nothing to it.
    source.set(item(3, { assignee: ANA, title: 'Outro', rev: 2, changedAt: later(90_000) }));
    advance(2 * MIN);
    await cache.incrementalSync();
    await settle();
    expect(pushes).toHaveLength(1);
    client.close();
  });

  it('keeps a free-text watch from falling back to the cache subset after a sync', async () => {
    const source = project();
    const { cache, client, pushes } = await watchSetup(source);
    const watch = await client.call('items.watch', { filter: { q: 'Card 5' }, fields: ['title'] });
    expect(watch).toMatchObject({ total: 1, source: 'live' });
    expect(cache.liveScopes()).toBe(1);

    source.set(item(3, { assignee: ANA, title: 'Outro', rev: 2, changedAt: later(30_000) }));
    advance(MIN);
    await cache.incrementalSync();
    await settle();
    expect(pushes).toHaveLength(0);

    source.set(item(5, { assignee: ANA, sprint: 'Demo\\Sprint 81', title: 'Card 5 mudou', rev: 2, changedAt: later(90_000) }));
    advance(2 * MIN);
    await cache.incrementalSync();
    await settle();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.result.items).toEqual([{ id: 5, title: 'Card 5 mudou' }]);
    client.close();
  });

  it('stops pushing after unwatch, and forgets the subscriptions of a closed connection', async () => {
    const source = project();
    const { cache, client, pushes, subscriptions } = await watchSetup(source);
    const a = await client.call('items.watch', { filter: { assignee: ['@me'], open: true } });
    const b = await client.call('items.watch', { filter: { sprint: ['current'] } });
    expect(subscriptions.count).toBe(2);
    expect(await client.call('items.unwatch', { sub: a.sub })).toEqual({ ok: true });
    expect(((await client.call('items.unwatch', { sub: a.sub }).catch(e => e)) as DaemonError).kind).toBe('not_found');

    source.set(item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80', rev: 2, assignee: ANA, changedAt: later(30_000) }));
    source.set(item(3, { assignee: ANA, title: 'Mudou', rev: 2, changedAt: later(30_000) }));
    advance(MIN);
    await cache.incrementalSync();
    await settle();
    expect(pushes.map(p => p.sub)).toEqual([b.sub]);

    client.close();
    await client.closed;
    await settle();
    expect(subscriptions.count).toBe(0);
  });

  it('refuses a bad unwatch and a bad sync.run before touching the engine', async () => {
    const { client } = await watchSetup(project());
    expect(((await client.call('items.unwatch', {} as never).catch(e => e)) as DaemonError).kind).toBe('invalid_request');
    expect(((await client.call('sync.run', { full: 'yes' } as never).catch(e => e)) as DaemonError).kind).toBe('invalid_request');
    client.close();
  });

  it('runs sync.run as incremental, or full with full: true', async () => {
    const source = project();
    const { cache, client } = await watchSetup(source);
    await cache.fullSync();
    source.queries.length = 0;
    advance(MIN);
    await client.call('sync.run', {});
    expect(source.queries.some(q => q.includes('[System.AssignedTo] = @me'))).toBe(false);
    await client.call('sync.run', { full: true });
    expect(source.queries.some(q => q.includes('[System.AssignedTo] = @me'))).toBe(true);
    client.close();
  });

  it('broadcasts an event to every connection that said hello', async () => {
    const { server, client } = await watchSetup(project());
    const second = await connectDaemon({ port: server.port, token: TOKEN });
    const seen: unknown[] = [];
    client.onEvent(event => seen.push(event));
    second.onEvent(event => seen.push(event));
    server.broadcast(serverEvent('status', { hello: 'world' }));
    await settle();
    expect(seen).toEqual([
      { event: 'status', data: { hello: 'world' } },
      { event: 'status', data: { hello: 'world' } },
    ]);
    client.close();
    second.close();
  });
});
