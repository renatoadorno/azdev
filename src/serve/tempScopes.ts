import type { ItemFilter } from '../interfaces/Serve';

/** A live query's scope lives this long without being asked again. */
export const TEMP_SCOPE_TTL_MS = 30 * 60_000;

export interface TempScope {
  key: string;
  filter: ItemFilter;
  wiql: string;
  /** The ids the query brought back, plus the ones that joined it since (see the incremental sync). */
  members: Set<number>;
  lastUsedAt: number;
}

/**
 * Scopes of the live queries that were asked: what a filter needs beyond the
 * default scopes. Each one keeps its items in the cache until it goes unused.
 */
export class TempScopes {
  private readonly scopes = new Map<string, TempScope>();

  get size(): number {
    return this.scopes.size;
  }

  all(): TempScope[] {
    return [...this.scopes.values()];
  }

  get(key: string): TempScope | undefined {
    return this.scopes.get(key);
  }

  touch(key: string, now: number): void {
    const scope = this.scopes.get(key);
    if (scope) scope.lastUsedAt = now;
  }

  set(scope: Omit<TempScope, 'lastUsedAt'>, now: number): TempScope {
    const stored = { ...scope, lastUsedAt: now };
    this.scopes.set(scope.key, stored);
    return stored;
  }

  /** Drops the scopes unused for the TTL; returns them. */
  expire(now: number, ttlMs = TEMP_SCOPE_TTL_MS): TempScope[] {
    const gone = this.all().filter(scope => now - scope.lastUsedAt >= ttlMs);
    for (const scope of gone) this.scopes.delete(scope.key);
    return gone;
  }

  /** Every id some live scope holds. */
  memberIds(): Set<number> {
    const ids = new Set<number>();
    for (const scope of this.scopes.values()) for (const id of scope.members) ids.add(id);
    return ids;
  }
}
