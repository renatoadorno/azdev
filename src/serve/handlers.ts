import type { SyncEngine } from './engine';
import { parseItemsQuery } from './filters';
import { ProtocolError } from './protocol';
import type { Handlers } from './session';
import type { Subscriptions } from './subscriptions';

/** A positive integer `id` param, or invalid_request. */
export function requireId(params: Record<string, unknown>, name = 'id'): number {
  const value = params[name];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ProtocolError('invalid_request', `"${name}" must be a work item id`);
  }
  return value as number;
}

function optionalFlag(params: Record<string, unknown>, name: string): boolean {
  const value = params[name];
  if (value !== undefined && typeof value !== 'boolean') throw new ProtocolError('invalid_request', `"${name}" must be true or false`);
  return value === true;
}

/**
 * Methods answered from the cache. Params are checked before the engine is asked
 * for, so a malformed request fails the same way with or without a login.
 */
export function dataHandlers(engine: () => SyncEngine, subscriptions: Subscriptions): Handlers {
  return {
    'meta.get': () => engine().getMeta(),
    'items.list': async params => {
      const query = parseItemsQuery(params as Record<string, unknown>);
      return engine().query(query);
    },
    'items.get': async params => {
      const id = requireId(params);
      const cache = engine();
      await cache.ready();
      return { card: await cache.card(id) };
    },
    'items.watch': async (params, conn) => {
      const query = parseItemsQuery(params as Record<string, unknown>);
      const result = await engine().query(query);
      return { sub: subscriptions.add(conn, query, result), ...result };
    },
    'items.unwatch': (params, conn) => {
      const sub = (params as Record<string, unknown>).sub;
      if (typeof sub !== 'string' || !sub) throw new ProtocolError('invalid_request', '"sub" must be a subscription id');
      if (!subscriptions.remove(conn, sub)) throw new ProtocolError('not_found', `No subscription ${sub} on this connection`);
      return { ok: true };
    },
    'sync.run': params => {
      const full = optionalFlag(params as Record<string, unknown>, 'full');
      return engine().sync(full);
    },
  };
}
