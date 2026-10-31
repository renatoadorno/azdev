import type { Card, CardDetail, ItemFilter, ItemsResult, Meta, ServeError, Status } from '../interfaces/Serve';
import type { RawItem, SyncSource } from '../interfaces/Sync';
import { DEFAULT_HISTORY_FIELDS, revisionTimeline } from '../services/history';
import { buildWiql } from '../services/queryBuilder';
import { createCardContext, itemFields, toCard } from './cards';
import { DEFAULT_COMMENTS, LruCache, detailKey, toCardDetail } from './detail';
import { planStateChange } from './stateChange';
import { toServeError } from './errors';
import { matchContext, matchesFilter, queryCards, resolveSprintPaths, type ParsedQuery } from './filters';
import { LIVE_LIMIT, filterKey, filterWiql, isTextOnly } from './liveQuery';
import { buildMeta } from './meta';
import { backoffDelay, pausesSync, refreshOnRequest, retryAfterMs, type ScheduleState } from './schedule';
import { defaultScopes, isCovered, itemsToKeep, matchesRule, scopeCondition, scopeContext, type Scope } from './scopes';
import { readSnapshot, writeSnapshot } from './snapshot';
import { ItemStore } from './store';
import { TempScopes } from './tempScopes';

/** Types, states and sprints barely change; a day-old copy is refreshed behind the answer. */
const META_TTL_MS = 12 * 60 * 60 * 1000;
/** Ids per `IN (…)`, well under WIQL's 32k-character limit. */
const IN_CHUNK = 500;
/** An incremental sync looks this far before the last one began: clocks differ and a revision may land late. */
const OVERLAP_MS = 2 * 60_000;
/** A window with more changes than this is cheaper to read as a full sync. */
export const INCREMENTAL_MAX_IDS = 1000;

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
  /**
   * After a 401: re-read the credential and swap the engine's source. True when
   * there is a new one to try; the call is then repeated once.
   */
  onUnauthorized?(): Promise<boolean>;
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
  private readonly tempScopes = new TempScopes();
  private readonly details = new LruCache<CardDetail>();
  private source: SyncSource;
  private meta: Meta | null = null;
  private metaFetchedAt = 0;
  private fields: string[] = [];
  private scopes: Scope[] = [];
  private syncedAt: string | null = null;
  private fullSyncedAt: string | null = null;
  private syncedThisRun = false;
  /** The instant the last sync's first query began: the next incremental window starts there. */
  private syncMark: number | null = null;
  private runSyncAt: number | null = null;
  private runFullAt: number | null = null;
  private failures = 0;
  private backoffUntil: number | null = null;
  private paused = false;
  private nextAt: number | null = null;
  private lastError: (ServeError & { at: string }) | null = null;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  private cardCache: { seq: number; meta: Meta; cards: Map<number, Card> } | null = null;

  constructor(private readonly options: EngineOptions) {
    this.source = options.source;
  }

  /** A new credential (re-read after a 401) means a new client; the cache stays and a paused schedule resumes. */
  setSource(source: SyncSource): void {
    this.source = source;
    this.paused = false;
    this.backoffUntil = null;
    this.failures = 0;
  }

  /** Called after every sync, however it ended, and when the cache or metadata changed outside one. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        this.options.log?.('listener-failed', { message: (err as Error).message });
      }
    }
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

  private succeeded<T>(result: T): T {
    this.options.onSuccess?.();
    return result;
  }

  /**
   * Every call to Azure DevOps goes through here, so the last error and the login
   * state stay current. A 401 re-reads the credential once and repeats the call.
   */
  private async call<T>(request: () => Promise<T>): Promise<T> {
    let failure: unknown;
    try {
      return this.succeeded(await request());
    } catch (err) {
      failure = err;
    }
    if (toServeError(failure).kind === 'needs_login' && this.options.onUnauthorized) {
      const renewed = await this.once('renew', () => this.options.onUnauthorized!());
      if (renewed) {
        try {
          return this.succeeded(await request());
        } catch (err) {
          failure = err;
        }
      }
    }
    const error = toServeError(failure);
    this.lastError = { ...error, at: this.now().toISOString() };
    this.options.onError?.(error);
    throw failure;
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
    // What the snapshot was kept for, so a query is answered from it instead of going live.
    this.scopes = defaultScopes(snapshot.meta, this.options.watched?.() ?? [], this.now());
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
      const previous = this.meta;
      // Another login, another "mine": nothing cached for the previous one holds.
      if (previous && previous.me.id !== meta.me.id) this.store.remove(this.store.ids());
      this.meta = meta;
      this.metaFetchedAt = this.now().getTime();
      this.fields = itemFields(raw.fieldRefs);
      if (previous) this.notify();
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

  /** The members, then the parents and the children they lack: a card shows its parent's title and its children's progress. */
  private async fetchWithRelatives(memberIds: number[]): Promise<RawItem[]> {
    const memberSet = new Set(memberIds);
    const members = await this.fetch(memberIds);
    const parents = members.map(parentOf).filter((id): id is number => id !== undefined && !memberSet.has(id));
    const children = (await this.childIds(memberIds)).filter(id => !memberSet.has(id));
    return [...members, ...(await this.fetch([...new Set([...parents, ...children])]))];
  }

  // ── Syncs ─────────────────────────────────────────────────────────────────

  /** What happens to the schedule when a sync ends: a backoff for most failures, a pause for the ones only a new credential fixes. */
  private async tracked(run: () => Promise<SyncResult>): Promise<SyncResult> {
    try {
      const result = await run();
      this.failures = 0;
      this.backoffUntil = null;
      this.paused = false;
      return result;
    } catch (err) {
      this.noteFailure(err);
      throw err;
    } finally {
      this.notify();
    }
  }

  private noteFailure(err: unknown): void {
    const error = toServeError(err);
    if (pausesSync(error.kind)) {
      this.paused = true;
      return;
    }
    this.failures++;
    const now = this.now().getTime();
    this.backoffUntil = now + backoffDelay(this.failures, retryAfterMs(err, now));
  }

  /** Re-reads every scope: picks up new items, drops those that left or were deleted. */
  fullSync(): Promise<SyncResult> {
    return this.once('full', async () => {
      await this.inflight.get('incremental')?.catch(() => {});
      return this.tracked(() => this.runFullSync());
    });
  }

  /** Reads what changed since the last sync; a full sync when that is not enough. */
  incrementalSync(): Promise<SyncResult> {
    const full = this.inflight.get('full');
    if (full) return full as Promise<SyncResult>;
    return this.once('incremental', () => this.tracked(() => this.runIncrementalSync()));
  }

  sync(full = false): Promise<SyncResult> {
    return full ? this.fullSync() : this.incrementalSync();
  }

  private async runFullSync(): Promise<SyncResult> {
    const startedAt = this.now();
    // The first sync of a run re-reads the metadata: a snapshot's may belong to
    // another login, or predate a change to the process.
    const meta = this.syncedThisRun ? await this.freshMeta() : await this.refreshMeta();
    const context = scopeContext(meta);
    this.expireTempScopes();
    this.scopes = defaultScopes(meta, this.options.watched?.() ?? [], startedAt);

    const memberIds = new Set<number>();
    for (const scope of this.scopes) {
      const ids = await this.call(() => this.source.runQuery(buildWiql([scopeCondition(scope.rule, context)])));
      for (const id of ids) memberIds.add(id);
    }
    for (const temp of this.tempScopes.all()) {
      const ids = (await this.call(() => this.source.runQuery(temp.wiql))).slice(0, LIVE_LIMIT);
      temp.members = new Set(ids);
      for (const id of ids) memberIds.add(id);
    }
    const fetched = await this.fetchWithRelatives([...memberIds]);

    const keep = itemsToKeep(fetched, this.scopes, context, this.tempScopes.memberIds());
    const kept = fetched.filter(item => keep.has(item.id));
    const keptIds = new Set(kept.map(item => item.id));
    const changed = this.store.upsert(kept);
    const removed = this.store.remove(this.store.ids().filter(id => !keptIds.has(id)));

    const first = !this.syncedThisRun;
    const syncedAt = this.finishSync(startedAt, true);
    if (first || changed.length || removed.length) this.saveSnapshot();
    this.options.log?.('full-sync', { items: this.store.size, changed: changed.length, removed: removed.length });
    return { changed: changed.length, removed: removed.length, syncedAt };
  }

  private async runIncrementalSync(): Promise<SyncResult> {
    const mark = this.syncMark;
    const before = this.meta;
    if (mark === null || !before || !this.syncedThisRun) return this.runFullSync();
    const meta = await this.freshMeta();
    // New metadata may mean another login or a changed process: read everything again.
    if (meta !== before) return this.runFullSync();

    const startedAt = this.now();
    const scopes = defaultScopes(meta, this.options.watched?.() ?? [], startedAt);
    if (JSON.stringify(scopes) !== JSON.stringify(this.scopes)) return this.runFullSync();
    this.expireTempScopes();

    const since = new Date(mark - OVERLAP_MS).toISOString();
    const ids = await this.call(() => this.source.runQuery(buildWiql([`[System.ChangedDate] > '${since}'`]), true));
    if (ids.length > INCREMENTAL_MAX_IDS) return this.runFullSync();

    const context = scopeContext(meta);
    const fresh = (await this.fetch(ids)).filter(item => this.store.get(item.id)?.rev !== item.rev);
    const pool = new Map(this.store.all().map(item => [item.id, item]));
    const wasMember = new Set(
      fresh.filter(item => this.isMember(this.store.get(item.id), scopes, context)).map(item => item.id),
    );
    for (const item of fresh) pool.set(item.id, item);

    this.joinTempScopes(fresh, meta, pool, startedAt);
    const joined = fresh.filter(item => !wasMember.has(item.id) && this.isMember(item, scopes, context));
    const parents = fresh.filter(item => this.isMember(item, scopes, context)).map(parentOf);
    const children = await this.childIds(joined.map(item => item.id));
    const missing = [...new Set([...parents, ...children].filter((id): id is number => id !== undefined && !pool.has(id)))];
    for (const item of await this.fetch(missing)) pool.set(item.id, item);

    const incoming = new Set([...fresh.map(item => item.id), ...missing]);
    const keep = itemsToKeep([...pool.values()], scopes, context, this.tempScopes.memberIds());
    const changed = this.store.upsert([...pool.values()].filter(item => incoming.has(item.id) && keep.has(item.id)));
    const removed = this.store.remove(this.store.ids().filter(id => !keep.has(id)));

    const syncedAt = this.finishSync(startedAt, false);
    if (changed.length || removed.length) this.saveSnapshot();
    this.options.log?.('incremental-sync', { window: ids.length, fresh: fresh.length, changed: changed.length, removed: removed.length });
    return { changed: changed.length, removed: removed.length, syncedAt };
  }

  private isMember(item: RawItem | undefined, scopes: Scope[], context: ReturnType<typeof scopeContext>): boolean {
    return item !== undefined && (scopes.some(s => matchesRule(item, s.rule, context)) || this.tempScopes.memberIds().has(item.id));
  }

  /** A changed card that now fits a live query's filter joins that query's scope. */
  private joinTempScopes(fresh: RawItem[], meta: Meta, pool: Map<number, RawItem>, now: Date): void {
    const temps = this.tempScopes.all();
    if (!temps.length) return;
    const context = createCardContext(meta, { get: id => pool.get(id), childrenOf: id => this.store.childrenOf(id) }, now);
    for (const temp of temps) {
      const match = matchContext(temp.filter, meta, now);
      for (const item of fresh) if (matchesFilter(toCard(item, context), temp.filter, match)) temp.members.add(item.id);
    }
  }

  private finishSync(startedAt: Date, full: boolean): string {
    const syncedAt = this.now().toISOString();
    this.syncedAt = syncedAt;
    this.syncMark = startedAt.getTime();
    this.runSyncAt = this.now().getTime();
    if (full) {
      this.fullSyncedAt = syncedAt;
      this.runFullAt = this.runSyncAt;
    }
    this.syncedThisRun = true;
    this.lastError = null;
    return syncedAt;
  }

  /** Drops the live scopes unused for too long, and the items only they held. */
  private expireTempScopes(): void {
    if (!this.tempScopes.expire(this.now().getTime()).length || !this.meta) return;
    const keep = itemsToKeep(this.store.all(), this.scopes, scopeContext(this.meta), this.tempScopes.memberIds());
    this.store.remove(this.store.ids().filter(id => !keep.has(id)));
  }

  // ── Schedule ──────────────────────────────────────────────────────────────

  scheduleState(): Omit<ScheduleState, 'active'> {
    return {
      now: this.now().getTime(),
      lastSyncAt: this.runSyncAt,
      lastFullAt: this.runFullAt,
      backoffUntil: this.backoffUntil,
      paused: this.paused,
    };
  }

  setNextAt(at: number | null): void {
    this.nextAt = at;
  }

  /**
   * Makes the cache answerable: waits for a first sync only when there is nothing
   * to show; otherwise answers now and refreshes behind it when the schedule says so.
   */
  async ready(): Promise<void> {
    if (!this.meta || (this.store.size === 0 && !this.fullSyncedAt)) {
      await this.fullSync();
      return;
    }
    const due = refreshOnRequest(this.scheduleState());
    if (due) void this.sync(due === 'full').catch(() => {});
  }

  /** Not confirmed by a sync of this run, or the last attempt failed. */
  private isStale(): boolean {
    return !this.syncedThisRun || this.lastError !== null;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private cards(): Map<number, Card> {
    const meta = this.meta!;
    if (this.cardCache && this.cardCache.seq === this.store.seq && this.cardCache.meta === meta) return this.cardCache.cards;
    const context = createCardContext(meta, this.store, this.now());
    const cards = new Map(this.store.all().map(item => [item.id, toCard(item, context)]));
    this.cardCache = { seq: this.store.seq, meta, cards };
    return cards;
  }

  /** From the cache only. */
  list(query: ParsedQuery): ItemsResult {
    const meta = this.meta!;
    const result = queryCards([...this.cards().values()], query, matchContext(query.filter, meta, this.now()));
    return { ...result, seq: this.store.seq, syncedAt: this.syncedAt, stale: this.isStale(), source: 'cache' };
  }

  private sprintPaths(filter: ItemFilter): string[] | null {
    return filter.sprint ? resolveSprintPaths(filter.sprint, this.meta!, this.now()) : null;
  }

  /** Two spellings of a sprint (`current`, its name) are one scope. */
  private scopeKey(filter: ItemFilter, sprintPaths: string[] | null): { key: string; filter: ItemFilter } {
    const resolved = sprintPaths ? { ...filter, sprint: sprintPaths } : filter;
    return { key: filterKey(resolved), filter: resolved };
  }

  private memberIds(): Set<number> {
    const context = scopeContext(this.meta!);
    return new Set(this.store.all().filter(item => this.scopes.some(s => matchesRule(item, s.rule, context))).map(item => item.id));
  }

  /**
   * The cards of a query: from the cache when it holds everything the filter can
   * match, otherwise asked of Azure DevOps (up to 1000 cards) and kept as a live
   * scope. A free-text search alone is answered live and kept nowhere.
   */
  async query(query: ParsedQuery): Promise<ItemsResult> {
    await this.ready();
    this.expireTempScopes();
    const sprintPaths = this.sprintPaths(query.filter);
    const { key, filter } = this.scopeKey(query.filter, sprintPaths);

    if (this.tempScopes.get(key)) {
      this.tempScopes.touch(key, this.now().getTime());
      return this.list(query);
    }
    if (isCovered(query.filter, this.scopes, { sprintPaths, memberIds: this.memberIds() })) return this.list(query);
    return this.live(query, key, filter, sprintPaths);
  }

  private async live(query: ParsedQuery, key: string, filter: ItemFilter, sprintPaths: string[] | null): Promise<ItemsResult> {
    const meta = this.meta!;
    const now = this.now();
    const wiql = filterWiql(query.filter, meta, sprintPaths, now);
    const ids = (await this.call(() => this.source.runQuery(wiql))).slice(0, LIVE_LIMIT);
    const held = await this.fetchWithRelatives(ids);

    if (isTextOnly(query.filter)) {
      const scratch = new ItemStore();
      scratch.upsert(held);
      const context = createCardContext(meta, scratch, now);
      const result = queryCards(held.map(item => toCard(item, context)), query, matchContext(query.filter, meta, now));
      return { ...result, seq: this.store.seq, syncedAt: this.syncedAt, stale: this.isStale(), source: 'live' };
    }
    this.tempScopes.set({ key, filter, wiql, members: new Set(ids) }, now.getTime());
    if (this.store.upsert(held).length) this.notify();
    return { ...this.list(query), source: 'live' };
  }

  /** A watched query is in use: keeps its live scope from expiring. */
  touchQuery(query: ParsedQuery): void {
    if (!this.meta) return;
    try {
      this.tempScopes.touch(this.scopeKey(query.filter, this.sprintPaths(query.filter)).key, this.now().getTime());
    } catch {
      // A sprint that no longer resolves has no scope to keep.
    }
  }

  liveScopes(): number {
    return this.tempScopes.size;
  }

  /** From the cache, or fetched when the card is outside every scope (a parent's parent, a link). */
  async card(id: number): Promise<Card> {
    const cached = this.cards().get(id);
    if (cached) return cached;
    const [item] = await this.fetch([id]);
    if (!item) throw notFound(id);
    return toCard(item, createCardContext(this.meta!, this.store, this.now()));
  }

  /** A card with its description, comments, children and links; the same answer until the card changes. */
  async detail(id: number, comments = DEFAULT_COMMENTS, history = false): Promise<CardDetail> {
    await this.ready();
    const card = await this.card(id);
    const key = detailKey(card, comments, history);
    const cached = this.details.get(key);
    if (cached) return cached;

    const view = await this.call(() => this.source.fetchDetail(id, comments));
    const revisions = history ? revisionTimeline(await this.call(() => this.source.fetchRevisions(id)), DEFAULT_HISTORY_FIELDS) : undefined;
    const detail = toCardDetail(card, view, revisions);
    this.details.set(key, detail);
    return detail;
  }

  /**
   * Moves a card to a state its type allows from the current one. The write is
   * refused by Azure DevOps when `rev` is behind; what it saved goes into the
   * cache at once, so watchers hear it before the next sync.
   */
  async setState(change: { id: number; state: string; rev?: number; comment?: string }): Promise<Card> {
    await this.ready();
    const card = await this.card(change.id);
    const plan = planStateChange(this.meta!, card, change.state);
    if (plan.same) return card;

    const saved = await this.call(() => this.source.changeState({ ...change, state: plan.state }, this.fields));
    const updated = toCard(saved, createCardContext(this.meta!, this.store, this.now()));
    this.store.upsert([saved]);
    // The new state may take the card out of every scope (Done leaves "mine, open").
    const keep = itemsToKeep(this.store.all(), this.scopes, scopeContext(this.meta!), this.tempScopes.memberIds());
    this.store.remove(this.store.ids().filter(stored => !keep.has(stored)));
    this.notify();
    return updated;
  }

  cacheStatus(): Status['cache'] {
    return { items: this.store.size, syncedAt: this.syncedAt, fullSyncedAt: this.fullSyncedAt, stale: this.isStale() };
  }

  syncStatus(): Status['sync'] {
    const now = this.now().getTime();
    const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString());
    return {
      running: this.inflight.has('full') || this.inflight.has('incremental'),
      nextAt: iso(this.nextAt),
      backoffUntil: this.backoffUntil !== null && this.backoffUntil > now ? iso(this.backoffUntil) : null,
      lastError: this.lastError,
    };
  }
}
