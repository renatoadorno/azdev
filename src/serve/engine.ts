import type { Card, ItemsResult, Meta, ServeError, Status } from '../interfaces/Serve';
import type { RawItem, SyncSource } from '../interfaces/Sync';
import { buildWiql } from '../services/queryBuilder';
import { createCardContext, itemFields, toCard } from './cards';
import { toServeError } from './errors';
import { matchContext, queryCards, type ParsedQuery } from './filters';
import { buildMeta } from './meta';
import { defaultScopes, itemsToKeep, scopeCondition, scopeContext, type Scope } from './scopes';
import { readSnapshot, writeSnapshot } from './snapshot';
import { ItemStore } from './store';

/** Types, states and sprints barely change; a day-old copy is refreshed behind the answer. */
const META_TTL_MS = 12 * 60 * 60 * 1000;
/** A full sync also notices deletions, which an incremental one cannot see. */
const FULL_SYNC_EVERY_MS = 30 * 60 * 1000;
/** Ids per `IN (…)`, well under WIQL's 32k-character limit. */
const IN_CHUNK = 500;

export interface SyncResult {
  changed: number;
  removed: number;
  syncedAt: string;
}

export interface EngineOptions {
  orgUrl: string;
  project: string;
  source: SyncSource;
  /** Where to keep the snapshot; none in tests. */
  snapshotFile?: string;
  watched?(): number[];
  now?(): Date;
  /** After every successful call to Azure DevOps — the credential works. */
  onSuccess?(): void;
  onError?(error: ServeError): void;
  log?(event: string, fields?: Record<string, unknown>): void;
}

function notFound(id: number): Error {
  return Object.assign(new Error(`Work item ${id} not found`), { statusCode: 404 });
}

function parentOf(item: RawItem): number | undefined {
  const parent = item.fields['System.Parent'];
  return typeof parent === 'number' ? parent : undefined;
}

/**
 * The daemon's cache: metadata, the items of the tracked scopes (plus their
 * parents and children) and the cards derived from them. Concurrent callers of
 * the same sync share one run.
 */
export class SyncEngine {
  private readonly store = new ItemStore();
  private source: SyncSource;
  private meta: Meta | null = null;
  private metaFetchedAt = 0;
  private fields: string[] = [];
  private scopes: Scope[] = [];
  private syncedAt: string | null = null;
  private fullSyncedAt: string | null = null;
  private syncedThisRun = false;
  private lastError: (ServeError & { at: string }) | null = null;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private cardCache: { seq: number; meta: Meta; cards: Map<number, Card> } | null = null;

  constructor(private readonly options: EngineOptions) {
    this.source = options.source;
  }

  /** A new credential (re-read after a 401) means a new client; the cache stays. */
  setSource(source: SyncSource): void {
    this.source = source;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const promise = run().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /** Every call to Azure DevOps goes through here, so the last error and the login state stay current. */
  private async call<T>(request: () => Promise<T>): Promise<T> {
    try {
      const result = await request();
      this.options.onSuccess?.();
      return result;
    } catch (err) {
      const error = toServeError(err);
      this.lastError = { ...error, at: this.now().toISOString() };
      this.options.onError?.(error);
      throw err;
    }
  }

  /** Loads the last snapshot, so the first answer after a restart needs no network. */
  loadSnapshot(): boolean {
    const file = this.options.snapshotFile;
    if (!file) return false;
    const snapshot = readSnapshot(file, { orgUrl: this.options.orgUrl, project: this.options.project });
    if (!snapshot) return false;
    this.meta = snapshot.meta;
    this.metaFetchedAt = Date.parse(snapshot.meta.fetchedAt) || 0;
    this.fields = snapshot.fields;
    this.syncedAt = snapshot.syncedAt;
    this.fullSyncedAt = snapshot.fullSyncedAt;
    this.store.upsert(snapshot.items);
    this.options.log?.('snapshot-loaded', { items: snapshot.items.length, savedAt: snapshot.savedAt });
    return true;
  }

  saveSnapshot(): void {
    const file = this.options.snapshotFile;
    if (!file || !this.meta) return;
    try {
      writeSnapshot(file, {
        schema: 1,
        orgUrl: this.options.orgUrl,
        project: this.options.project,
        savedAt: this.now().toISOString(),
        syncedAt: this.syncedAt,
        fullSyncedAt: this.fullSyncedAt,
        meta: this.meta,
        fields: this.fields,
        items: this.store.all(),
      });
    } catch (err) {
      // A full disk must not take the daemon down; the cache still works in memory.
      this.options.log?.('snapshot-failed', { message: (err as Error).message });
    }
  }

  async getMeta(): Promise<Meta> {
    if (this.meta && this.now().getTime() - this.metaFetchedAt < META_TTL_MS) return this.meta;
    if (this.meta) {
      void this.refreshMeta().catch(() => {});
      return this.meta;
    }
    return this.refreshMeta();
  }

  private refreshMeta(): Promise<Meta> {
    return this.once('meta', async () => {
      const raw = await this.call(() => this.source.fetchMeta());
      const meta = buildMeta(raw, { orgUrl: this.options.orgUrl, project: this.options.project, now: this.now() });
      // Another login, another "mine": nothing cached for the previous one holds.
      if (this.meta && this.meta.me.id !== meta.me.id) this.store.remove(this.store.ids());
      this.meta = meta;
      this.metaFetchedAt = this.now().getTime();
      this.fields = itemFields(raw.fieldRefs);
      return meta;
    });
  }

  private async freshMeta(): Promise<Meta> {
    return this.meta && this.now().getTime() - this.metaFetchedAt < META_TTL_MS ? this.meta : this.refreshMeta();
  }

  private fetch(ids: number[]): Promise<RawItem[]> {
    return ids.length ? this.call(() => this.source.fetchItems(ids, this.fields)) : Promise.resolve([]);
  }

  private async childIds(parentIds: number[]): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < parentIds.length; i += IN_CHUNK) {
      const chunk = parentIds.slice(i, i + IN_CHUNK);
      ids.push(...(await this.call(() => this.source.runQuery(buildWiql([`[System.Parent] IN (${chunk.join(', ')})`])))));
    }
    return ids;
  }

  /** Re-reads every scope: picks up new items, drops those that left or were deleted. */
  fullSync(): Promise<SyncResult> {
    return this.once('full', () => this.runFullSync());
  }

  private async runFullSync(): Promise<SyncResult> {
    // The first sync of a run re-reads the metadata: a snapshot's may belong to
    // another login, or predate a change to the process.
    const meta = this.syncedThisRun ? await this.freshMeta() : await this.refreshMeta();
    const context = scopeContext(meta);
    this.scopes = defaultScopes(meta, this.options.watched?.() ?? [], this.now());

    const memberIds = new Set<number>();
    for (const scope of this.scopes) {
      const ids = await this.call(() => this.source.runQuery(buildWiql([scopeCondition(scope.rule, context)])));
      for (const id of ids) memberIds.add(id);
    }
    const members = await this.fetch([...memberIds]);
    const parents = members.map(parentOf).filter((id): id is number => id !== undefined && !memberIds.has(id));
    const children = (await this.childIds([...memberIds])).filter(id => !memberIds.has(id));
    const fetched = [...members, ...(await this.fetch([...new Set([...parents, ...children])]))];

    const keep = itemsToKeep(fetched, this.scopes, context);
    const kept = fetched.filter(item => keep.has(item.id));
    const keptIds = new Set(kept.map(item => item.id));
    const changed = this.store.upsert(kept);
    const removed = this.store.remove(this.store.ids().filter(id => !keptIds.has(id)));

    const syncedAt = this.now().toISOString();
    const first = !this.syncedThisRun;
    this.syncedAt = syncedAt;
    this.fullSyncedAt = syncedAt;
    this.syncedThisRun = true;
    this.lastError = null;
    if (first || changed.length || removed.length) this.saveSnapshot();
    this.options.log?.('full-sync', { items: this.store.size, changed: changed.length, removed: removed.length });
    return { changed: changed.length, removed: removed.length, syncedAt };
  }

  /**
   * Makes the cache answerable: waits for a first sync only when there is nothing
   * to show; otherwise answers now and refreshes behind it when stale.
   */
  async ready(): Promise<void> {
    if (!this.meta || (this.store.size === 0 && !this.fullSyncedAt)) {
      await this.fullSync();
      return;
    }
    const age = this.now().getTime() - Date.parse(this.fullSyncedAt ?? '');
    if (!this.syncedThisRun || !(age < FULL_SYNC_EVERY_MS)) void this.fullSync().catch(() => {});
  }

  /** Not confirmed by a sync of this run, or the last attempt failed. */
  private isStale(): boolean {
    return !this.syncedThisRun || this.lastError !== null;
  }

  private cards(): Map<number, Card> {
    const meta = this.meta!;
    if (this.cardCache && this.cardCache.seq === this.store.seq && this.cardCache.meta === meta) return this.cardCache.cards;
    const context = createCardContext(meta, this.store, this.now());
    const cards = new Map(this.store.all().map(item => [item.id, toCard(item, context)]));
    this.cardCache = { seq: this.store.seq, meta, cards };
    return cards;
  }

  list(query: ParsedQuery): ItemsResult {
    const meta = this.meta!;
    const result = queryCards([...this.cards().values()], query, matchContext(query.filter, meta, this.now()));
    return { ...result, seq: this.store.seq, syncedAt: this.syncedAt, stale: this.isStale(), source: 'cache' };
  }

  /** From the cache, or fetched when the card is outside every scope (a parent's parent, a link). */
  async card(id: number): Promise<Card> {
    const cached = this.cards().get(id);
    if (cached) return cached;
    const [item] = await this.fetch([id]);
    if (!item) throw notFound(id);
    return toCard(item, createCardContext(this.meta!, this.store, this.now()));
  }

  cacheStatus(): Status['cache'] {
    return { items: this.store.size, syncedAt: this.syncedAt, fullSyncedAt: this.fullSyncedAt, stale: this.isStale() };
  }

  syncStatus(): Status['sync'] {
    return { running: this.inflight.has('full'), nextAt: null, backoffUntil: null, lastError: this.lastError };
  }
}
