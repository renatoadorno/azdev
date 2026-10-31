import {
  CARD_FIELDS,
  ERROR_KINDS,
  EVENT_TYPES,
  FACETS,
  METHODS,
  PROTOCOL_VERSION,
  type Method,
} from '../interfaces/Serve';

interface MethodDoc {
  summary: string;
  /** Param name → type; `?` marks an optional one. */
  params: Record<string, string>;
  result: string;
}

const QUERY_PARAMS = {
  'filter?': 'ItemFilter {assignee?, sprint?, state?, category?, open?, type?, tag?, area?, parent?, q?, changedSince?}',
  'sort?': 'string[] — card fields, "-" for descending',
  'fields?': 'CardField[]',
  'limit?': 'number (default 200, max 1000)',
  'offset?': 'number',
  'facets?': 'Facet[]',
};

const METHOD_DOCS: Record<Method, MethodDoc> = {
  hello: {
    summary: 'First message on every connection; anything else first closes it',
    params: { token: 'string — from serve.json', proto: `number — ${PROTOCOL_VERSION}`, 'client?': 'string' },
    result: 'HelloResult {proto, version, status}',
  },
  'status.get': { summary: 'Daemon, login, cache and sync state', params: {}, result: 'Status' },
  'meta.get': {
    summary: 'Types with states and transitions, sprints with dates, members, tags, areas, me',
    params: {},
    result: 'Meta',
  },
  'items.list': { summary: 'Cards matching a query, from the cache or live', params: QUERY_PARAMS, result: 'ItemsResult' },
  'items.get': { summary: 'One card', params: { id: 'number' }, result: '{card: Card}' },
  'items.detail': {
    summary: 'Description, comments, links, children and attachments of a card',
    params: { id: 'number', 'comments?': 'number (default 20)', 'history?': 'boolean' },
    result: 'CardDetail',
  },
  'items.setState': {
    summary: 'Moves a card to a state its type allows from the current one',
    params: { id: 'number', state: 'string', 'rev?': 'number — answers conflict if the card changed since', 'comment?': 'string' },
    result: '{card: Card}',
  },
  'items.watch': {
    summary: 'items.list now, then a push {sub, result} each time the result changes',
    params: QUERY_PARAMS,
    result: 'WatchResult (ItemsResult + sub)',
  },
  'items.unwatch': { summary: 'Stops a watch', params: { sub: 'string' }, result: '{ok: true}' },
  'sync.run': {
    summary: 'Syncs with Azure DevOps now',
    params: { 'full?': 'boolean' },
    result: '{changed, removed, syncedAt}',
  },
  'schema.get': { summary: 'This description', params: {}, result: 'Schema' },
};

/** What `schema.get` answers: the protocol as data, for clients and agents. */
export function describeProtocol() {
  return {
    proto: PROTOCOL_VERSION,
    transport: 'NDJSON over TCP on 127.0.0.1; port and token in serve.json next to config.json',
    messages: {
      request: '{id, method, params?}',
      success: '{id, result}',
      failure: '{id | null, error: {kind, message, hint?, details?}}',
      push: '{sub, result}',
      event: '{event, data}',
    },
    methods: METHODS.map(name => ({ name, ...METHOD_DOCS[name] })),
    errorKinds: ERROR_KINDS,
    events: EVENT_TYPES,
    cardFields: CARD_FIELDS,
    facets: FACETS,
  };
}
