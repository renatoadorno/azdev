import type { ItemsResult } from '../interfaces/Serve';
import type { SyncEngine } from './engine';
import type { ParsedQuery } from './filters';
import { push } from './protocol';
import type { Connection } from './session';

/**
 * What decides whether a watcher hears about a result: the cards and counts.
 * `seq`, `syncedAt` and `stale` move on every sync and say nothing about the list
 * (staleness has its own `status` event).
 */
export function resultFingerprint(result: ItemsResult): string {
  return JSON.stringify([result.total, result.items, result.facets ?? null]);
}

interface Subscription {
  conn: Connection;
  query: ParsedQuery;
  fingerprint: string;
}

/** The `items.watch` subscriptions of every connection. Each push goes only to the connection that asked. */
export class Subscriptions {
  private readonly subs = new Map<string, Subscription>();
  private readonly watching = new Set<number>();
  private next = 1;

  constructor(private readonly onCountChange: () => void = () => {}) {}

  get count(): number {
    return this.subs.size;
  }

  add(conn: Connection, query: ParsedQuery, result: ItemsResult): string {
    const sub = `w${this.next++}`;
    this.subs.set(sub, { conn, query, fingerprint: resultFingerprint(result) });
    if (!this.watching.has(conn.id)) {
      this.watching.add(conn.id);
      conn.onClose(() => this.dropConnection(conn));
    }
    this.onCountChange();
    return sub;
  }

  /** Only the connection that opened a subscription can end it. */
  remove(conn: Connection, sub: string): boolean {
    const found = this.subs.get(sub);
    if (!found || found.conn.id !== conn.id) return false;
    this.subs.delete(sub);
    this.onCountChange();
    return true;
  }

  queries(): ParsedQuery[] {
    return [...this.subs.values()].map(s => s.query);
  }

  /** Recomputes every subscription and pushes those whose result changed; returns how many were pushed. */
  refresh(compute: (query: ParsedQuery) => ItemsResult): number {
    let pushed = 0;
    for (const [sub, entry] of this.subs) {
      let result: ItemsResult;
      try {
        result = compute(entry.query);
      } catch {
        // A query that stopped resolving (a sprint left the project) keeps its last result.
        continue;
      }
      const fingerprint = resultFingerprint(result);
      if (fingerprint === entry.fingerprint) continue;
      this.subs.set(sub, { ...entry, fingerprint });
      entry.conn.send(push(sub, result));
      pushed++;
    }
    return pushed;
  }

  private dropConnection(conn: Connection): void {
    this.watching.delete(conn.id);
    for (const [sub, entry] of this.subs) if (entry.conn.id === conn.id) this.subs.delete(sub);
    this.onCountChange();
  }
}

/** After every sync (and any other change of the cache) the watched queries are recomputed and the changed ones pushed. */
export function followEngine(engine: SyncEngine, subscriptions: Subscriptions, after: () => void = () => {}): () => void {
  return engine.onChange(() => {
    for (const query of subscriptions.queries()) engine.touchQuery(query);
    subscriptions.refresh(query => engine.list(query));
    after();
  });
}
