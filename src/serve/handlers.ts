import { DEFAULT_COMMENTS, MAX_COMMENTS } from './detail';
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

function boundedInteger(params: Record<string, unknown>, name: string, min: number, max: number, fallback: number): number {
  const value = params[name];
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ProtocolError('invalid_request', `"${name}" must be an integer from ${min} to ${max}`);
  }
  return value as number;
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
    'items.detail': params => {
      const raw = params as unknown as Record<string, unknown>;
      const id = requireId(raw);
      const comments = boundedInteger(raw, 'comments', 0, MAX_COMMENTS, DEFAULT_COMMENTS);
      return engine().detail(id, comments, optionalFlag(raw, 'history'));
    },
    'items.setState': async params => {
      const raw = params as unknown as Record<string, unknown>;
      const id = requireId(raw);
      if (typeof raw.state !== 'string' || !raw.state.trim()) throw new ProtocolError('invalid_request', '"state" must be a state name');
      if (raw.comment !== undefined && typeof raw.comment !== 'string') throw new ProtocolError('invalid_request', '"comment" must be text');
      const rev = raw.rev === undefined ? undefined : boundedInteger(raw, 'rev', 1, Number.MAX_SAFE_INTEGER, 0);
      const card = await engine().setState({
        id,
        state: raw.state,
        ...(rev !== undefined ? { rev } : {}),
        ...(raw.comment ? { comment: raw.comment as string } : {}),
      });
      return { card };
    },
    'items.watch': async (params, conn) => {
      const query = parseItemsQuery(params as Record<string, unknown>);
      const result = await engine().query(query, { keep: true });
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
