/**
 * Contract of `azdev serve`: NDJSON over TCP on 127.0.0.1, one JSON message per
 * line. The Herdr mod (QuickJS, which only has `net.connect`) and, later, the CLI
 * speak it. Bump PROTOCOL_VERSION only for a change that breaks an existing
 * client; a new method or a new optional field does not.
 */
export const PROTOCOL_VERSION = 1;

export const METHODS = [
  'hello',
  'status.get',
  'meta.get',
  'items.list',
  'items.get',
  'items.detail',
  'items.setState',
  'items.watch',
  'items.unwatch',
  'sync.run',
  'schema.get',
] as const;
export type Method = (typeof METHODS)[number];

export const ERROR_KINDS = [
  'unauthorized',
  'needs_login',
  'config_missing',
  'config_invalid',
  'forbidden',
  'not_found',
  'invalid_request',
  'invalid_state',
  'conflict',
  'rate_limited',
  'offline',
  'upstream',
  'internal',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface ServeError {
  kind: ErrorKind;
  message: string;
  /** What the person can do about it, ready to show. */
  hint?: string;
  details?: Record<string, unknown>;
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface Request {
  id: number;
  method: Method;
  params: Record<string, unknown>;
}

export interface Success<T = unknown> {
  id: number;
  result: T;
}

/** `id` is null when the request could not be read far enough to know it. */
export interface Failure {
  id: number | null;
  error: ServeError;
}

/** A watched query's new result, sent only when it changed. */
export interface Push<T = unknown> {
  sub: string;
  result: T;
}

export const EVENT_TYPES = ['status'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface ServerEvent<T = unknown> {
  event: EventType;
  data: T;
}

export type ServerMessage = Success | Failure | Push | ServerEvent;

// ── Cards ───────────────────────────────────────────────────────────────────

export interface Person {
  name: string;
  /** The account (unique name) — what `@me` and assignments compare. */
  email?: string;
}

export interface SprintRef {
  name: string;
  path: string;
  start?: string;
  finish?: string;
  current: boolean;
}

export interface ParentRef {
  id: number;
  title: string;
  type: string;
}

/** A work item as the daemon serves it: own names, not Azure field names. */
export interface Card {
  id: number;
  rev: number;
  type: string;
  state: string;
  /** Proposed, InProgress, Resolved, Completed or Removed — "open" is decided by it, not by the state's name. */
  stateCategory: string;
  stateColor?: string;
  title: string;
  assignedTo: Person | null;
  sprint: SprintRef | null;
  area: string;
  tags: string[];
  priority?: number;
  effort?: number;
  storyPoints?: number;
  remainingWork?: number;
  boardColumn?: string;
  parent: ParentRef | null;
  children: { total: number; done: number };
  commentCount: number;
  changedBy?: Person;
  changedAt: string;
  stateChangedAt?: string;
  createdAt: string;
  url: string;
}

export const CARD_FIELDS = [
  'id',
  'rev',
  'type',
  'state',
  'stateCategory',
  'stateColor',
  'title',
  'assignedTo',
  'sprint',
  'area',
  'tags',
  'priority',
  'effort',
  'storyPoints',
  'remainingWork',
  'boardColumn',
  'parent',
  'children',
  'commentCount',
  'changedBy',
  'changedAt',
  'stateChangedAt',
  'createdAt',
  'url',
] as const satisfies readonly (keyof Card)[];
export type CardField = (typeof CARD_FIELDS)[number];

// ── Queries ─────────────────────────────────────────────────────────────────

/** Values of one key are OR'ed; different keys are AND'ed. */
export interface ItemFilter {
  /** `@me`, `none`, `any` or an account. */
  assignee?: string[];
  /** `current`, `previous`, a number, a name or a full path. */
  sprint?: string[];
  state?: string[];
  category?: string[];
  /** Not in a Completed or Removed category. */
  open?: boolean;
  type?: string[];
  tag?: string[];
  /** Under this area path. */
  area?: string[];
  parent?: number[];
  /** Title text, or `#id`. */
  q?: string;
  /** ISO instant or a relative span (`7d`, `2w`). */
  changedSince?: string;
}

export const FACETS = ['state', 'category', 'type', 'assignee', 'sprint', 'tag'] as const;
export type Facet = (typeof FACETS)[number];

export interface ItemsQuery {
  filter?: ItemFilter;
  /** Card fields, `-` for descending: `["-changedAt", "priority"]`. */
  sort?: string[];
  fields?: CardField[];
  limit?: number;
  offset?: number;
  /** Counts over the filtered set, before paging. */
  facets?: Facet[];
}

export interface ItemsResult {
  items: Partial<Card>[];
  total: number;
  facets?: Partial<Record<Facet, Record<string, number>>>;
  seq: number;
  syncedAt: string | null;
  stale: boolean;
  source: 'cache' | 'live';
}

export interface WatchResult extends ItemsResult {
  sub: string;
}

// ── Metadata ────────────────────────────────────────────────────────────────

export interface StateInfo {
  name: string;
  category: string;
  color?: string;
}

export interface TypeInfo {
  name: string;
  color?: string;
  states: StateInfo[];
  /**
   * Reachable states by current state; `""` holds the initial one. The process
   * restricts some moves (a Task in Removed cannot go to Done), so a state menu
   * offers `transitions[card.state]`, not every state.
   */
  transitions: Record<string, string[]>;
}

export interface SprintInfo {
  id?: string;
  name: string;
  path: string;
  start?: string;
  finish?: string;
  timeframe?: 'past' | 'current' | 'future';
}

export interface Meta {
  orgUrl: string;
  project: string;
  me: { id: string; name: string; email: string };
  types: TypeInfo[];
  sprints: SprintInfo[];
  members: Person[];
  tags: string[];
  areas: string[];
  fetchedAt: string;
}

// ── Detail ──────────────────────────────────────────────────────────────────

export interface CommentInfo {
  id: number;
  author?: string;
  date?: string;
  text: string;
}

export interface LinkedItem {
  id: number;
  link?: string;
  title?: string;
  type?: string;
  state?: string;
}

export interface CardDetail {
  card: Card;
  /** Markdown. */
  description?: string;
  acceptanceCriteria?: string;
  comments: { total: number; items: CommentInfo[] };
  children: LinkedItem[];
  links: LinkedItem[];
  images: string[];
  attachments: Array<{ name: string; url: string }>;
  history?: unknown[];
}

// ── Status ──────────────────────────────────────────────────────────────────

export const AUTH_STATES = ['ok', 'needs_login', 'unknown'] as const;
export type AuthState = (typeof AUTH_STATES)[number];

export interface Status {
  version: string;
  proto: number;
  pid: number;
  startedAt: string;
  project: string;
  auth: { state: AuthState; source?: 'env' | 'keychain' | 'entra'; hint?: string };
  cache: { items: number; syncedAt: string | null; fullSyncedAt: string | null; stale: boolean };
  sync: {
    running: boolean;
    nextAt: string | null;
    backoffUntil: string | null;
    lastError: (ServeError & { at: string }) | null;
  };
  clients: number;
}

// ── Methods ─────────────────────────────────────────────────────────────────

export interface HelloParams {
  token: string;
  proto: number;
  client?: string;
}

export interface HelloResult {
  proto: number;
  version: string;
  status: Status;
}

export interface SetStateParams {
  id: number;
  state: string;
  /** The revision the client saw; a newer one on the server answers `conflict` instead of writing. */
  rev?: number;
  comment?: string;
}

export interface DetailParams {
  id: number;
  comments?: number;
  history?: boolean;
}

/** Params and result of each method, for typed dispatch on both ends. */
export interface MethodMap {
  hello: { params: HelloParams; result: HelloResult };
  'status.get': { params: Record<string, never>; result: Status };
  'meta.get': { params: Record<string, never>; result: Meta };
  'items.list': { params: ItemsQuery; result: ItemsResult };
  'items.get': { params: { id: number }; result: { card: Card } };
  'items.detail': { params: DetailParams; result: CardDetail };
  'items.setState': { params: SetStateParams; result: { card: Card } };
  'items.watch': { params: ItemsQuery; result: WatchResult };
  'items.unwatch': { params: { sub: string }; result: { ok: true } };
  'sync.run': { params: { full?: boolean }; result: { changed: number; removed: number; syncedAt: string } };
  'schema.get': { params: Record<string, never>; result: unknown };
}
