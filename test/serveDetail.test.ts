import { afterEach, describe, expect, it } from 'bun:test';
import { DaemonError, connectDaemon } from '../src/serve/client';
import { LruCache, detailKey, toCardDetail } from '../src/serve/detail';
import { SyncEngine } from '../src/serve/engine';
import { toServeError } from '../src/serve/errors';
import { parseItemsQuery } from '../src/serve/filters';
import { dataHandlers } from '../src/serve/handlers';
import { buildMeta } from '../src/serve/meta';
import { ProtocolError } from '../src/serve/protocol';
import { startServer, type RunningServer } from '../src/serve/server';
import { planStateChange } from '../src/serve/stateChange';
import { Subscriptions, followEngine } from '../src/serve/subscriptions';
import { slimIdentities, toRawItem } from '../src/services/rawItem';
import type { Card, Status } from '../src/interfaces/Serve';
import { ANA, FakeSource, NOW, ORG, PROJECT, RAW_META, item } from './serveFixtures';

const meta = buildMeta(RAW_META, { orgUrl: ORG, project: PROJECT, now: NOW });

describe('planStateChange', () => {
  const task = (state: string) => ({ type: 'Task', state });

  it('sends the type\'s own spelling of a state named in another case', () => {
    expect(planStateChange(meta, task('To Do'), 'in progress')).toEqual({ same: false, state: 'In Progress' });
    expect(planStateChange(meta, task('To Do'), ' HOMOLOGING ')).toEqual({ same: false, state: 'homologing' });
  });

  it('writes nothing when the card is already there, whatever the case', () => {
    expect(planStateChange(meta, task('In Progress'), 'in progress')).toEqual({ same: true });
  });

  it('follows the transitions, not the list of states: a removed Task cannot go to Done', () => {
    expect(() => planStateChange(meta, task('Removed'), 'Done')).toThrow(ProtocolError);
    try {
      planStateChange(meta, task('Removed'), 'In Progress');
      throw new Error('expected a refusal');
    } catch (err) {
      expect(toServeError(err)).toMatchObject({
        kind: 'invalid_state',
        hint: 'Valid states: To Do, homologing',
        details: { current: 'Removed', validStates: ['To Do', 'homologing'] },
      });
    }
  });

  it('allows any other state of the type when the process reports no transitions', () => {
    expect(planStateChange(meta, { type: 'Product Backlog Item', state: 'New' }, 'committed')).toEqual({ same: false, state: 'Committed' });
    expect(() => planStateChange(meta, { type: 'Product Backlog Item', state: 'New' }, 'Nope')).toThrow('cannot go to');
  });
});

describe('toRawItem', () => {
  it('reduces identities to name and account, and keeps only the asked fields', () => {
    const identity = { displayName: 'Ana', uniqueName: 'ana@acme.com', imageUrl: 'x', _links: {}, descriptor: 'y' };
    expect(slimIdentities({ 'System.AssignedTo': identity, 'System.Title': 'T' })).toEqual({
      'System.AssignedTo': { displayName: 'Ana', uniqueName: 'ana@acme.com' },
      'System.Title': 'T',
    });
    const raw = toRawItem({ id: 7, rev: 3, fields: { 'System.Title': 'T', 'System.Description': 'long', 'System.ChangedBy': identity } }, [
      'system.title',
      'System.ChangedBy',
    ]);
    expect(raw).toEqual({ id: 7, rev: 3, fields: { 'System.Title': 'T', 'System.ChangedBy': { displayName: 'Ana', uniqueName: 'ana@acme.com' } } });
  });

  it('refuses an item without id or revision', () => {
    expect(toRawItem({ id: 7 })).toBeNull();
    expect(toRawItem({ rev: 1 })).toBeNull();
    expect(toRawItem(null)).toBeNull();
  });
});

describe('toCardDetail', () => {
  const card = { id: 3, rev: 2, commentCount: 1 } as Card;

  it('maps what viewWorkItem returns to the protocol, and survives a view with nothing in it', () => {
    const detail = toCardDetail(card, new FakeSource().view, [{ rev: 1 }]);
    expect(detail).toMatchObject({
      description: 'Descrição',
      comments: { total: 1, items: [{ id: 5, author: 'Ana', text: 'Oi' }] },
      children: [{ id: 1, type: 'Task', state: 'To Do', title: 'Filha' }],
      links: [{ id: 9, link: 'Related', type: 'Bug', title: 'Parente' }],
      attachments: [{ name: 'a.pdf', url: 'https://dev.azure.com/acme/_apis/wit/attachments/def' }],
      history: [{ rev: 1 }],
    });
    expect(toCardDetail(card, {})).toEqual({ card, comments: { total: 0, items: [] }, children: [], links: [], images: [], attachments: [] });
  });
});

describe('LruCache', () => {
  it('drops the least recently used entry when full, and a read renews', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([1, undefined, 3]);
    expect(cache.size).toBe(2);
  });

  it('keys a detail by card revision, comment count and the way it was asked', () => {
    const key = detailKey({ id: 1, rev: 2, commentCount: 3 }, 20, false);
    expect(key).not.toBe(detailKey({ id: 1, rev: 3, commentCount: 3 }, 20, false));
    expect(key).not.toBe(detailKey({ id: 1, rev: 2, commentCount: 4 }, 20, false));
    expect(key).not.toBe(detailKey({ id: 1, rev: 2, commentCount: 3 }, 5, false));
    expect(key).not.toBe(detailKey({ id: 1, rev: 2, commentCount: 3 }, 20, true));
  });
});

describe('upstream state errors', () => {
  it('reads the API rule error and the service\'s explanation as invalid_state, and a failed test /rev as conflict', () => {
    expect(toServeError(new Error('TF401320: Rule Error for field State.')).kind).toBe('invalid_state');
    expect(toServeError(new Error('State "Done" is not valid for Issue. Valid states: New')).kind).toBe('invalid_state');
    expect(toServeError(Object.assign(new Error('boom'), { statusCode: 412 })).kind).toBe('conflict');
  });
});

function project() {
  return new FakeSource([
    item(100, { type: 'Product Backlog Item', state: 'Committed', title: 'História', assignee: ANA, sprint: 'Demo\\Sprint 80' }),
    item(1, { parent: 100, state: 'In Progress', sprint: 'Demo\\Sprint 80', comments: 2 }),
    item(3, { assignee: ANA }),
    item(5, { assignee: ANA, sprint: 'Demo\\Sprint 81' }),
  ]);
}

function engine(source: FakeSource): SyncEngine {
  return new SyncEngine({ orgUrl: ORG, project: PROJECT, source, now: () => NOW });
}

describe('SyncEngine.detail', () => {
  it('answers from memory until the card changes', async () => {
    const source = project();
    const cache = engine(source);
    const first = await cache.detail(1);
    expect(first).toMatchObject({ card: { id: 1, rev: 1 }, description: 'Descrição' });
    expect(await cache.detail(1)).toBe(first);
    expect(source.detailCalls).toEqual([{ id: 1, comments: 20 }]);

    await cache.setState({ id: 1, state: 'Done' });
    await cache.detail(1);
    expect(source.detailCalls).toHaveLength(2);
  });

  it('asks again for another number of comments, and only reads revisions when history is asked', async () => {
    const source = project();
    source.revisions = [
      { rev: 1, fields: { 'System.State': 'To Do', 'System.ChangedDate': '2026-10-20T10:00:00Z', 'System.ChangedBy': 'Ana' } },
      { rev: 2, fields: { 'System.State': 'Done', 'System.ChangedDate': '2026-10-21T10:00:00Z', 'System.ChangedBy': 'Ana' } },
    ];
    const cache = engine(source);
    expect((await cache.detail(1, 5)).history).toBeUndefined();
    expect(source.revisionCalls).toEqual([]);
    const withHistory = await cache.detail(1, 5, true);
    expect(withHistory.history).toHaveLength(2);
    expect(source.detailCalls.map(call => call.comments)).toEqual([5, 5]);
  });

  it('reads a card outside every scope live, and answers not_found for one that does not exist', async () => {
    const cache = engine(project());
    expect((await cache.detail(5)).card.id).toBe(5);
    expect(toServeError(await cache.detail(999).catch(e => e)).kind).toBe('not_found');
  });
});

describe('SyncEngine.setState', () => {
  it('writes the type\'s spelling with the revision, and the cache has the new state at once', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    const card = await cache.setState({ id: 1, state: 'homologing', rev: 1, comment: 'Pronto' });
    expect(card).toMatchObject({ id: 1, rev: 2, state: 'homologing', stateCategory: 'InProgress' });
    expect(source.writes).toEqual([{ id: 1, state: 'homologing', rev: 1, comment: 'Pronto' }]);
    expect((await cache.card(1)).state).toBe('homologing');
  });

  it('writes nothing when the state is the current one', async () => {
    const source = project();
    const cache = engine(source);
    expect(await cache.setState({ id: 1, state: 'in progress' })).toMatchObject({ id: 1, state: 'In Progress', rev: 1 });
    expect(source.writes).toEqual([]);
  });

  it('refuses a state the transitions do not allow, before calling the API', async () => {
    const source = project();
    source.set(item(8, { state: 'Removed' }));
    const cache = engine(source);
    const err = toServeError(await cache.setState({ id: 8, state: 'Done' }).catch(e => e));
    expect(err).toMatchObject({ kind: 'invalid_state', details: { current: 'Removed', validStates: ['To Do', 'homologing'] } });
    expect(source.writes).toEqual([]);
  });

  it('answers conflict, and leaves the cache as it was, when the card moved on', async () => {
    const source = project();
    const cache = engine(source);
    await cache.fullSync();
    source.set(item(1, { parent: 100, state: 'To Do', sprint: 'Demo\\Sprint 80', rev: 4 }));
    const err = toServeError(await cache.setState({ id: 1, state: 'Done', rev: 1 }).catch(e => e));
    expect(err.kind).toBe('conflict');
    expect((await cache.card(1)).state).toBe('In Progress');
  });

  it('takes a card out of "mine, open" when it is done, and tells the watchers', async () => {
    const source = project();
    const cache = engine(source);
    const subscriptions = new Subscriptions();
    followEngine(cache, subscriptions);
    await cache.fullSync();
    const sent: unknown[] = [];
    const query = parseItemsQuery({ filter: { assignee: ['@me'], open: true }, fields: ['state'] });
    subscriptions.add({ id: 1, send: m => sent.push(m), close() {}, onClose() {} }, query, cache.list(query));

    const card = await cache.setState({ id: 1, state: 'Done' });
    expect(card.state).toBe('Done');
    expect(cache.list(query).items).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ result: { total: 0 } });
  });
});

describe('items.detail and items.setState over the protocol', () => {
  const TOKEN = 'f'.repeat(64);
  const servers: RunningServer[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
  });

  async function connect(source: FakeSource) {
    const cache = engine(source);
    const server = startServer({
      token: TOKEN,
      version: '0.11.0',
      status: () => ({ version: '0.11.0' }) as Status,
      handlers: dataHandlers(() => cache, new Subscriptions()),
    });
    servers.push(server);
    return connectDaemon({ port: server.port, token: TOKEN });
  }

  it('returns the detail and the moved card', async () => {
    const source = project();
    const client = await connect(source);
    expect(await client.call('items.detail', { id: 1, comments: 3 })).toMatchObject({ card: { id: 1 }, comments: { total: 1 } });
    expect(source.detailCalls).toEqual([{ id: 1, comments: 3 }]);
    expect((await client.call('items.setState', { id: 1, state: 'Done', rev: 1 })).card).toMatchObject({ state: 'Done', rev: 2 });
    client.close();
  });

  it('carries the valid states of a refused move, and the conflict kind', async () => {
    const source = project();
    source.set(item(8, { state: 'Removed' }));
    const client = await connect(source);
    const refused = (await client.call('items.setState', { id: 8, state: 'Done' }).catch(e => e)) as DaemonError;
    expect(refused.kind).toBe('invalid_state');
    expect(refused.error.details).toEqual({ current: 'Removed', validStates: ['To Do', 'homologing'] });
    expect(refused.error.hint).toContain('To Do');

    source.set(item(1, { parent: 100, state: 'To Do', sprint: 'Demo\\Sprint 80', rev: 6 }));
    expect(((await client.call('items.setState', { id: 1, state: 'Done', rev: 1 }).catch(e => e)) as DaemonError).kind).toBe('conflict');
    client.close();
  });

  it('refuses bad params before touching the engine', async () => {
    const client = await connect(project());
    const kind = async (method: 'items.detail' | 'items.setState', params: object) =>
      ((await client.call(method, params as never).catch(e => e)) as DaemonError).kind;
    expect(await kind('items.detail', { id: 0 })).toBe('invalid_request');
    expect(await kind('items.detail', { id: 1, comments: 500 })).toBe('invalid_request');
    expect(await kind('items.detail', { id: 1, history: 'yes' })).toBe('invalid_request');
    expect(await kind('items.setState', { id: 1 })).toBe('invalid_request');
    expect(await kind('items.setState', { id: 1, state: 'Done', rev: 'x' })).toBe('invalid_request');
    expect(await kind('items.setState', { id: 1, state: 'Done', comment: 3 })).toBe('invalid_request');
    client.close();
  });
});
