import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigError } from '../src/cli/config';
import { DaemonError, connectDaemon } from '../src/serve/client';
import { SyncEngine, type EngineOptions } from '../src/serve/engine';
import { parseItemsQuery } from '../src/serve/filters';
import { dataHandlers } from '../src/serve/handlers';
import { startServer, type RunningServer } from '../src/serve/server';
import { Subscriptions } from '../src/serve/subscriptions';
import type { Status } from '../src/interfaces/Serve';
import { ANA, FakeSource, NOW, ORG, PROJECT, RAW_META, item, offlineError } from './serveFixtures';

/** My open card in an old sprint, its story, a sprint card of Ana's, and noise outside every scope. */
function project() {
  return new FakeSource([
    item(100, { type: 'Product Backlog Item', state: 'Committed', title: 'História', assignee: ANA, sprint: 'Demo\\Sprint 80' }),
    item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80' }),
    item(2, { parent: 100, state: 'To Do', assignee: ANA, sprint: 'Demo\\Sprint 80' }),
    item(3, { assignee: ANA }),
    item(4, { state: 'Done', sprint: 'Demo\\Sprint 79' }),
    item(5, { assignee: ANA, sprint: 'Demo\\Sprint 79' }),
  ]);
}

const dirs: string[] = [];
const servers: RunningServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function snapshotFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azdev-engine-'));
  dirs.push(dir);
  return path.join(dir, 'snapshot.json');
}

function engine(source: FakeSource, options: Partial<EngineOptions> = {}): SyncEngine {
  return new SyncEngine({ orgUrl: ORG, project: PROJECT, source, now: () => NOW, ...options });
}

const allIds = (cache: SyncEngine) =>
  cache
    .list(parseItemsQuery({ sort: ['id'], limit: 1000 }))
    .items.map(card => card.id);

describe('full sync', () => {
  it('keeps my open cards, the current sprint, and the parents and children of those', async () => {
    const source = project();
    const cache = engine(source);
    expect(await cache.fullSync()).toMatchObject({ changed: 3, removed: 0 });
    // 1 is mine and open, 3 is in the current sprint, 100 is 1's parent. 2 is a child of 100,
    // which is no member itself, and 4 (done), 5 (Ana's, old sprint) are in no scope.
    expect(allIds(cache)).toEqual([1, 3, 100]);
  });

  it('asks only for the fields the project has', async () => {
    const source = project();
    await engine(source).fullSync();
    const fields = source.fetches[0]!.fields;
    expect(fields).toContain('System.Parent');
    expect(fields).not.toContain('Microsoft.VSTS.Scheduling.Effort');
  });

  it('reports nothing changed when revisions are the same, and drops what left every scope', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    const seq = cache.list(parseItemsQuery({})).seq;
    expect(await cache.fullSync()).toMatchObject({ changed: 0, removed: 0 });
    expect(cache.list(parseItemsQuery({})).seq).toBe(seq);

    source.set(item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80', assignee: ANA, rev: 2 }));
    expect(await cache.fullSync()).toMatchObject({ changed: 0, removed: 2 });
    expect(allIds(cache)).toEqual([3]);
  });

  it('picks up a new revision as a change', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.set(item(3, { assignee: ANA, title: 'Renamed', rev: 5 }));
    expect(await cache.fullSync()).toMatchObject({ changed: 1, removed: 0 });
    expect((await cache.card(3)).title).toBe('Renamed');
  });

  it('shares one run between concurrent callers', async () => {
    const source = project();
    const cache = engine(source);
    const [a, b] = [cache.fullSync(), cache.fullSync()];
    expect(a).toBe(b);
    await a;
    expect(source.metaCalls).toBe(1);
  });

  it('follows the watch list: the watched card and its children', async () => {
    const source = project();
    const cache = engine(source, { watched: () => [100] });
    await cache.fullSync();
    expect(allIds(cache)).toEqual([1, 2, 3, 100]);
  });

  it('records a 401 as needs_login and marks the cache stale', async () => {
    const source = project();
    const errors: string[] = [];
    const cache = engine(source, { onError: error => errors.push(error.kind) });
    await cache.fullSync();
    source.failWith = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    await expect(cache.fullSync()).rejects.toThrow('Unauthorized');
    expect(errors).toEqual(['needs_login']);
    expect(cache.syncStatus().lastError?.kind).toBe('needs_login');
    expect(cache.cacheStatus().stale).toBe(true);
    expect(allIds(cache)).toEqual([1, 3, 100]);
  });
});

describe('ready and card', () => {
  it('waits for the first sync when there is nothing to show', async () => {
    const cache = engine(project());
    await cache.ready();
    expect(cache.cacheStatus()).toMatchObject({ items: 3, stale: false });
  });

  it('fetches a card outside every scope, and answers not_found for one that does not exist', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    expect((await cache.card(5)).id).toBe(5);
    expect(allIds(cache)).not.toContain(5);
    await expect(cache.card(999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('snapshot', () => {
  it('lets a new engine answer at once, with no network, and refresh behind', async () => {
    const file = snapshotFile();
    await engine(project(), { snapshotFile: file }).fullSync();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const offline = project();
    offline.failWith = offlineError();
    const restarted = engine(offline, { snapshotFile: file });
    expect(restarted.loadSnapshot()).toBe(true);
    await restarted.ready();
    expect(allIds(restarted)).toEqual([1, 3, 100]);
    expect(restarted.cacheStatus().stale).toBe(true);
  });

  it('is ignored for another project', async () => {
    const file = snapshotFile();
    await engine(project(), { snapshotFile: file }).fullSync();
    expect(new SyncEngine({ orgUrl: ORG, project: 'Other', source: project(), snapshotFile: file }).loadSnapshot()).toBe(false);
  });

  it('is dropped when the login belongs to someone else', async () => {
    const file = snapshotFile();
    await engine(project(), { snapshotFile: file }).fullSync();
    const other = project();
    other.meta = { ...RAW_META, me: { id: 'other-guid', name: 'Ana', email: 'ana@acme.com' } };
    const cache = engine(other, { snapshotFile: file });
    cache.loadSnapshot();
    await cache.fullSync();
    // Now "mine" is Ana's: 2, 3 and 5 are hers and open; 100 (hers, open) with children 1 and 2.
    expect(allIds(cache)).toEqual([1, 2, 3, 5, 100]);
  });

  it("never answers with another login's snapshot, not even the first time", async () => {
    const file = snapshotFile();
    await engine(project(), { snapshotFile: file }).fullSync();
    const other = project();
    other.meta = { ...RAW_META, me: { id: 'other-guid', name: 'Ana', email: 'ana@acme.com' } };
    const cache = engine(other, { snapshotFile: file });
    cache.loadSnapshot();

    expect((await cache.getMeta()).me.name).toBe('Ana');
    await cache.ready();
    expect(allIds(cache)).toEqual([1, 2, 3, 5, 100]);
  });

  it("checks the owner once, then serves the same login's snapshot without waiting for a sync", async () => {
    const file = snapshotFile();
    await engine(project(), { snapshotFile: file }).fullSync();
    const same = project();
    const cache = engine(same, { snapshotFile: file });
    cache.loadSnapshot();

    await cache.ready();
    expect(allIds(cache)).toEqual([1, 3, 100]);
    await cache.ready();
    expect(same.identityCalls).toBe(1);
  });

  it('refuses to show the snapshot when the credential is rejected', async () => {
    const file = snapshotFile();
    await engine(project(), { snapshotFile: file }).fullSync();
    const rejected = project();
    rejected.failWith = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    const cache = engine(rejected, { snapshotFile: file });
    cache.loadSnapshot();
    await expect(cache.ready()).rejects.toThrow('Unauthorized');
  });
});

describe('data methods over the protocol', () => {
  const TOKEN = 'd'.repeat(64);
  const STATUS = { version: '0.11.0' } as Status;

  function serveWith(requireEngine: () => SyncEngine) {
    const server = startServer({ token: TOKEN, version: '0.11.0', status: () => STATUS, handlers: dataHandlers(requireEngine, new Subscriptions()) });
    servers.push(server);
    return connectDaemon({ port: server.port, token: TOKEN });
  }

  it('answers items.list, items.get and meta.get from the cache', async () => {
    const cache = engine(project());
    const client = await serveWith(() => cache);
    const list = await client.call('items.list', { filter: { assignee: ['@me'], open: true }, fields: ['title', 'parent'] });
    expect(list).toMatchObject({ total: 1, source: 'cache', stale: false });
    expect(list.items).toEqual([{ id: 1, title: 'Card 1', parent: { id: 100, title: 'História', type: 'Product Backlog Item' } }]);
    expect((await client.call('items.get', { id: 3 })).card.assignedTo).toEqual({ name: 'Ana', email: 'ana@acme.com' });
    expect((await client.call('meta.get')).types.map(t => t.name)).toContain('Task');
    client.close();
  });

  it('refuses bad params before touching the engine', async () => {
    let asked = false;
    const client = await serveWith(() => {
      asked = true;
      return engine(project());
    });
    const err = (await client.call('items.list', { filter: { mood: 'happy' } } as never).catch(e => e)) as DaemonError;
    expect(err.kind).toBe('invalid_request');
    expect((await client.call('items.get', { id: -1 }).catch(e => e)).kind).toBe('invalid_request');
    expect(asked).toBe(false);
    client.close();
  });

  it('answers needs_login with the way out when there is no credential', async () => {
    const client = await serveWith(() => {
      throw new ConfigError('needs_login', ['No Azure DevOps credential.', "Store it with 'azdev config set personalAccessToken <value>'."]);
    });
    const err = (await client.call('items.list', {}).catch(e => e)) as DaemonError;
    expect(err.kind).toBe('needs_login');
    expect(err.error.hint).toContain('personalAccessToken');
    client.close();
  });

  it('answers not_found for a card that does not exist', async () => {
    const cache = engine(project());
    const client = await serveWith(() => cache);
    expect((await client.call('items.get', { id: 999 }).catch(e => e)).kind).toBe('not_found');
    client.close();
  });
});
