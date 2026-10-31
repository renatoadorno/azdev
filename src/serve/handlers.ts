import type { SyncEngine } from './engine';
import { parseItemsQuery } from './filters';
import { ProtocolError } from './protocol';
import type { Handlers } from './session';

/** A positive integer `id` param, or invalid_request. */
export function requireId(params: Record<string, unknown>, name = 'id'): number {
  const value = params[name];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ProtocolError('invalid_request', `"${name}" must be a work item id`);
  }
  return value as number;
}

/**
 * Methods answered from the cache. Params are checked before the engine is asked
 * for, so a malformed request fails the same way with or without a login.
 */
export function dataHandlers(engine: () => SyncEngine): Handlers {
  return {
    'meta.get': () => engine().getMeta(),
    'items.list': async params => {
      const query = parseItemsQuery(params as Record<string, unknown>);
      const cache = engine();
      await cache.ready();
      return cache.list(query);
    },
    'items.get': async params => {
      const id = requireId(params);
      const cache = engine();
      await cache.ready();
      return { card: await cache.card(id) };
    },
    'sync.run': () => engine().fullSync(),
  };
}
